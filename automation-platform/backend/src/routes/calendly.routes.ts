import { Router } from 'express'
import { asyncHandler } from '../http/async-handler.js'
import {
  CalendlyApiError,
  createCalendlyWebhookSubscription,
  getCalendlyCurrentUser,
  listCalendlyWebhookSubscriptions,
  type CalendlyEventType,
  type CalendlyScope,
  type CalendlyWebhookResource,
} from '../integration/calendly/client.js'
import { createUserClient } from '../lib/supabase-clients.js'
import { requireWorkspaceMember } from '../middleware/workspace-auth.middleware.js'
import type { AuthenticatedWorkspaceRequest } from '../types/express.js'

const ALLOWED_EVENTS: CalendlyEventType[] = [
  'invitee.created',
  'invitee.canceled',
  'invitee_no_show.created',
  'invitee_no_show.deleted',
  'event_type.created',
  'event_type.deleted',
  'event_type.updated',
  'routing_form_submission.created',
]

function readScope(raw: unknown): CalendlyScope {
  if (raw === 'organization' || raw === 'user' || raw === 'group') return raw
  throw new Error('scope must be one of: organization, user, group')
}

function readEvents(raw: unknown): CalendlyEventType[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('events is required')
  const events = raw
    .map((item) => (typeof item === 'string' ? item : ''))
    .filter((item): item is CalendlyEventType => ALLOWED_EVENTS.includes(item as CalendlyEventType))
  if (events.length === 0) throw new Error('No valid Calendly events selected')
  return [...new Set(events)]
}

async function addIntegrationLog(args: {
  accessToken: string
  workspaceId: string
  integrationId?: string | null
  provider?: 'calendly'
  level: 'debug' | 'info' | 'warn' | 'error'
  action: string
  message: string
  context?: Record<string, unknown>
  source?: 'backend' | 'frontend'
}) {
  const db = createUserClient(args.accessToken)
  await db.from('workspace_integration_logs').insert({
    workspace_id: args.workspaceId,
    integration_id: args.integrationId ?? null,
    provider: args.provider ?? 'calendly',
    level: args.level,
    action: args.action,
    message: args.message,
    context: args.context ?? {},
    source: args.source ?? 'backend',
  })
}

export function createCalendlyRouter(): Router {
  const router = Router({ mergeParams: true })
  router.use(requireWorkspaceMember)

  router.post(
    '/connect',
    asyncHandler(async (req, res) => {
      const authed = req as AuthenticatedWorkspaceRequest
      const workspaceId = authed.params.workspaceId
      const body = req.body as { personalToken?: string; displayName?: string }
      const token = body.personalToken?.trim()
      if (!token) {
        res.status(400).json({ error: 'personalToken is required' })
        return
      }

      const user = await getCalendlyCurrentUser(token)
      const db = createUserClient(authed.accessToken)
      const payload = {
        workspace_id: workspaceId,
        provider: 'calendly',
        display_name: body.displayName?.trim() || 'Calendly',
        auth_type: 'api_key',
        status: 'active',
        credentials: { api_key: token },
        settings: {
          current_user_uri: user.uri,
          organization_uri: user.current_organization,
          email: user.email,
          name: user.name,
        },
        created_by: authed.userId,
      }

      const { data, error } = await db
        .from('workspace_integrations')
        .upsert(payload, { onConflict: 'workspace_id,provider' })
        .select('id, provider, auth_type, status, settings, updated_at')
        .single()
      if (error || !data) throw new Error(error?.message ?? 'Failed to save Calendly integration')

      await addIntegrationLog({
        accessToken: authed.accessToken,
        workspaceId,
        integrationId: data.id as string,
        level: 'info',
        action: 'calendly_connect',
        message: 'Calendly token saved and user/org discovered.',
        context: {
          organization: user.current_organization,
          user: user.uri,
        },
      })

      res.json({
        integration: data,
        profile: {
          user_uri: user.uri,
          email: user.email,
          name: user.name,
          organization_uri: user.current_organization,
        },
      })
    }),
  )

  router.post(
    '/webhooks/create',
    asyncHandler(async (req, res) => {
      const authed = req as AuthenticatedWorkspaceRequest
      const workspaceId = authed.params.workspaceId
      const body = req.body as {
        callbackUrl?: string
        scope?: CalendlyScope
        events?: CalendlyEventType[]
        organization?: string
        user?: string
        group?: string
        signingKey?: string
      }
      const callbackUrl = body.callbackUrl?.trim()
      if (!callbackUrl) {
        res.status(400).json({ error: 'callbackUrl is required' })
        return
      }
      const scope = readScope(body.scope)
      const events = readEvents(body.events)
      if (events.includes('routing_form_submission.created') && scope !== 'organization') {
        res.status(400).json({ error: 'routing_form_submission.created requires organization scope' })
        return
      }

      const db = createUserClient(authed.accessToken)
      const { data: integration, error: integrationErr } = await db
        .from('workspace_integrations')
        .select('id, credentials, settings')
        .eq('workspace_id', workspaceId)
        .eq('provider', 'calendly')
        .single()
      if (integrationErr || !integration) {
        res.status(404).json({ error: 'Calendly integration not found. Connect token first.' })
        return
      }
      const credentials =
        integration.credentials && typeof integration.credentials === 'object' && !Array.isArray(integration.credentials)
          ? (integration.credentials as Record<string, unknown>)
          : {}
      const settings =
        integration.settings && typeof integration.settings === 'object' && !Array.isArray(integration.settings)
          ? (integration.settings as Record<string, unknown>)
          : {}
      const token = (credentials.api_key ?? credentials.access_token) as string | undefined
      if (!token) {
        res.status(400).json({ error: 'Calendly token is missing. Reconnect integration.' })
        return
      }

      const organization = body.organization?.trim() || (settings.organization_uri as string | undefined)
      if (!organization) {
        res.status(400).json({ error: 'organization URI is required' })
        return
      }

      const userUri = body.user?.trim() || undefined
      const groupUri = body.group?.trim() || undefined

      let resource: CalendlyWebhookResource
      let duplicate = false
      try {
        resource = await createCalendlyWebhookSubscription(token, {
          url: callbackUrl,
          events,
          scope,
          organization,
          user: userUri,
          group: groupUri,
          signing_key: body.signingKey?.trim() || undefined,
        })
      } catch (error) {
        const isDuplicate =
          error instanceof CalendlyApiError &&
          error.status === 409 &&
          error.message.toLowerCase().includes('hook with this url already exists')
        if (!isDuplicate) throw error

        const remote = await listCalendlyWebhookSubscriptions(token, organization)
        const matched = remote.find((item) => {
          if (item.callback_url !== callbackUrl) return false
          if (item.scope !== scope) return false
          if (scope === 'user' && item.user !== (userUri ?? null)) return false
          if (scope === 'group' && item.group !== (groupUri ?? null)) return false
          return true
        })
        if (!matched) {
          res.status(409).json({ error: 'Calendly already has a webhook for this callback URL. Use a different URL/scope or delete the existing one in Calendly.' })
          return
        }
        resource = matched
        duplicate = true
      }

      const { data: webhookRow, error: webhookErr } = await db
        .from('workspace_calendly_webhooks')
        .upsert(
          {
            workspace_id: workspaceId,
            integration_id: integration.id,
            scope: resource.scope,
            organization_uri: resource.organization,
            user_uri: resource.user,
            group_uri: resource.group,
            events: resource.events,
            callback_url: resource.callback_url,
            signing_key: body.signingKey?.trim() || null,
            state: resource.state,
            calendly_webhook_uri: resource.uri,
            retry_started_at: resource.retry_started_at,
            created_at: resource.created_at,
            updated_at: resource.updated_at,
          },
          { onConflict: 'workspace_id,calendly_webhook_uri' },
        )
        .select('id, calendly_webhook_uri, scope, state, events, callback_url, created_at, updated_at')
        .single()
      if (webhookErr || !webhookRow) throw new Error(webhookErr?.message ?? 'Failed to save Calendly webhook record')

      await addIntegrationLog({
        accessToken: authed.accessToken,
        workspaceId,
        integrationId: integration.id as string,
        level: duplicate ? 'warn' : 'info',
        action: duplicate ? 'calendly_webhook_existing' : 'calendly_webhook_created',
        message: duplicate
          ? `Using existing Calendly webhook for ${resource.scope} scope and callback URL.`
          : `Created Calendly webhook for ${resource.scope} scope.`,
        context: {
          webhookUri: resource.uri,
          events: resource.events,
          callback: resource.callback_url,
        },
      })

      res.json({ webhook: webhookRow, duplicate })
    }),
  )

  router.get(
    '/webhooks',
    asyncHandler(async (req, res) => {
      const authed = req as AuthenticatedWorkspaceRequest
      const workspaceId = authed.params.workspaceId
      const db = createUserClient(authed.accessToken)
      const { data: integration, error: integrationErr } = await db
        .from('workspace_integrations')
        .select('id, credentials, settings')
        .eq('workspace_id', workspaceId)
        .eq('provider', 'calendly')
        .maybeSingle()
      if (integrationErr) throw new Error(integrationErr.message)
      if (!integration) {
        res.json({ connected: false, webhooks: [], remote: [] })
        return
      }
      const credentials =
        integration.credentials && typeof integration.credentials === 'object' && !Array.isArray(integration.credentials)
          ? (integration.credentials as Record<string, unknown>)
          : {}
      const settings =
        integration.settings && typeof integration.settings === 'object' && !Array.isArray(integration.settings)
          ? (integration.settings as Record<string, unknown>)
          : {}
      const token = (credentials.api_key ?? credentials.access_token) as string | undefined
      const organization = settings.organization_uri as string | undefined
      let remote: unknown[] = []
      if (token && organization) {
        try {
          remote = await listCalendlyWebhookSubscriptions(token, organization)
        } catch (error) {
          await addIntegrationLog({
            accessToken: authed.accessToken,
            workspaceId,
            integrationId: integration.id as string,
            level: 'warn',
            action: 'calendly_webhooks_list_remote_failed',
            message: error instanceof Error ? error.message : 'Failed to list remote webhooks',
          })
        }
      }

      const { data: rows, error: rowsErr } = await db
        .from('workspace_calendly_webhooks')
        .select('id, scope, events, callback_url, state, calendly_webhook_uri, created_at, updated_at')
        .eq('workspace_id', workspaceId)
        .order('updated_at', { ascending: false })
      if (rowsErr) throw new Error(rowsErr.message)
      res.json({ connected: true, webhooks: rows ?? [], remote })
    }),
  )

  return router
}
