import { supabase } from './supabase'

const base = '/api'

async function authHeader(forceRefresh = false): Promise<HeadersInit> {
  const { data, error } = forceRefresh ? await supabase.auth.refreshSession() : await supabase.auth.getSession()
  let session = data.session

  if (!forceRefresh && session?.expires_at && session.expires_at * 1000 - Date.now() < 60_000) {
    const refreshed = await supabase.auth.refreshSession()
    session = refreshed.data.session
    if (refreshed.error) {
      await supabase.auth.signOut()
      throw new Error('Your session expired. Please sign in again.')
    }
  }

  if (error || !session?.access_token) {
    await supabase.auth.signOut()
    throw new Error('Your session expired. Please sign in again.')
  }

  const token = session.access_token
  return { Authorization: `Bearer ${token}` }
}

async function readApiError(res: Response): Promise<string> {
  const text = await res.text()
  if (!text) return `${res.status} ${res.statusText}`
  try {
    const parsed = JSON.parse(text) as { error?: string }
    return parsed.error ?? text
  } catch {
    return text
  }
}

async function fetchWithAuth(input: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const h = await authHeader(!retry)
  let res: Response
  try {
    res = await fetch(input, {
      ...init,
      headers: { ...h, ...(init.headers ?? {}) },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch'
    if (message.includes('Failed to fetch')) {
      throw new Error('Cannot reach backend API. Check EasyPanel domain routing and /api proxy configuration.')
    }
    throw error
  }

  if (res.status === 401 && retry) {
    return fetchWithAuth(input, init, false)
  }

  if (res.status === 401) {
    await supabase.auth.signOut()
  }

  return res
}

export async function waConnect(workspaceId: string) {
  const res = await fetchWithAuth(`${base}/wa/${workspaceId}/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(await readApiError(res))
  return res.json() as Promise<{ ok: boolean }>
}

export async function waStatus(workspaceId: string) {
  const res = await fetchWithAuth(`${base}/wa/${workspaceId}/status`)
  if (!res.ok) throw new Error(await readApiError(res))
  return res.json() as Promise<{
    pairing_status: string
    qr?: string
    phone_label?: string | null
    last_error?: string | null
  }>
}

export async function waDisconnect(workspaceId: string) {
  const res = await fetchWithAuth(`${base}/wa/${workspaceId}/disconnect`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(await readApiError(res))
  return res.json() as Promise<{ ok: boolean }>
}

export type WhatsAppInstance = {
  id: string
  display_name: string | null
  pairing_status: string
  qr?: string
  phone_label?: string | null
  last_error?: string | null
  is_default: boolean
  created_at: string
  sync?: {
    state: 'idle' | 'syncing' | 'error'
    startedAt?: string
    lastBatchAt?: string
    lastFinishedAt?: string
    progress?: number | null
    syncType?: number | null
    batches: number
    chats: number
    contacts: number
    messages: number
    lastBatch?: {
      chats: number
      contacts: number
      messages: number
      isLatest?: boolean
    }
    lastError?: string
  } | null
  settings?: {
    always_sync_history?: boolean
    skip_phone_notifications?: boolean
  } | null
}

export async function waInstances(workspaceId: string) {
  const res = await fetchWithAuth(`${base}/wa/${workspaceId}/instances`)
  if (!res.ok) throw new Error(await readApiError(res))
  return res.json() as Promise<{ instances: WhatsAppInstance[] }>
}

export async function waCreateInstance(workspaceId: string, displayName: string) {
  const res = await fetchWithAuth(`${base}/wa/${workspaceId}/instances`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName }),
  })
  if (!res.ok) throw new Error(await readApiError(res))
  return res.json() as Promise<{ instance: WhatsAppInstance }>
}

export async function waConnectInstance(workspaceId: string, instanceId: string) {
  const res = await fetchWithAuth(`${base}/wa/${workspaceId}/instances/${instanceId}/connect`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(await readApiError(res))
  return res.json() as Promise<{ ok: boolean }>
}

export async function waDisconnectInstance(workspaceId: string, instanceId: string) {
  const res = await fetchWithAuth(`${base}/wa/${workspaceId}/instances/${instanceId}/disconnect`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(await readApiError(res))
  return res.json() as Promise<{ ok: boolean }>
}

export async function waSyncInstance(workspaceId: string, instanceId: string) {
  const res = await fetchWithAuth(`${base}/wa/${workspaceId}/instances/${instanceId}/sync`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(await readApiError(res))
  return res.json() as Promise<{ ok: boolean }>
}

export async function waUpdateInstanceSettings(
  workspaceId: string,
  instanceId: string,
  settings: { always_sync_history?: boolean; skip_phone_notifications?: boolean },
) {
  const res = await fetchWithAuth(`${base}/wa/${workspaceId}/instances/${instanceId}/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  if (!res.ok) throw new Error(await readApiError(res))
  return res.json() as Promise<{ ok: boolean; settings: { always_sync_history: boolean; skip_phone_notifications: boolean } }>
}

export async function waSyncChat(workspaceId: string, instanceId: string, contactId: string) {
  const res = await fetchWithAuth(`${base}/wa/${workspaceId}/instances/${instanceId}/chats/${contactId}/sync`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(await readApiError(res))
  return res.json() as Promise<{ ok: boolean; mode: 'requested'; requestedCount: number }>
}

export async function waSendMessage(workspaceId: string, contactId: string, text: string, instanceId?: string) {
  const res = await fetchWithAuth(`${base}/wa/${workspaceId}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contactId, text, instanceId }),
  })
  if (!res.ok) throw new Error(await readApiError(res))
  return res.json() as Promise<{ ok: boolean; wa_message_id: string | null }>
}

export async function waTestAutomation(
  workspaceId: string,
  automationId: string,
  contactId: string,
  mode: 'run_now' | 'wait_for_message' = 'run_now',
  instanceId?: string,
) {
  const res = await fetchWithAuth(`${base}/wa/${workspaceId}/automations/${automationId}/test-run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contactId, mode, instanceId }),
  })
  if (!res.ok) throw new Error(await readApiError(res))
  return res.json() as Promise<{ ok: boolean; runId: string; mode?: 'run_now' | 'wait_for_message' }>
}

export type CalendlyScope = 'organization' | 'user' | 'group'
export type CalendlyEventType =
  | 'invitee.created'
  | 'invitee.canceled'
  | 'invitee_no_show.created'
  | 'invitee_no_show.deleted'
  | 'event_type.created'
  | 'event_type.deleted'
  | 'event_type.updated'
  | 'routing_form_submission.created'

export async function calendlyConnect(workspaceId: string, personalToken: string, displayName?: string) {
  const res = await fetchWithAuth(`${base}/integrations/${workspaceId}/calendly/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ personalToken, displayName }),
  })
  if (!res.ok) throw new Error(await readApiError(res))
  return res.json() as Promise<{
    integration: { id: string; provider: string; auth_type: string; status: string; settings: Record<string, unknown>; updated_at: string }
    profile: { user_uri: string; email: string; name: string; organization_uri: string }
  }>
}

export async function calendlyCreateWebhook(
  workspaceId: string,
  payload: {
    callbackUrl: string
    scope: CalendlyScope
    events: CalendlyEventType[]
    organization?: string
    user?: string
    group?: string
    signingKey?: string
  },
) {
  const res = await fetchWithAuth(`${base}/integrations/${workspaceId}/calendly/webhooks/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(await readApiError(res))
  return res.json() as Promise<{
    webhook: {
      id: string
      calendly_webhook_uri: string
      scope: CalendlyScope
      state: string
      events: CalendlyEventType[]
      callback_url: string
      created_at: string
      updated_at: string
    }
    duplicate?: boolean
  }>
}

export async function calendlyListWebhooks(workspaceId: string) {
  const res = await fetchWithAuth(`${base}/integrations/${workspaceId}/calendly/webhooks`)
  if (!res.ok) throw new Error(await readApiError(res))
  return res.json() as Promise<{
    connected: boolean
    webhooks: Array<{
      id: string
      scope: CalendlyScope
      events: CalendlyEventType[]
      callback_url: string
      state: string
      calendly_webhook_uri: string
      created_at: string
      updated_at: string
    }>
    remote: Array<{
      uri: string
      callback_url: string
      scope: CalendlyScope
      events: CalendlyEventType[]
      state: string
      organization: string
      user: string | null
      group: string | null
    }>
  }>
}
