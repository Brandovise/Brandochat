import crypto from 'node:crypto'
import { Router } from 'express'
import { routeTrigger } from '../flow/triggerRouter.js'
import { getCalendlyScheduledEvent } from '../integration/calendly/client.js'
import { extractInviteePhone, normalizePhone, toCalendlyTriggerPayload } from '../integration/calendly/mapper.js'
import { verifyCalendlySignature } from '../integration/calendly/signature.js'
import { asyncHandler } from '../http/async-handler.js'
import { getServiceRoleClient } from '../lib/supabase-clients.js'

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function toPhoneDigits(phoneE164: string): string {
  return phoneE164.replace(/[^\d]/g, '')
}

function jidFromPhone(phoneE164: string): string {
  return `${toPhoneDigits(phoneE164)}@s.whatsapp.net`
}

function readHeaderString(value: unknown): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return typeof value === 'string' ? value : ''
}

function readDeliveryId(headers: Record<string, unknown>): string {
  return (
    readHeaderString(headers['x-calendly-delivery']) ||
    readHeaderString(headers['x-calendly-webhook-delivery-id']) ||
    readHeaderString(headers['x-request-id']) ||
    ''
  )
}

function toIdempotencyKey(workspaceId: string, deliveryId: string, rawBody: string): string {
  if (deliveryId) return `delivery:${workspaceId}:${deliveryId}`
  return `hash:${workspaceId}:${crypto.createHash('sha256').update(rawBody).digest('hex')}`
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function addIntegrationLog(args: {
  workspaceId: string
  integrationId?: string | null
  level: 'debug' | 'info' | 'warn' | 'error'
  action: string
  message: string
  context?: Record<string, unknown>
}) {
  const admin = getServiceRoleClient()
  await admin.from('workspace_integration_logs').insert({
    workspace_id: args.workspaceId,
    integration_id: args.integrationId ?? null,
    provider: 'calendly',
    level: args.level,
    action: args.action,
    message: args.message,
    context: args.context ?? {},
    source: 'backend',
  })
}

async function resolveOrCreateContact(args: {
  workspaceId: string
  inviteePhone: string
  inviteeName: string
  inviteeEmail: string
  payload: Record<string, unknown>
}): Promise<{ contactId: string; contactJid: string }> {
  const admin = getServiceRoleClient()
  const { data: existing } = await admin
    .from('contacts')
    .select('id, wa_jid')
    .eq('workspace_id', args.workspaceId)
    .eq('phone_e164', args.inviteePhone)
    .limit(1)
    .maybeSingle()
  if (existing?.id && existing.wa_jid) {
    return { contactId: existing.id as string, contactJid: existing.wa_jid as string }
  }

  const now = new Date().toISOString()
  const metadata = {
    source: 'calendly',
    calendly_invitee_email: args.inviteeEmail || null,
    calendly_last_payload: args.payload,
    calendly_contact_created_at: now,
  }
  const waJid = jidFromPhone(args.inviteePhone)
  const { data: created, error } = await admin
    .from('contacts')
    .insert({
      workspace_id: args.workspaceId,
      wa_jid: waJid,
      phone_e164: args.inviteePhone,
      display_name: args.inviteeName || null,
      metadata,
    })
    .select('id, wa_jid')
    .single()
  if (error || !created) throw new Error(error?.message ?? 'Failed to create contact from Calendly event')
  return { contactId: created.id as string, contactJid: created.wa_jid as string }
}

export function createCalendlyWebhookRouter(): Router {
  const router = Router({ mergeParams: true })

  router.post(
    '/:workspaceId',
    asyncHandler(async (req, res) => {
      const workspaceId = String(req.params.workspaceId || '').trim()
      if (!workspaceId) {
        res.status(400).json({ error: 'workspaceId is required' })
        return
      }
      const rawBody = typeof (req as { rawBody?: string }).rawBody === 'string' ? ((req as { rawBody?: string }).rawBody as string) : ''
      const body = toObject(req.body)
      const headers = req.headers as Record<string, unknown>
      const admin = getServiceRoleClient()

      const { data: integration } = await admin
        .from('workspace_integrations')
        .select('id, settings, credentials')
        .eq('workspace_id', workspaceId)
        .eq('provider', 'calendly')
        .maybeSingle()
      const integrationId = (integration?.id as string | undefined) ?? null
      const settings = toObject(integration?.settings)
      const credentials = toObject(integration?.credentials)

      const deliveryId = readDeliveryId(headers)
      const idempotencyKey = toIdempotencyKey(workspaceId, deliveryId, rawBody || JSON.stringify(body))
      const eventName = typeof body.event === 'string' ? body.event : 'unknown'
      const occurredAt = typeof body.created_at === 'string' ? body.created_at : new Date().toISOString()

      const signingKey = (settings.calendly_signing_key as string | undefined) ?? ''
      const signatureHeader = readHeaderString(headers['calendly-webhook-signature'])
      const signatureValid = signingKey ? verifyCalendlySignature({ signingKey, signatureHeader, rawBody: rawBody || JSON.stringify(body) }) : true

      const { data: eventRow, error: eventErr } = await admin
        .from('calendly_webhook_events')
        .insert({
          workspace_id: workspaceId,
          integration_id: integrationId,
          event: eventName,
          payload: body,
          headers: req.headers,
          signature_valid: signatureValid,
          delivery_id: deliveryId || null,
          idempotency_key: idempotencyKey,
          occurred_at: occurredAt,
          processing_status: 'received',
        })
        .select('id')
        .single()

      if (eventErr && eventErr.code === '23505') {
        res.json({ ok: true, duplicate: true })
        return
      }
      if (eventErr || !eventRow) throw new Error(eventErr?.message ?? 'Failed to persist Calendly webhook event')

      if (!signatureValid) {
        await admin
          .from('calendly_webhook_events')
          .update({ processing_status: 'failed', error: 'Invalid signature', processed_at: new Date().toISOString() })
          .eq('id', eventRow.id)
        await addIntegrationLog({
          workspaceId,
          integrationId,
          level: 'error',
          action: 'calendly_webhook_rejected',
          message: 'Rejected Calendly webhook due to invalid signature.',
        })
        res.status(401).json({ error: 'Invalid Calendly signature' })
        return
      }

      const triggerPayload = toCalendlyTriggerPayload(body)
      const token = typeof credentials.api_key === 'string' ? credentials.api_key : typeof credentials.access_token === 'string' ? credentials.access_token : ''
      const eventUri = typeof triggerPayload.eventUri === 'string' ? triggerPayload.eventUri : ''
      let meetingJoinUrl = typeof triggerPayload.meetingJoinUrl === 'string' ? triggerPayload.meetingJoinUrl : ''
      const initialLocationStatus = toObject(toObject(body.payload).scheduled_event).location
      const locationStatus = typeof toObject(initialLocationStatus).status === 'string' ? String(toObject(initialLocationStatus).status) : ''
      const needsJoinUrlEnrichment = Boolean(token && eventUri && (!meetingJoinUrl || locationStatus.toLowerCase() === 'processing'))

      if (needsJoinUrlEnrichment) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const eventResource = await getCalendlyScheduledEvent(token, eventUri)
            const joinUrl = toObject(eventResource.location).join_url
            if (typeof joinUrl === 'string' && joinUrl.trim()) {
              meetingJoinUrl = joinUrl.trim()
              triggerPayload.meetingJoinUrl = meetingJoinUrl
              break
            }
          } catch {
            // Best-effort enrichment only. Continue with original webhook payload.
          }
          await sleep(1500)
        }
      }
      const inviteePhone = normalizePhone(extractInviteePhone(body))
      let contactId: string | undefined
      let contactJid: string | undefined
      if (inviteePhone) {
        const contact = await resolveOrCreateContact({
          workspaceId,
          inviteePhone,
          inviteeName: String(triggerPayload.inviteeName ?? ''),
          inviteeEmail: String(triggerPayload.inviteeEmail ?? ''),
          payload: body,
        })
        contactId = contact.contactId
        contactJid = contact.contactJid

        const { data: contactRow } = await admin.from('contacts').select('metadata').eq('id', contactId).maybeSingle()
        const metadata = toObject(contactRow?.metadata)
        await admin
          .from('contacts')
          .update({
            metadata: {
              ...metadata,
              meeting_datetime: triggerPayload.meetingStart ?? null,
              meeting_end_datetime: triggerPayload.meetingEnd ?? null,
              last_calendly_event: eventName,
              last_calendly_event_at: occurredAt,
            },
          })
          .eq('id', contactId)
      }

      await routeTrigger(admin, {
        workspaceId,
        type: 'calendly.event',
        contactId,
        contactJid,
        payload: {
          ...triggerPayload,
          meetingJoinUrl,
          calendlyDeliveryId: deliveryId || null,
          calendlyEventId: body.event as string | undefined,
        },
      })

      await admin
        .from('calendly_webhook_events')
        .update({ processing_status: 'processed', processed_at: new Date().toISOString() })
        .eq('id', eventRow.id)
      await addIntegrationLog({
        workspaceId,
        integrationId,
        level: 'info',
        action: 'calendly_webhook_processed',
        message: `Processed Calendly event ${eventName}.`,
        context: {
          deliveryId: deliveryId || null,
          contactId: contactId ?? null,
          inviteePhone: inviteePhone || null,
        },
      })

      res.json({ ok: true })
    }),
  )

  return router
}
