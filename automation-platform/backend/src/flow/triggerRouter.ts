import type { SupabaseClient } from '@supabase/supabase-js'
import type { WASocket } from '@whiskeysockets/baileys'
import { chooseBranchOption } from './openaiBranch.js'
import { parseGraph } from './graphRuntime.js'
import { executeAutomationRun } from './runAutomation.js'
import type { AutomationRow, AutomationRunRow, TriggerEvent } from './types.js'
import { ensureWorkspaceWhatsAppConnected } from '../wa/baileysSession.js'

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function appendExecutionTrace(
  variables: Record<string, unknown>,
  entry: { nodeId: string; nodeType: string; event: string; detail?: Record<string, unknown> },
): Record<string, unknown> {
  const currentTrace = Array.isArray(variables.executionTrace) ? variables.executionTrace : []
  return {
    ...variables,
    executionTrace: [
      ...currentTrace,
      {
        at: new Date().toISOString(),
        ...entry,
      },
    ].slice(-200),
  }
}

export function triggerMatches(automation: AutomationRow, event: TriggerEvent): boolean {
  const triggerType = automation.trigger_type ?? 'message.received'
  if (triggerType !== event.type) return false

  const config = automation.trigger_config ?? {}
  const whatsappInstanceIds = Array.isArray(config.whatsappInstanceIds)
    ? config.whatsappInstanceIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []
  if (whatsappInstanceIds.length > 0 && (!event.whatsappInstanceId || !whatsappInstanceIds.includes(event.whatsappInstanceId))) {
    return false
  }

  if (event.type === 'conversation.created' || event.type === 'message.received') {
    const conversationStatus = config.conversationStatus
    if (typeof conversationStatus === 'string' && conversationStatus !== event.payload.conversationStatus) return false
    const contactStatus = config.contactStatus
    if (typeof contactStatus === 'string' && contactStatus !== event.payload.contactStatus) return false
  }

  if (event.type === 'contact.datetime') {
    const fieldKey = config.fieldKey
    if (typeof fieldKey === 'string' && fieldKey !== event.payload.fieldKey) return false
    const attr = config.attributePath
    if (typeof attr === 'string' && attr !== event.payload.attributePath) return false
  }

  if (event.type === 'calendly.event') {
    const events = Array.isArray(config.events) ? config.events.filter((item): item is string => typeof item === 'string') : []
    const eventName = typeof event.payload.calendlyEvent === 'string' ? event.payload.calendlyEvent : ''
    if (events.length > 0 && eventName && !events.includes(eventName)) return false
    const scope = typeof config.scope === 'string' ? config.scope : ''
    const payloadScope = typeof event.payload.scope === 'string' ? event.payload.scope : ''
    if (scope && payloadScope && scope !== payloadScope) return false
    const eventTypeUri = typeof config.eventTypeUri === 'string' ? config.eventTypeUri : ''
    const payloadEventType = typeof event.payload.eventType === 'string' ? event.payload.eventType : ''
    if (eventTypeUri && payloadEventType && eventTypeUri !== payloadEventType) return false
  }

  return true
}

export async function continueAwaitingReply(
  admin: SupabaseClient,
  args: {
    workspaceId: string
    contactId: string
    contactJid: string
    conversationId: string
    text: string
    sock: WASocket
  },
): Promise<boolean> {
  const { data } = await admin
    .from('automation_runs')
    .select('id, workspace_id, automation_id, contact_id, conversation_id, current_node_id, status, variables, trigger_type, trigger_payload, automations(graph)')
    .eq('workspace_id', args.workspaceId)
    .eq('contact_id', args.contactId)
    .eq('conversation_id', args.conversationId)
    .eq('status', 'awaiting_reply')
    .order('updated_at', { ascending: false })
    .limit(10)

  const runs = (data ?? []) as Array<AutomationRunRow & { automations?: { graph?: unknown } }>
  let handled = false

  for (const run of runs) {
    const graph = parseGraph(run.automations?.graph)
    const node = graph?.nodes[run.current_node_id]
    if (!graph || !node || node.type !== 'branch') continue

    const chosen = await chooseBranchOption(
      args.text,
      node.options.map((option) => ({ id: option.id, label: option.label, hint: option.hint })),
      {
        routingInstructions: node.routingInstructions,
        allowFallback: Boolean(node.fallbackNext),
      },
    )
    const option = node.options.find((candidate) => candidate.id === chosen)
    const nextNodeId = option?.next || node.fallbackNext || node.options[0]?.next
    if (!nextNodeId) continue

    const variables = appendExecutionTrace(
      {
        ...asObject(run.variables),
        latestReply: args.text,
        chosenOptionId: option?.id ?? 'fallback',
        chosenRouteLabel: option?.label ?? 'Fallback',
      },
      {
        nodeId: run.current_node_id,
        nodeType: 'branch',
        event: 'reply_routed',
        detail: {
          incomingMessage: args.text,
          chosenOptionId: option?.id ?? null,
          chosenRouteLabel: option?.label ?? null,
          fallbackUsed: !option,
          next: nextNodeId,
        },
      },
    )

    const { data: updated } = await admin
      .from('automation_runs')
      .update({
        current_node_id: nextNodeId,
        status: 'running',
        variables,
        updated_at: new Date().toISOString(),
      })
      .eq('id', run.id)
      .select('id, workspace_id, automation_id, contact_id, conversation_id, current_node_id, status, variables, trigger_type, trigger_payload')
      .single()

    if (updated) {
      await executeAutomationRun(admin, {
        workspaceId: args.workspaceId,
        contactId: args.contactId,
        contactJid: args.contactJid,
        conversationId: args.conversationId,
        automationId: run.automation_id,
        graph,
        run: updated as AutomationRunRow,
        sock: args.sock,
      })
      handled = true
    }
  }

  return handled
}

export async function continuePendingManualTrigger(
  admin: SupabaseClient,
  args: {
    workspaceId: string
    contactId: string
    contactJid: string
    conversationId: string
    text: string
    whatsappInstanceId?: string
    waMessageId?: string
    sock: WASocket
  },
): Promise<boolean> {
  const { data } = await admin
    .from('automation_runs')
    .select('id, workspace_id, automation_id, contact_id, conversation_id, current_node_id, status, variables, trigger_type, trigger_payload, automations(graph)')
    .eq('workspace_id', args.workspaceId)
    .eq('contact_id', args.contactId)
    .eq('trigger_type', 'manual.wait')
    .eq('status', 'paused')
    .order('updated_at', { ascending: false })
    .limit(5)

  const runs = (data ?? []) as Array<AutomationRunRow & { automations?: { graph?: unknown } }>
  let handled = false

  for (const run of runs) {
    const graph = parseGraph(run.automations?.graph)
    if (!graph) continue

    const variables = appendExecutionTrace(
      {
        ...asObject(run.variables),
        triggerType: 'manual.wait',
        testRun: true,
        latestReply: args.text,
        text: args.text,
        whatsappInstanceId: args.whatsappInstanceId ?? '',
        waMessageId: args.waMessageId ?? '',
      },
      {
        nodeId: run.current_node_id,
        nodeType: 'trigger',
        event: 'manual_wait_triggered',
        detail: {
          incomingMessage: args.text,
          contactJid: args.contactJid,
          conversationId: args.conversationId,
          waMessageId: args.waMessageId ?? null,
        },
      },
    )

    const { data: updated } = await admin
      .from('automation_runs')
      .update({
        conversation_id: args.conversationId,
        status: 'running',
        variables,
        trigger_payload: {
          ...asObject(run.trigger_payload),
          text: args.text,
          contactJid: args.contactJid,
          conversationId: args.conversationId,
          waMessageId: args.waMessageId ?? null,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', run.id)
      .select('id, workspace_id, automation_id, contact_id, conversation_id, current_node_id, status, variables, trigger_type, trigger_payload')
      .single()

    if (updated) {
      await executeAutomationRun(admin, {
        workspaceId: args.workspaceId,
        contactId: args.contactId,
        contactJid: args.contactJid,
        conversationId: args.conversationId,
        automationId: run.automation_id,
        graph,
        run: updated as AutomationRunRow,
        sock: args.sock,
      })
      handled = true
    }
  }

  return handled
}

export async function routeTrigger(
  admin: SupabaseClient,
  event: TriggerEvent,
  opts: { sock?: WASocket | null } = {},
): Promise<void> {
  // Pre-flight: try to establish a workspace WhatsApp socket before starting runs.
  // This helps scheduled/webhook triggers execute send nodes without requiring manual refresh.
  await ensureWorkspaceWhatsAppConnected(event.workspaceId).catch(() => false)

  const { data, error } = await admin
    .from('automations')
    .select('id, workspace_id, name, is_active, entry_node_id, graph, trigger_type, trigger_config')
    .eq('workspace_id', event.workspaceId)
    .eq('is_active', true)
    .eq('trigger_type', event.type)

  if (error) throw new Error(`Failed to load automations: ${error.message}`)

  const automations = ((data as AutomationRow[]) ?? []).filter((automation) => triggerMatches(automation, event))
  for (const automation of automations) {
    const graph = parseGraph(automation.graph)
    if (!graph) continue
    const currentNodeId = automation.entry_node_id || graph.entry
    const variables = {
      triggerType: event.type,
      whatsappInstanceId: event.whatsappInstanceId ?? '',
      ...(event.payload ?? {}),
    }
    const tracedVariables = appendExecutionTrace(variables, {
      nodeId: currentNodeId,
      nodeType: 'trigger',
      event: 'trigger_matched',
      detail: {
        triggerType: event.type,
        contactJid: event.contactJid ?? null,
        conversationId: event.conversationId ?? null,
        text: typeof event.payload.text === 'string' ? event.payload.text : null,
      },
    })

    // Recovery guard: if a previous run was left "running" (for example process restart
    // after insert and before execution), close stale rows before starting a new one.
    const staleCutoffIso = new Date(Date.now() - 10 * 60_000).toISOString()
    await admin
      .from('automation_runs')
      .update({
        status: 'failed',
        error: 'Run marked stale and superseded by a new trigger execution.',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('automation_id', automation.id)
      .eq('trigger_type', event.type)
      .eq('status', 'running')
      .eq('contact_id', event.contactId ?? null)
      .lt('updated_at', staleCutoffIso)

    const { data: run, error: runError } = await admin
      .from('automation_runs')
      .insert({
        workspace_id: event.workspaceId,
        automation_id: automation.id,
        contact_id: event.contactId ?? null,
        conversation_id: event.conversationId ?? null,
        current_node_id: currentNodeId,
        status: 'running',
        variables: tracedVariables,
        trigger_type: event.type,
        trigger_payload: event.payload,
      })
      .select('id, workspace_id, automation_id, contact_id, conversation_id, current_node_id, status, variables, trigger_type, trigger_payload')
      .single()

    if (runError || !run) throw new Error(runError?.message ?? 'Failed to create automation run')

    await executeAutomationRun(admin, {
      workspaceId: event.workspaceId,
      contactId: event.contactId ?? null,
      contactJid: event.contactJid ?? null,
      conversationId: event.conversationId ?? null,
      automationId: automation.id,
      graph,
      run: run as AutomationRunRow,
      sock: opts.sock ?? null,
    })
  }
}
