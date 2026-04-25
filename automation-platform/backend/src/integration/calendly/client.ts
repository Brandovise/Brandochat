const CALENDLY_API_BASE = 'https://api.calendly.com'

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

export type CalendlyCurrentUser = {
  uri: string
  name: string
  email: string
  current_organization: string
}

export type CalendlyWebhookResource = {
  uri: string
  callback_url: string
  created_at: string
  updated_at: string
  retry_started_at: string | null
  state: 'active' | 'disabled'
  events: CalendlyEventType[]
  scope: CalendlyScope
  organization: string
  user: string | null
  group: string | null
  creator: string | null
}

type RequestOptions = {
  method?: 'GET' | 'POST'
  body?: Record<string, unknown>
}

export class CalendlyApiError extends Error {
  status: number
  payload: unknown

  constructor(status: number, message: string, payload: unknown) {
    super(message)
    this.name = 'CalendlyApiError'
    this.status = status
    this.payload = payload
  }
}

function toErrorText(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const title = (data as Record<string, unknown>).title
    const message = (data as Record<string, unknown>).message
    if (typeof message === 'string' && message.trim()) return message
    if (typeof title === 'string' && title.trim()) return title
  }
  return fallback
}

async function calendlyRequest<T>(token: string, path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${CALENDLY_API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  if (!response.ok) {
    const raw = (await response.text()) || ''
    let data: unknown = null
    try {
      data = raw ? JSON.parse(raw) : null
    } catch {
      data = null
    }
    const message = toErrorText(data, `Calendly API error ${response.status}`)
    throw new CalendlyApiError(response.status, message, data)
  }
  return (await response.json()) as T
}

export async function getCalendlyCurrentUser(token: string): Promise<CalendlyCurrentUser> {
  const data = await calendlyRequest<{ resource: CalendlyCurrentUser }>(token, '/users/me')
  return data.resource
}

export async function createCalendlyWebhookSubscription(
  token: string,
  body: {
    url: string
    events: CalendlyEventType[]
    scope: CalendlyScope
    organization: string
    user?: string
    group?: string
    signing_key?: string
  },
): Promise<CalendlyWebhookResource> {
  const data = await calendlyRequest<{ resource: CalendlyWebhookResource }>(token, '/webhook_subscriptions', {
    method: 'POST',
    body,
  })
  return data.resource
}

export async function listCalendlyWebhookSubscriptions(token: string, organization: string): Promise<CalendlyWebhookResource[]> {
  const params = new URLSearchParams({ organization, count: '100' })
  const data = await calendlyRequest<{ collection?: CalendlyWebhookResource[] }>(token, `/webhook_subscriptions?${params.toString()}`)
  return data.collection ?? []
}
