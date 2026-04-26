import type { SupabaseClient } from '@supabase/supabase-js'
import type { WASocket } from '@whiskeysockets/baileys'
import OpenAI from 'openai'
import { env } from '../config/env.js'
import { applyTemplateVars, buildContactPlaceholderVars, readVariable, type AutomationGraph } from './graphRuntime.js'
import type { AutomationRunRow } from './types.js'
import { ensureWorkspaceWhatsAppConnected, sendWorkspaceTextMessage } from '../wa/baileysSession.js'

export type FlowStateRow = {
  id: string
  current_node_id: string
  status: string
  variables: Record<string, unknown>
}

type TraceEntry = {
  at: string
  nodeId: string
  nodeType: string
  event: string
  detail?: Record<string, unknown>
}

const SEND_RETRY_ATTEMPTS = 3
const SEND_RETRY_DELAY_MS = 10_000
const SEND_ATTEMPT_TIMEOUT_MS = 35_000
const SEND_TRANSPORT_ATTEMPT_TIMEOUT_MS = 140_000

function toTemplateVars(vars: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(vars).map(([key, value]) => [key, value == null ? '' : String(value)]))
}

function toWhatsAppJid(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.includes('@')) return trimmed
  const digits = trimmed.replace(/[^\d]/g, '')
  return digits ? `${digits}@s.whatsapp.net` : ''
}

function phoneFromJid(jid: string): string {
  const digits = jid.split('@')[0]?.replace(/[^\d]/g, '') ?? ''
  return digits ? `+${digits}` : ''
}

function appendTrace(
  variables: Record<string, unknown>,
  entry: Omit<TraceEntry, 'at'>,
): Record<string, unknown> {
  const currentTrace = Array.isArray(variables.executionTrace) ? (variables.executionTrace as TraceEntry[]) : []
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

async function runAiSkill(instructions: string, variables: Record<string, string>): Promise<string> {
  const prompt = applyTemplateVars(instructions, variables)
  if (!env.OPENAI_API_KEY) return prompt
  const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY })
  const response = await openai.chat.completions.create({
    model: env.OPENAI_MODEL,
    temperature: 0.3,
    messages: [
      {
        role: 'system',
        content:
          'You are an automation skill inside a WhatsApp workflow. Follow the provided business instructions exactly. Return only the next message or concise decision text.',
      },
      { role: 'user', content: JSON.stringify({ instructions: prompt, variables }) },
    ],
  })
  return response.choices[0]?.message?.content?.trim() || ''
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function loadContactVars(admin: SupabaseClient, contactId?: string | null): Promise<Record<string, string>> {
  if (!contactId) return {}
  const { data: contactRow } = await admin
    .from('contacts')
    .select('display_name, phone_e164, wa_jid, notes, metadata')
    .eq('id', contactId)
    .maybeSingle()

  return contactRow
    ? buildContactPlaceholderVars({
        display_name: contactRow.display_name as string | null,
        phone_e164: contactRow.phone_e164 as string | null,
        wa_jid: contactRow.wa_jid as string,
        notes: contactRow.notes as string | null,
        metadata: contactRow.metadata as Record<string, unknown> | null,
      })
    : {}
}

export async function executeGraphUntilBlocked(
  admin: SupabaseClient,
  args: {
    workspaceId: string
    contactId: string
    contactJid: string
    automationId: string
    graph: AutomationGraph
    state: FlowStateRow
    sock: WASocket
  },
): Promise<void> {
  await executeStateMachine(admin, {
    ...args,
    stateId: args.state.id,
    table: 'contact_flow_state',
    currentNodeId: args.state.current_node_id,
    status: args.state.status,
    variables: args.state.variables,
  })
}

export async function executeAutomationRun(
  admin: SupabaseClient,
  args: {
    workspaceId: string
    contactId?: string | null
    contactJid?: string | null
    conversationId?: string | null
    automationId: string
    graph: AutomationGraph
    run: AutomationRunRow
    sock?: WASocket | null
  },
): Promise<void> {
  await executeStateMachine(admin, {
    ...args,
    stateId: args.run.id,
    table: 'automation_runs',
    currentNodeId: args.run.current_node_id,
    status: args.run.status,
    variables: args.run.variables,
  })
}

async function executeStateMachine(
  admin: SupabaseClient,
  args: {
    workspaceId: string
    contactId?: string | null
    contactJid?: string | null
    conversationId?: string | null
    automationId: string
    graph: AutomationGraph
    stateId: string
    table: 'contact_flow_state' | 'automation_runs'
    currentNodeId: string
    status: string
    variables: Record<string, unknown>
    sock?: WASocket | null
  },
): Promise<void> {
  let current = args.currentNodeId
  let variables = { ...args.variables }

  const patchState = async (patch: Partial<FlowStateRow> & { error?: string | null }) => {
    const status = patch.status ?? 'running'
    const update: Record<string, unknown> = {
      current_node_id: patch.current_node_id ?? current,
      status,
      variables: (patch.variables ?? variables) as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    }
    if (args.table === 'automation_runs') {
      if (status === 'completed' || status === 'failed') update.completed_at = new Date().toISOString()
      if (patch.error !== undefined) update.error = patch.error
    }
    await admin.from(args.table).update(update).eq('id', args.stateId)
  }

  while (true) {
    try {
      const node = args.graph.nodes[current]
      if (!node) {
        variables = appendTrace(variables, {
          nodeId: current,
          nodeType: 'missing',
          event: 'completed',
          detail: { reason: 'Node was not found, ending run.' },
        })
        await patchState({ status: 'completed', current_node_id: current })
        return
      }
      if (node.type === 'end') {
        variables = appendTrace(variables, { nodeId: current, nodeType: node.type, event: 'completed' })
        await patchState({ status: 'completed', current_node_id: current })
        return
      }
      if (node.type === 'branch') {
        variables = appendTrace(variables, {
          nodeId: current,
          nodeType: node.type,
          event: 'awaiting_reply',
          detail: { options: node.options.map((option) => ({ id: option.id, label: option.label, next: option.next })) },
        })
        await patchState({ status: 'awaiting_reply', current_node_id: current, variables })
        return
      }
      if (node.type === 'send') {
      const { data: tpl } = await admin
        .from('message_templates')
        .select('body')
        .eq('id', node.templateId)
        .maybeSingle()
      const contactVars = await loadContactVars(admin, args.contactId)
      const mergedVars = { ...contactVars, ...variables }
      const templateVars = toTemplateVars(mergedVars)
      const body = applyTemplateVars((tpl?.body as string) ?? '[missing template]', templateVars)
      const toField = typeof node.to === 'string' ? node.to : ''
      const recipientRaw =
        !toField || toField === 'Current conversation contact'
          ? args.contactJid ?? ''
          : toField === 'Custom'
            ? ''
            : applyTemplateVars(toField, templateVars)
      const recipientJid = toWhatsAppJid(recipientRaw)
      if (!recipientJid) {
        await patchState({ status: 'failed', current_node_id: current, error: 'Send node could not resolve recipient phone/JID' })
        return
      }

      let eventContactId = args.contactId ?? null
      if (!eventContactId || (args.contactJid && args.contactJid !== recipientJid)) {
        const { data: existingRecipient } = await admin
          .from('contacts')
          .select('id')
          .eq('workspace_id', args.workspaceId)
          .eq('wa_jid', recipientJid)
          .maybeSingle()
        if (existingRecipient?.id) {
          eventContactId = existingRecipient.id as string
        } else {
          const { data: createdRecipient } = await admin
            .from('contacts')
            .insert({
              workspace_id: args.workspaceId,
              wa_jid: recipientJid,
              phone_e164: phoneFromJid(recipientJid) || null,
              display_name:
                (typeof templateVars.inviteeName === 'string' && templateVars.inviteeName.trim()) ||
                (typeof templateVars['contact.display_name'] === 'string' && templateVars['contact.display_name'].trim()) ||
                null,
              metadata: {
                source: 'automation.send',
                created_from_automation: true,
              },
            })
            .select('id')
            .single()
          eventContactId = (createdRecipient?.id as string | undefined) ?? null
        }
      }

      let waMessageId: string | null = null
      if (args.sock) {
        const sent = await withTimeout(args.sock.sendMessage(recipientJid, { text: body }), SEND_ATTEMPT_TIMEOUT_MS, 'WhatsApp send')
        waMessageId = sent?.key.id ?? null
      } else {
        let sentError: unknown = null
        for (let attempt = 1; attempt <= SEND_RETRY_ATTEMPTS; attempt += 1) {
          variables = appendTrace(variables, {
            nodeId: current,
            nodeType: node.type,
            event: 'send_attempt',
            detail: { attempt, maxAttempts: SEND_RETRY_ATTEMPTS, recipient: recipientJid },
          })
          await patchState({ status: 'running', current_node_id: current, variables })
          try {
            await withTimeout(
              ensureWorkspaceWhatsAppConnected(args.workspaceId).catch(() => false),
              SEND_TRANSPORT_ATTEMPT_TIMEOUT_MS,
              'WhatsApp reconnect',
            )
            const sent = await withTimeout(
              sendWorkspaceTextMessage({
                workspaceId: args.workspaceId,
                jid: recipientJid,
                text: body,
              }),
              SEND_TRANSPORT_ATTEMPT_TIMEOUT_MS,
              'WhatsApp send',
            )
            waMessageId = sent.waMessageId
            sentError = null
            break
          } catch (error) {
            sentError = error
            const message = error instanceof Error ? error.message : String(error)
            const isRetryable =
              message.includes('WhatsApp is not connected') ||
              message.includes('timed out') ||
              message.includes('timed out waiting for message')
            if (!isRetryable || attempt === SEND_RETRY_ATTEMPTS) break
            variables = appendTrace(variables, {
              nodeId: current,
              nodeType: node.type,
              event: 'send_retry_wait',
              detail: {
                attempt,
                maxAttempts: SEND_RETRY_ATTEMPTS,
                retryInMs: SEND_RETRY_DELAY_MS,
                error: message,
              },
            })
            await patchState({ status: 'running', current_node_id: current, variables })
            await sleep(SEND_RETRY_DELAY_MS)
          }
        }
        if (sentError) throw sentError
      }
      await admin.from('message_events').insert({
        workspace_id: args.workspaceId,
        contact_id: eventContactId,
        conversation_id: args.conversationId ?? null,
        direction: 'outbound',
        wa_message_id: waMessageId,
        wa_chat_jid: recipientJid,
        body,
        automation_id: args.automationId,
        node_id: current,
      })
      variables = appendTrace(variables, {
        nodeId: current,
        nodeType: node.type,
        event: 'message_sent',
        detail: { templateId: node.templateId, to: toField || 'Current conversation contact', resolvedRecipient: recipientJid, next: node.next ?? null, bodyPreview: body.slice(0, 300) },
      })
      const next = node.next
      if (!next) {
        await patchState({ status: 'completed', current_node_id: current, variables })
        return
      }
      const nextNode = args.graph.nodes[next]
      if (!nextNode || nextNode.type === 'end') {
        await patchState({ status: 'completed', current_node_id: next, variables })
        return
      }
      current = next
      await patchState({ status: 'running', current_node_id: current, variables })
      continue
      }
      if (node.type === 'condition') {
      const contactVars = await loadContactVars(admin, args.contactId)
      const value = readVariable(node.variable, toTemplateVars({ ...contactVars, ...variables }))
      const matches =
        node.operator === 'exists'
          ? Boolean(value)
          : node.operator === 'contains'
            ? value.toLowerCase().includes(String(node.value ?? '').toLowerCase())
            : value === String(node.value ?? '')
      const next = matches ? node.trueNext : node.falseNext
      variables = appendTrace(variables, {
        nodeId: current,
        nodeType: node.type,
        event: 'condition_evaluated',
        detail: {
          variable: node.variable,
          operator: node.operator,
          expected: node.value ?? null,
          actual: value,
          passed: matches,
          next: next ?? null,
        },
      })
      if (!next) {
        await patchState({ status: 'completed', current_node_id: current, variables })
        return
      }
      current = next
      await patchState({ status: 'running', current_node_id: current, variables })
      continue
      }
      if (node.type === 'updateContact') {
      if (!args.contactId) {
        await patchState({ status: 'failed', current_node_id: current, error: 'Update contact node requires a contact' })
        return
      }
      const { data: contact } = await admin.from('contacts').select('metadata').eq('id', args.contactId).maybeSingle()
      const metadata =
        contact?.metadata && typeof contact.metadata === 'object' && !Array.isArray(contact.metadata)
          ? (contact.metadata as Record<string, unknown>)
          : {}
      await admin
        .from('contacts')
        .update({ metadata: { ...metadata, [node.path]: applyTemplateVars(node.value, toTemplateVars(variables)) } })
        .eq('id', args.contactId)
      variables = appendTrace(variables, {
        nodeId: current,
        nodeType: node.type,
        event: 'contact_updated',
        detail: { path: node.path, next: node.next ?? null },
      })
      if (!node.next) {
        await patchState({ status: 'completed', current_node_id: current, variables })
        return
      }
      current = node.next
      await patchState({ status: 'running', current_node_id: current, variables })
      continue
      }
      if (node.type === 'assignConversation') {
      if (args.conversationId) {
        await admin
          .from('conversations')
          .update({ assignee: applyTemplateVars(node.assignee, toTemplateVars(variables)) })
          .eq('id', args.conversationId)
      }
      variables = appendTrace(variables, {
        nodeId: current,
        nodeType: node.type,
        event: 'conversation_assigned',
        detail: { assignee: applyTemplateVars(node.assignee, toTemplateVars(variables)), next: node.next ?? null },
      })
      if (!node.next) {
        await patchState({ status: 'completed', current_node_id: current, variables })
        return
      }
      current = node.next
      await patchState({ status: 'running', current_node_id: current, variables })
      continue
      }
      if (node.type === 'delayUntil') {
      variables[`delay.${current}.until`] = applyTemplateVars(node.until, toTemplateVars(variables))
      variables = appendTrace(variables, {
        nodeId: current,
        nodeType: node.type,
        event: 'paused_until',
        detail: { until: variables[`delay.${current}.until`], next: node.next ?? null },
      })
      await patchState({ status: 'paused', current_node_id: current, variables })
      return
      }
      if (node.type === 'webhookResponse') {
      variables.webhookResponse = applyTemplateVars(node.body ?? '', toTemplateVars(variables))
      variables = appendTrace(variables, {
        nodeId: current,
        nodeType: node.type,
        event: 'webhook_response_prepared',
        detail: { bodyPreview: String(variables.webhookResponse).slice(0, 300), next: node.next ?? null },
      })
      if (!node.next) {
        await patchState({ status: 'completed', current_node_id: current, variables })
        return
      }
      current = node.next
      await patchState({ status: 'running', current_node_id: current, variables })
      continue
      }
      if (node.type === 'aiSkill') {
      const output = await runAiSkill(node.instructions, toTemplateVars(variables))
      const key = node.outputVariable || `skill.${current}.output`
      variables[key] = output
      if (node.sendAsMessage) {
        if (!args.contactId || !args.contactJid || !args.sock) {
          await patchState({ status: 'failed', current_node_id: current, error: 'AI skill send requires a connected WhatsApp contact' })
          return
        }
        await args.sock.sendMessage(args.contactJid, { text: output })
        await admin.from('message_events').insert({
          workspace_id: args.workspaceId,
          contact_id: args.contactId,
          conversation_id: args.conversationId ?? null,
          direction: 'outbound',
          wa_chat_jid: args.contactJid,
          body: output,
          automation_id: args.automationId,
          node_id: current,
        })
      }
      variables = appendTrace(variables, {
        nodeId: current,
        nodeType: node.type,
        event: 'ai_skill_completed',
        detail: { outputVariable: key, sentAsMessage: Boolean(node.sendAsMessage), outputPreview: output.slice(0, 300), next: node.next ?? null },
      })
      if (!node.next) {
        await patchState({ status: 'completed', current_node_id: current, variables })
        return
      }
      current = node.next
      await patchState({ status: 'running', current_node_id: current, variables })
      continue
      }
      return
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Automation node execution failed'
      variables = appendTrace(variables, {
        nodeId: current,
        nodeType: 'runtime',
        event: 'failed',
        detail: { error: message },
      })
      await patchState({ status: 'failed', current_node_id: current, variables, error: message })
      return
    }
  }
}
