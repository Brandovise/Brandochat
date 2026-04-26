import type { SupabaseClient } from '@supabase/supabase-js'
import { getServiceRoleClient } from '../lib/supabase-clients.js'
import { routeTrigger } from './triggerRouter.js'

const TICK_MS = 60_000
const DATETIME_RETRY_WINDOW_MS = 20 * 60_000
const DATETIME_STALE_RUNNING_MS = 2 * 60_000

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
  if (!(target <= nowMs && target > nowMs - DATETIME_RETRY_WINDOW_MS)) return null
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
    // #region agent log
    fetch('http://127.0.0.1:7271/ingest/f8faaa4f-224d-477d-aa48-fe5fcffd5b08',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fc3e1c'},body:JSON.stringify({sessionId:'fc3e1c',runId:'pre-fix',hypothesisId:'H1',location:'scheduler.ts:73',message:'contact.datetime candidate due',data:{automationId:String(automation.id ?? ''),workspaceId,contactId:String(contact.id ?? ''),attributePath,offsetMinutes,value:String(value),bucket,lockKey},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const { error: lockError } = await admin.from('scheduled_trigger_locks').insert({
      workspace_id: workspaceId,
      automation_id: automation.id,
      contact_id: contact.id,
      lock_key: lockKey,
    })
    if (lockError) {
      // #region agent log
      fetch('http://127.0.0.1:7271/ingest/f8faaa4f-224d-477d-aa48-fe5fcffd5b08',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fc3e1c'},body:JSON.stringify({sessionId:'fc3e1c',runId:'pre-fix',hypothesisId:'H1',location:'scheduler.ts:82',message:'contact.datetime lock insert skipped',data:{automationId:String(automation.id ?? ''),contactId:String(contact.id ?? ''),lockKey,error:lockError.message},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      const isDuplicateLock = lockError.message.includes('scheduled_trigger_locks_automation_id_contact_id_lock_key_key')
      if (!isDuplicateLock) continue
      const { data: lastRun } = await admin
        .from('automation_runs')
        .select('id, status, updated_at, trigger_payload')
        .eq('automation_id', String(automation.id))
        .eq('contact_id', String(contact.id))
        .eq('trigger_type', 'contact.datetime')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const payload = (lastRun?.trigger_payload ?? {}) as Record<string, unknown>
      const sameValue = String(payload.value ?? '') === String(value)
      const isFailed = String(lastRun?.status ?? '') === 'failed'
      const isRunning = String(lastRun?.status ?? '') === 'running'
      const lastRunUpdatedAtMs =
        typeof lastRun?.updated_at === 'string' ? Date.parse(lastRun.updated_at as string) : Number.NaN
      const isStaleRunning =
        isRunning && Number.isFinite(lastRunUpdatedAtMs) ? Date.now() - lastRunUpdatedAtMs > DATETIME_STALE_RUNNING_MS : false
      const { data: sameValueRun } = await admin
        .from('automation_runs')
        .select('id, status, updated_at, trigger_payload')
        .eq('automation_id', String(automation.id))
        .eq('contact_id', String(contact.id))
        .eq('trigger_type', 'contact.datetime')
        .order('updated_at', { ascending: false })
        .limit(25)
      const matchingRun = (sameValueRun ?? []).find((row) => {
        const rowPayload = (row.trigger_payload ?? {}) as Record<string, unknown>
        return String(rowPayload.value ?? '') === String(value)
      })
      const isOrphanLock = !matchingRun
      // #region agent log
      fetch('http://127.0.0.1:7271/ingest/f8faaa4f-224d-477d-aa48-fe5fcffd5b08',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fc3e1c'},body:JSON.stringify({sessionId:'fc3e1c',runId:'post-fix',hypothesisId:'H9',location:'scheduler.ts:96',message:'duplicate lock recovery check',data:{automationId:String(automation.id ?? ''),contactId:String(contact.id ?? ''),lockKey,lastRunId:String(lastRun?.id ?? ''),lastRunStatus:String(lastRun?.status ?? ''),sameValue,isFailed,isRunning,isStaleRunning,matchingRunId:String(matchingRun?.id ?? ''),matchingRunStatus:String(matchingRun?.status ?? ''),isOrphanLock},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      const canRecoverFromFailedMatchingRun = sameValue && isFailed
      const canRecoverFromStaleRunning = sameValue && isStaleRunning
      if (!(canRecoverFromFailedMatchingRun || canRecoverFromStaleRunning || isOrphanLock)) continue
      if (canRecoverFromStaleRunning && lastRun?.id) {
        await admin
          .from('automation_runs')
          .update({
            status: 'failed',
            error: 'Run marked stale by scheduler lock recovery.',
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', String(lastRun.id))
      }
      await admin
        .from('scheduled_trigger_locks')
        .delete()
        .eq('workspace_id', workspaceId)
        .eq('automation_id', String(automation.id))
        .eq('contact_id', String(contact.id))
        .eq('lock_key', lockKey)
      const { error: lockRetryError } = await admin.from('scheduled_trigger_locks').insert({
        workspace_id: workspaceId,
        automation_id: automation.id,
        contact_id: contact.id,
        lock_key: lockKey,
      })
      // #region agent log
      fetch('http://127.0.0.1:7271/ingest/f8faaa4f-224d-477d-aa48-fe5fcffd5b08',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fc3e1c'},body:JSON.stringify({sessionId:'fc3e1c',runId:'pre-fix',hypothesisId:'H6',location:'scheduler.ts:114',message:'duplicate lock recovery retry result',data:{automationId:String(automation.id ?? ''),contactId:String(contact.id ?? ''),lockKey,retryError:lockRetryError?.message ?? null},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      if (lockRetryError) continue
    } else {
      // lock insert succeeded, proceed normally
    }

    const routeStartedAt = Date.now()
    // #region agent log
    fetch('http://127.0.0.1:7271/ingest/f8faaa4f-224d-477d-aa48-fe5fcffd5b08',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fc3e1c'},body:JSON.stringify({sessionId:'fc3e1c',runId:'pre-fix',hypothesisId:'H7',location:'scheduler.ts:142',message:'routeTrigger dispatch start',data:{automationId:String(automation.id ?? ''),contactId:String(contact.id ?? ''),lockKey},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    try {
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
      // #region agent log
      fetch('http://127.0.0.1:7271/ingest/f8faaa4f-224d-477d-aa48-fe5fcffd5b08',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fc3e1c'},body:JSON.stringify({sessionId:'fc3e1c',runId:'pre-fix',hypothesisId:'H7',location:'scheduler.ts:160',message:'routeTrigger dispatch end',data:{automationId:String(automation.id ?? ''),contactId:String(contact.id ?? ''),lockKey,durationMs:Date.now()-routeStartedAt},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // #region agent log
      fetch('http://127.0.0.1:7271/ingest/f8faaa4f-224d-477d-aa48-fe5fcffd5b08',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fc3e1c'},body:JSON.stringify({sessionId:'fc3e1c',runId:'post-fix',hypothesisId:'H8',location:'scheduler.ts:164',message:'routeTrigger dispatch failed',data:{automationId:String(automation.id ?? ''),contactId:String(contact.id ?? ''),lockKey,error:message},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      await admin
        .from('scheduled_trigger_locks')
        .delete()
        .eq('workspace_id', workspaceId)
        .eq('automation_id', String(automation.id))
        .eq('contact_id', String(contact.id))
        .eq('lock_key', lockKey)
      if (message === 'CONTACT_DATETIME_DEFERRED_NO_SOCKET') continue
      throw error
    }
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
