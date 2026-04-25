import type { SupabaseClient } from '@supabase/supabase-js'
import { getServiceRoleClient } from '../lib/supabase-clients.js'
import { routeTrigger } from './triggerRouter.js'

const TICK_MS = 60_000

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function readPath(source: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.').filter(Boolean)
  let current: unknown = source
  for (const part of parts) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  if (current && typeof current === 'object' && !Array.isArray(current) && 'value' in current) {
    return (current as { value?: unknown }).value
  }
  return current
}

function dueBucket(value: unknown, now: Date, offsetMinutes: number): string | null {
  if (typeof value !== 'string' || !value) return null
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return null
  const target = timestamp - offsetMinutes * 60_000
  const nowMs = now.getTime()
  if (!(target <= nowMs && target > nowMs - TICK_MS * 2)) return null
  // Stable minute bucket based on scheduled target time, not "now".
  // Prevents duplicate runs every scheduler tick for the same due datetime.
  return new Date(target).toISOString().slice(0, 16)
}

function readOffsetMinutes(config: Record<string, unknown>): number {
  if (typeof config.offsetMinutes === 'number' && Number.isFinite(config.offsetMinutes)) return config.offsetMinutes
  const amount = typeof config.offsetAmount === 'number' && Number.isFinite(config.offsetAmount) ? Math.max(0, config.offsetAmount) : 0
  const unit =
    config.offsetUnit === 'weeks' || config.offsetUnit === 'days' || config.offsetUnit === 'hours' || config.offsetUnit === 'minutes'
      ? config.offsetUnit
      : 'hours'
  const direction = config.offsetDirection === 'after' ? 'after' : 'before'
  const factor = unit === 'weeks' ? 10_080 : unit === 'days' ? 1_440 : unit === 'hours' ? 60 : 1
  const minutes = amount * factor
  return direction === 'before' ? minutes : -minutes
}

async function processAutomation(admin: SupabaseClient, automation: Record<string, unknown>, now: Date) {
  const config = asObject(automation.trigger_config)
  const fieldKey = typeof config.fieldKey === 'string' ? config.fieldKey.trim() : ''
  const attributePath = typeof config.attributePath === 'string' && config.attributePath
    ? config.attributePath
    : fieldKey
      ? `custom_attributes.${fieldKey}`
      : ''
  if (!attributePath) return
  const offsetMinutes = readOffsetMinutes(config)
  const workspaceId = automation.workspace_id as string

  const { data: contacts, error } = await admin
    .from('contacts')
    .select('id, wa_jid, metadata')
    .eq('workspace_id', workspaceId)

  if (error) throw new Error(`Failed to load scheduled contacts: ${error.message}`)

  for (const contact of contacts ?? []) {
    const metadata = asObject(contact.metadata)
    const value = readPath({ ...metadata, custom_attributes: metadata.custom_attributes }, attributePath)
    const bucket = dueBucket(value, now, offsetMinutes)
    if (!bucket) continue

    const lockKey = `${attributePath}:${String(value)}:${bucket}`
    const { error: lockError } = await admin.from('scheduled_trigger_locks').insert({
      workspace_id: workspaceId,
      automation_id: automation.id,
      contact_id: contact.id,
      lock_key: lockKey,
    })
    if (lockError) continue

    await routeTrigger(admin, {
      workspaceId,
      type: 'contact.datetime',
      contactId: contact.id as string,
      contactJid: contact.wa_jid as string,
      payload: {
        fieldKey,
        attributePath,
        value,
        offsetMinutes,
        offsetDirection: offsetMinutes < 0 ? 'after' : 'before',
      },
    })
  }
}

export async function runScheduledTriggers(): Promise<void> {
  const admin = getServiceRoleClient()
  const now = new Date()
  const { data, error } = await admin
    .from('automations')
    .select('id, workspace_id, trigger_config')
    .eq('is_active', true)
    .eq('trigger_type', 'contact.datetime')

  if (error) throw new Error(`Failed to load scheduled automations: ${error.message}`)

  for (const automation of data ?? []) {
    await processAutomation(admin, automation, now)
  }
}

export function startScheduler(): NodeJS.Timeout {
  return setInterval(() => {
    void runScheduledTriggers().catch((error) => {
      console.error('[scheduler]', error)
    })
  }, TICK_MS)
}
