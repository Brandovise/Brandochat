import { Router } from 'express'
import { downloadMediaMessage, type WAMessage } from '@whiskeysockets/baileys'
import pino from 'pino'
import { parseGraph } from '../flow/graphRuntime.js'
import { executeAutomationRun } from '../flow/runAutomation.js'
import type { AutomationRunRow } from '../flow/types.js'
import { asyncHandler } from '../http/async-handler.js'
import { createUserClient } from '../lib/supabase-clients.js'
import { requireWorkspaceMember } from '../middleware/workspace-auth.middleware.js'
import { readWorkspaceId, type AuthenticatedWorkspaceRequest } from '../types/express.js'
import { resolveConversation } from '../wa/conversations.js'
import {
  disconnectWorkspace,
  ensureWorkspaceSocket,
  ensureWorkspaceWhatsAppConnected,
  getConnectedWorkspaceSocket,
  getQr,
  getSession,
  requestChatHistorySync,
  requestWorkspaceHistorySync,
  sendWorkspaceTextMessage,
} from '../wa/baileysSession.js'

function readSettings(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}

async function getOrCreateDefaultInstance(workspaceId: string, accessToken: string) {
  const db = createUserClient(accessToken)
  const { data: existing } = await db
    .from('whatsapp_instances')
    .select('id, display_name, pairing_status, phone_label, last_error, is_default, created_at, settings')
    .eq('workspace_id', workspaceId)
    .eq('is_default', true)
    .maybeSingle()

  if (existing) return existing

  const { data: first } = await db
    .from('whatsapp_instances')
    .select('id, display_name, pairing_status, phone_label, last_error, is_default, created_at, settings')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (first) {
    await db.from('whatsapp_instances').update({ is_default: true }).eq('id', first.id)
    return { ...first, is_default: true }
  }

  const { data: created, error } = await db
    .from('whatsapp_instances')
    .insert({
      workspace_id: workspaceId,
      display_name: 'Primary WhatsApp',
      pairing_status: 'disconnected',
      is_default: true,
      settings: {
        always_sync_history: true,
        skip_phone_notifications: false,
      },
    })
    .select('id, display_name, pairing_status, phone_label, last_error, is_default, created_at, settings')
    .single()

  if (error || !created) {
    throw new Error(error?.message ?? 'Failed to create WhatsApp instance')
  }
  return created
}

export function createWaRouter(): Router {
  const mediaLogger = pino({ level: 'error' })
  const router = Router({ mergeParams: true })
  router.use(requireWorkspaceMember)

  router.get(
    '/instances',
    asyncHandler(async (req, res) => {
      const authed = req as AuthenticatedWorkspaceRequest
      const workspaceId = readWorkspaceId(req)
      const db = createUserClient(authed.accessToken)
      const { data, error } = await db
        .from('whatsapp_instances')
        .select('id, display_name, pairing_status, phone_label, last_error, is_default, created_at, settings')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: true })

      if (error) throw new Error(error.message)

      res.json({
        instances: (data ?? []).map((instance) => {
          const session = getSession(instance.id as string)
          const hasLiveSocket = Boolean(session?.sock)
          return {
            ...instance,
            pairing_status: session?.pairing_status ?? (instance.pairing_status === 'connected' ? 'disconnected' : instance.pairing_status),
            qr: getQr(instance.id as string),
            sync: session?.sync ?? null,
            last_error:
              session?.lastError ??
              (!hasLiveSocket && instance.pairing_status === 'connected'
                ? 'Backend restarted. Click Start / refresh to restore the WhatsApp session.'
                : instance.last_error),
          }
        }),
      })
    }),
  )

  router.post(
    '/instances',
    asyncHandler(async (req, res) => {
      const authed = req as AuthenticatedWorkspaceRequest
      const workspaceId = readWorkspaceId(req)
      const body = req.body as { displayName?: string }
      const db = createUserClient(authed.accessToken)
      const { count } = await db
        .from('whatsapp_instances')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)

      const { data, error } = await db
        .from('whatsapp_instances')
        .insert({
          workspace_id: workspaceId,
          display_name: body.displayName?.trim() || `WhatsApp ${(count ?? 0) + 1}`,
          pairing_status: 'disconnected',
          is_default: (count ?? 0) === 0,
          settings: {
            always_sync_history: true,
            skip_phone_notifications: false,
          },
        })
        .select('id, display_name, pairing_status, phone_label, last_error, is_default, created_at, settings')
        .single()

      if (error || !data) throw new Error(error?.message ?? 'Failed to create WhatsApp instance')
      res.json({ instance: data })
    }),
  )

  router.post(
    '/instances/:instanceId/settings',
    asyncHandler(async (req, res) => {
      const authed = req as AuthenticatedWorkspaceRequest
      const workspaceId = readWorkspaceId(req)
      const instanceId = String(req.params.instanceId)
      const body = req.body as { always_sync_history?: boolean; skip_phone_notifications?: boolean }
      const db = createUserClient(authed.accessToken)
      const { data: current, error: currentErr } = await db
        .from('whatsapp_instances')
        .select('settings')
        .eq('workspace_id', workspaceId)
        .eq('id', instanceId)
        .single()
      if (currentErr || !current) {
        res.status(404).json({ error: 'WhatsApp instance not found' })
        return
      }
      const settings = {
        ...readSettings(current.settings),
        always_sync_history: body.always_sync_history !== false,
        skip_phone_notifications: body.skip_phone_notifications === true,
      }
      const { error: updateErr } = await db.from('whatsapp_instances').update({ settings }).eq('id', instanceId)
      if (updateErr) throw new Error(updateErr.message)
      res.json({ ok: true, settings })
    }),
  )

  router.post(
    '/instances/:instanceId/connect',
    asyncHandler(async (req, res) => {
      const workspaceId = readWorkspaceId(req)
      const instanceId = String(req.params.instanceId)
      await ensureWorkspaceSocket(workspaceId, instanceId)
      res.json({ ok: true })
    }),
  )

  router.post(
    '/instances/:instanceId/disconnect',
    asyncHandler(async (req, res) => {
      await disconnectWorkspace(String(req.params.instanceId))
      res.json({ ok: true })
    }),
  )

  router.post(
    '/instances/:instanceId/sync',
    asyncHandler(async (req, res) => {
      const workspaceId = readWorkspaceId(req)
      try {
        await requestWorkspaceHistorySync(workspaceId, String(req.params.instanceId))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to sync WhatsApp history'
        if (message.includes('must be connected')) {
          res.status(409).json({ error: message })
          return
        }
        throw error
      }
      res.json({ ok: true })
    }),
  )

  router.post(
    '/instances/:instanceId/chats/:contactId/sync',
    asyncHandler(async (req, res) => {
      const authed = req as AuthenticatedWorkspaceRequest
      const workspaceId = readWorkspaceId(req)
      const db = createUserClient(authed.accessToken)
      const { data: contact, error: contactError } = await db
        .from('contacts')
        .select('wa_jid')
        .eq('workspace_id', workspaceId)
        .eq('id', String(req.params.contactId))
        .single()

      if (contactError || !contact?.wa_jid) {
        res.status(404).json({ error: 'Contact not found in this workspace' })
        return
      }

      let result: Awaited<ReturnType<typeof requestChatHistorySync>>
      try {
        result = await requestChatHistorySync({
          workspaceId,
          instanceId: String(req.params.instanceId),
          contactJid: contact.wa_jid as string,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to sync chat history'
        if (message.includes('must be connected') || message.includes('No stored message cursor')) {
          res.status(409).json({ error: message })
          return
        }
        throw error
      }

      res.json({ ok: true, ...result })
    }),
  )

  router.get(
    '/media/:messageEventId',
    asyncHandler(async (req, res) => {
      const authed = req as AuthenticatedWorkspaceRequest
      const workspaceId = readWorkspaceId(req)
      const messageEventId = String(req.params.messageEventId)
      const db = createUserClient(authed.accessToken)
      const { data: eventRow, error } = await db
        .from('message_events')
        .select('raw')
        .eq('workspace_id', workspaceId)
        .eq('id', messageEventId)
        .maybeSingle()
      if (error || !eventRow?.raw) {
        res.status(404).json({ error: 'Message not found' })
        return
      }

      await ensureWorkspaceWhatsAppConnected(workspaceId).catch(() => false)
      const sock = getConnectedWorkspaceSocket(workspaceId)
      if (!sock) {
        res.status(409).json({ error: 'WhatsApp is not connected for media fetch' })
        return
      }

      const raw = eventRow.raw as Record<string, unknown>
      const message = (raw as { message?: unknown }).message
      if (!message || typeof message !== 'object') {
        res.status(400).json({ error: 'Message has no media payload' })
        return
      }

      const mediaMessage = raw as unknown as WAMessage
      const mediaBuffer = await downloadMediaMessage(
        mediaMessage,
        'buffer',
        {},
        {
          logger: mediaLogger,
          reuploadRequest: sock.updateMediaMessage,
        },
      ).catch(() => null)
      if (!mediaBuffer || !(mediaBuffer instanceof Buffer)) {
        res.status(404).json({ error: 'Media payload unavailable' })
        return
      }

      const image = (message as Record<string, unknown>).imageMessage as { mimetype?: string } | undefined
      const video = (message as Record<string, unknown>).videoMessage as { mimetype?: string } | undefined
      const mimeType = image?.mimetype || video?.mimetype || 'application/octet-stream'
      res.setHeader('Content-Type', mimeType)
      res.setHeader('Cache-Control', 'private, max-age=60')
      res.send(mediaBuffer)
    }),
  )

  router.post(
    '/connect',
    asyncHandler(async (req, res) => {
      const authed = req as AuthenticatedWorkspaceRequest
      const workspaceId = readWorkspaceId(req)
      const instance = await getOrCreateDefaultInstance(workspaceId, authed.accessToken)
      await ensureWorkspaceSocket(workspaceId, instance.id as string)
      res.json({ ok: true })
    }),
  )

  router.get(
    '/status',
    asyncHandler(async (req, res) => {
      const authed = req as AuthenticatedWorkspaceRequest
      const workspaceId = readWorkspaceId(req)
      const instance = await getOrCreateDefaultInstance(workspaceId, authed.accessToken)
      const session = getSession(instance.id as string)
      const qr = getQr(instance.id as string)
      res.json({
        pairing_status: session?.pairing_status ?? 'disconnected',
        qr,
        phone_label: session?.phoneLabel ?? null,
        last_error: session?.lastError ?? null,
      })
    }),
  )

  router.post(
    '/disconnect',
    asyncHandler(async (req, res) => {
      const authed = req as AuthenticatedWorkspaceRequest
      const workspaceId = readWorkspaceId(req)
      const instance = await getOrCreateDefaultInstance(workspaceId, authed.accessToken)
      await disconnectWorkspace(instance.id as string)
      res.json({ ok: true })
    }),
  )

  router.post(
    '/send',
    asyncHandler(async (req, res) => {
      const authed = req as AuthenticatedWorkspaceRequest
      const workspaceId = readWorkspaceId(req)
      const body = req.body as { contactId?: string; text?: string; instanceId?: string }
      const contactId = body.contactId?.trim()
      const text = body.text?.trim()

      if (!contactId || !text) {
        res.status(400).json({ error: 'contactId and text are required' })
        return
      }

      const db = createUserClient(authed.accessToken)
      const { data: contact, error: contactError } = await db
        .from('contacts')
        .select('id, wa_jid, metadata')
        .eq('workspace_id', workspaceId)
        .eq('id', contactId)
        .single()

      if (contactError || !contact) {
        res.status(404).json({ error: 'Contact not found in this workspace' })
        return
      }

      const sentAt = new Date().toISOString()
      const conversation = await resolveConversation(db, {
        workspaceId,
        contactId: contact.id as string,
        contactJid: contact.wa_jid as string,
        instanceId: body.instanceId,
        messageAt: sentAt,
      })
      let sent: { waMessageId: string | null }
      try {
        sent = await sendWorkspaceTextMessage({
          workspaceId,
          instanceId: body.instanceId,
          jid: contact.wa_jid as string,
          text,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to send WhatsApp message'
        if (message.includes('not connected')) {
          res.status(409).json({ error: message })
          return
        }
        throw error
      }

      await db.from('message_events').insert({
        workspace_id: workspaceId,
        whatsapp_instance_id: body.instanceId ?? null,
        contact_id: contact.id,
        conversation_id: conversation.conversationId,
        direction: 'outbound',
        wa_message_id: sent.waMessageId,
        wa_chat_jid: contact.wa_jid,
        body: text,
        created_at: sentAt,
      })

      const metadata =
        contact.metadata && typeof contact.metadata === 'object' && !Array.isArray(contact.metadata)
          ? (contact.metadata as Record<string, unknown>)
          : {}
      await db
        .from('contacts')
        .update({
          metadata: {
            ...metadata,
            wa_last_message_at: sentAt,
            wa_last_message_body: text,
          },
        })
        .eq('id', contact.id)

      res.json({ ok: true, wa_message_id: sent.waMessageId })
    }),
  )

  router.post(
    '/automations/:automationId/test-run',
    asyncHandler(async (req, res) => {
      const authed = req as AuthenticatedWorkspaceRequest
      const workspaceId = readWorkspaceId(req)
      const automationId = String(req.params.automationId)
      const body = req.body as { contactId?: string; instanceId?: string; mode?: 'run_now' | 'wait_for_message' }
      const contactId = body.contactId?.trim()

      if (!contactId) {
        res.status(400).json({ error: 'contactId is required' })
        return
      }

      const db = createUserClient(authed.accessToken)
      const { data: automation, error: automationError } = await db
        .from('automations')
        .select('id, entry_node_id, graph')
        .eq('workspace_id', workspaceId)
        .eq('id', automationId)
        .single()

      if (automationError || !automation) {
        res.status(404).json({ error: 'Automation not found in this workspace' })
        return
      }

      const graph = parseGraph(automation.graph)
      if (!graph) {
        res.status(400).json({ error: 'Automation graph is invalid' })
        return
      }

      const { data: contact, error: contactError } = await db
        .from('contacts')
        .select('id, wa_jid')
        .eq('workspace_id', workspaceId)
        .eq('id', contactId)
        .single()

      if (contactError || !contact?.wa_jid) {
        res.status(404).json({ error: 'Contact not found in this workspace' })
        return
      }

      const { data: instances, error: instanceError } = await db
        .from('whatsapp_instances')
        .select('id, is_default, pairing_status')
        .eq('workspace_id', workspaceId)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: true })

      if (instanceError) throw new Error(instanceError.message)

      const instanceId =
        body.instanceId ??
        (instances ?? []).find((instance) => getSession(instance.id as string)?.sock)?.id ??
        (instances ?? []).find((instance) => instance.pairing_status === 'connected')?.id ??
        (instances ?? [])[0]?.id

      if (!instanceId) {
        res.status(409).json({ error: 'No WhatsApp number is available for this workspace' })
        return
      }

      await ensureWorkspaceSocket(workspaceId, instanceId as string)
      const session = getSession(instanceId as string)
      if (!session?.sock) {
        res.status(409).json({ error: 'WhatsApp is not connected. Start or refresh the number, then try the test run again.' })
        return
      }

      const now = new Date().toISOString()
      const currentNodeId = (automation.entry_node_id as string | null) || graph.entry
      const mode = body.mode ?? 'run_now'

      if (mode === 'wait_for_message') {
        const { data: run, error: runError } = await db
          .from('automation_runs')
          .insert({
            workspace_id: workspaceId,
            automation_id: automation.id,
            contact_id: contact.id,
            conversation_id: null,
            current_node_id: currentNodeId,
            status: 'paused',
            variables: {
              triggerType: 'manual.wait',
              testRun: true,
              whatsappInstanceId: instanceId,
              executionTrace: [
                {
                  at: now,
                  nodeId: currentNodeId,
                  nodeType: 'trigger',
                  event: 'manual_wait_armed',
                  detail: {
                    contactJid: contact.wa_jid,
                    instruction: 'Waiting for the next inbound WhatsApp message from this contact.',
                  },
                },
              ],
            },
            trigger_type: 'manual.wait',
            trigger_payload: { contactId: contact.id, contactJid: contact.wa_jid, testRun: true, mode },
          })
          .select('id')
          .single()

        if (runError || !run) throw new Error(runError?.message ?? 'Failed to arm automation test run')
        res.json({ ok: true, runId: run.id, mode })
        return
      }

      const conversation = await resolveConversation(db, {
        workspaceId,
        contactId: contact.id as string,
        contactJid: contact.wa_jid as string,
        instanceId: instanceId as string,
        messageAt: now,
      })
      const variables = {
        triggerType: 'manual.test',
        testRun: true,
        whatsappInstanceId: instanceId,
        executionTrace: [
          {
            at: now,
            nodeId: currentNodeId,
            nodeType: 'trigger',
            event: 'manual_test_started',
            detail: {
              contactJid: contact.wa_jid,
              conversationId: conversation.conversationId,
            },
          },
        ],
      }

      const { data: run, error: runError } = await db
        .from('automation_runs')
        .insert({
          workspace_id: workspaceId,
          automation_id: automation.id,
          contact_id: contact.id,
          conversation_id: conversation.conversationId,
          current_node_id: currentNodeId,
          status: 'running',
          variables,
          trigger_type: 'manual.test',
          trigger_payload: { contactId: contact.id, contactJid: contact.wa_jid, testRun: true },
        })
        .select('id, workspace_id, automation_id, contact_id, conversation_id, current_node_id, status, variables, trigger_type, trigger_payload')
        .single()

      if (runError || !run) throw new Error(runError?.message ?? 'Failed to create test automation run')

      await executeAutomationRun(db, {
        workspaceId,
        contactId: contact.id as string,
        contactJid: contact.wa_jid as string,
        conversationId: conversation.conversationId,
        automationId: automation.id as string,
        graph,
        run: run as AutomationRunRow,
        sock: session.sock,
      })

      res.json({ ok: true, runId: run.id })
    }),
  )

  return router
}
