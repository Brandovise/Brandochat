import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { calendlyConnect, calendlyCreateWebhook, calendlyListWebhooks, type CalendlyEventType, type CalendlyScope } from '../lib/api'
import { supabase } from '../lib/supabase'
import { Button } from '../shared/ui/button'
import { FormError } from '../shared/ui/form-error'
import { PageHeader } from '../shared/ui/page-header'
import { TextInput } from '../shared/ui/text-input'

type IntegrationProvider = 'calendly' | 'chatgpt' | 'BrandoChat' | 'custom_api'
type IntegrationLog = {
  id: string
  provider: IntegrationProvider
  level: 'debug' | 'info' | 'warn' | 'error'
  action: string
  message: string
  created_at: string
}
type CalendlyWebhookRow = {
  id: string
  scope: CalendlyScope
  events: CalendlyEventType[]
  callback_url: string
  state: string
  calendly_webhook_uri: string
  updated_at: string
}
type CalendlyEventRow = {
  id: string
  event: string
  signature_valid: boolean
  processing_status: string
  created_at: string
  error: string | null
  payload: unknown
}

type IntegrationCard = {
  key: 'calendly' | 'chatgpt' | 'BrandoChat' | 'custom_api'
  title: string
  subtitle: string
  description: string
}

const calendlyEventOptions: CalendlyEventType[] = [
  'invitee.created',
  'invitee.canceled',
  'invitee_no_show.created',
  'invitee_no_show.deleted',
  'event_type.created',
  'event_type.deleted',
  'event_type.updated',
  'routing_form_submission.created',
]

const integrationCards: IntegrationCard[] = [
  {
    key: 'calendly',
    title: 'Calendly',
    subtitle: 'calendly.com',
    description: 'Create webhook subscriptions and trigger automations from booking events.',
  },
  {
    key: 'chatgpt',
    title: 'ChatGPT API',
    subtitle: 'OpenAI API',
    description: 'Configure API key, base URL, and model for AI reply behavior.',
  },
  {
    key: 'BrandoChat',
    title: 'BrandoChat',
    subtitle: 'BrandoChat.io',
    description: 'Store integration credentials/settings for BrandoChat-based workflows.',
  },
  {
    key: 'custom_api',
    title: 'API Key',
    subtitle: 'Custom integration',
    description: 'Save custom API credentials and settings for additional providers.',
  },
]

export default function IntegrationsPage() {
  const { workspaceId } = useParams()
  const [activeCard, setActiveCard] = useState<'calendly' | 'chatgpt' | null>(null)
  const [calendlyTab, setCalendlyTab] = useState<'settings' | 'logs'>('settings')
  const [chatgptTab, setChatgptTab] = useState<'settings' | 'logs'>('settings')
  const [logs, setLogs] = useState<IntegrationLog[]>([])
  const [calendlyEvents, setCalendlyEvents] = useState<CalendlyEventRow[]>([])
  const [calendlyWebhooks, setCalendlyWebhooks] = useState<CalendlyWebhookRow[]>([])

  const [calendlyToken, setCalendlyToken] = useState('')
  const [calendlyScope, setCalendlyScope] = useState<CalendlyScope>('organization')
  const [calendlySelectedEvents, setCalendlySelectedEvents] = useState<CalendlyEventType[]>(['invitee.created', 'invitee.canceled'])
  const [calendlyCallbackUrl, setCalendlyCallbackUrl] = useState('')
  const [calendlyOrganizationUri, setCalendlyOrganizationUri] = useState('')
  const [calendlyUserUri, setCalendlyUserUri] = useState('')
  const [calendlyGroupUri, setCalendlyGroupUri] = useState('')
  const [calendlySigningKey, setCalendlySigningKey] = useState('')
  const [connectingCalendly, setConnectingCalendly] = useState(false)
  const [creatingWebhook, setCreatingWebhook] = useState(false)

  const [chatgptApiKey, setChatgptApiKey] = useState('')
  const [chatgptBaseUrl, setChatgptBaseUrl] = useState('https://api.openai.com/v1')
  const [chatgptModel, setChatgptModel] = useState('gpt-4o-mini')
  const [savingChatgpt, setSavingChatgpt] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function toPrettyJson(value: unknown): string {
    try {
      return JSON.stringify(value ?? {}, null, 2)
    } catch {
      return '{}'
    }
  }

  function toUserError(message: string): string {
    if (message.includes("Could not find the table 'public.workspace_integrations'")) {
      return "Database is missing 'workspace_integrations'. Run Supabase migrations first (e.g. `supabase db push`) and refresh."
    }
    if (message.includes('Hook with this url already exists')) {
      return 'This Calendly callback URL already has a webhook. Click Refresh to load it, or use a different scope/URL.'
    }
    if (message.includes('Cannot reach backend API')) {
      return 'Cannot reach backend API. Verify EasyPanel domain routing and ensure /api goes to the backend service.'
    }
    return message
  }

  async function loadLogs() {
    if (!workspaceId) return
    const { data, error: loadErr } = await supabase
      .from('workspace_integration_logs')
      .select('id, provider, level, action, message, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (loadErr) {
      setError(toUserError(loadErr.message))
      return
    }
    setLogs((data as IntegrationLog[] | null) ?? [])
  }

  async function loadCalendlyEvents() {
    if (!workspaceId) return
    const { data, error: loadErr } = await supabase
      .from('calendly_webhook_events')
      .select('id, event, signature_valid, processing_status, created_at, error, payload')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(30)
    if (loadErr) {
      setError(toUserError(loadErr.message))
      return
    }
    setCalendlyEvents((data as CalendlyEventRow[] | null) ?? [])
  }

  async function loadChatgptSettings() {
    if (!workspaceId) return
    const { data, error: readErr } = await supabase
      .from('workspace_integrations')
      .select('credentials, settings')
      .eq('workspace_id', workspaceId)
      .eq('provider', 'chatgpt')
      .maybeSingle()
    if (readErr) {
      setError(toUserError(readErr.message))
      return
    }
    const credentials = data?.credentials && typeof data.credentials === 'object' && !Array.isArray(data.credentials) ? (data.credentials as Record<string, unknown>) : {}
    const settings = data?.settings && typeof data.settings === 'object' && !Array.isArray(data.settings) ? (data.settings as Record<string, unknown>) : {}
    setChatgptApiKey(typeof credentials.api_key === 'string' ? credentials.api_key : '')
    setChatgptBaseUrl(typeof settings.base_url === 'string' ? settings.base_url : 'https://api.openai.com/v1')
    setChatgptModel(typeof settings.model === 'string' ? settings.model : 'gpt-4o-mini')
  }

  async function refreshCalendlyWebhooks() {
    if (!workspaceId) return
    try {
      const data = await calendlyListWebhooks(workspaceId)
      setCalendlyWebhooks(data.webhooks)
    } catch (err) {
      setError(err instanceof Error ? toUserError(err.message) : 'Failed to load Calendly webhooks')
    }
  }

  useEffect(() => {
    if (!workspaceId) return
    if (typeof window !== 'undefined') setCalendlyCallbackUrl(`${window.location.origin}/api/integrations/calendly/webhook/${workspaceId}`)
    void loadLogs()
    void loadCalendlyEvents()
    void loadChatgptSettings()
    void refreshCalendlyWebhooks()
  }, [workspaceId])

  async function connectCalendlyToken(event: React.FormEvent) {
    event.preventDefault()
    if (!workspaceId) return
    setError(null)
    setNotice(null)
    if (!calendlyToken.trim()) {
      setError('Calendly personal token is required.')
      return
    }
    setConnectingCalendly(true)
    try {
      const data = await calendlyConnect(workspaceId, calendlyToken.trim(), 'Calendly')
      setCalendlyOrganizationUri(data.profile.organization_uri)
      setCalendlyUserUri(data.profile.user_uri)
      setNotice('Calendly connected. You can create webhook subscriptions now.')
      await loadLogs()
    } catch (err) {
      setError(err instanceof Error ? toUserError(err.message) : 'Failed to connect Calendly')
    } finally {
      setConnectingCalendly(false)
    }
  }

  async function createCalendlyWebhookSubscription(event: React.FormEvent) {
    event.preventDefault()
    if (!workspaceId) return
    setError(null)
    setNotice(null)
    if (!calendlyCallbackUrl.trim()) return setError('Callback URL is required.')
    if (calendlySelectedEvents.length === 0) return setError('Select at least one event.')
    setCreatingWebhook(true)
    try {
      const result = await calendlyCreateWebhook(workspaceId, {
        callbackUrl: calendlyCallbackUrl,
        scope: calendlyScope,
        events: calendlySelectedEvents,
        organization: calendlyOrganizationUri || undefined,
        user: calendlyScope === 'user' ? calendlyUserUri || undefined : undefined,
        group: calendlyScope === 'group' ? calendlyGroupUri || undefined : undefined,
        signingKey: calendlySigningKey || undefined,
      })
      setNotice(result.duplicate ? 'Webhook already existed in Calendly; linked existing subscription.' : 'Calendly webhook subscription created.')
      await refreshCalendlyWebhooks()
      await loadLogs()
    } catch (err) {
      setError(err instanceof Error ? toUserError(err.message) : 'Failed to create webhook')
    } finally {
      setCreatingWebhook(false)
    }
  }

  async function saveChatgpt(event: React.FormEvent) {
    event.preventDefault()
    if (!workspaceId) return
    setError(null)
    setNotice(null)
    if (!chatgptApiKey.trim()) return setError('ChatGPT API key is required.')
    setSavingChatgpt(true)
    const { error: saveErr } = await supabase.from('workspace_integrations').upsert(
      {
        workspace_id: workspaceId,
        provider: 'chatgpt',
        display_name: 'ChatGPT API',
        auth_type: 'api_key',
        status: 'active',
        credentials: { api_key: chatgptApiKey.trim() },
        settings: { base_url: chatgptBaseUrl.trim() || 'https://api.openai.com/v1', model: chatgptModel.trim() || 'gpt-4o-mini' },
      },
      { onConflict: 'workspace_id,provider' },
    )
    setSavingChatgpt(false)
    if (saveErr) return setError(toUserError(saveErr.message))
    setNotice('ChatGPT settings saved.')
    void loadLogs()
  }

  if (!workspaceId) return <p className="text-slate-500">Missing workspace.</p>

  return (
    <div className="space-y-6">
      <PageHeader title="Integrations" description="Open an integration card and manage settings/logs in tabs." />
      <FormError message={error} />
      {notice ? <p className="text-sm text-emerald-300">{notice}</p> : null}

      {activeCard == null ? (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Explore integrations</h2>
            <p className="text-sm text-slate-400">Click a card to open its settings and logs panel.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {integrationCards.map((card) => {
              const isEnabled = card.key === 'calendly' || card.key === 'chatgpt'
              return (
                <button
                  key={card.key}
                  type="button"
                  disabled={!isEnabled}
                  onClick={() => {
                    if (card.key === 'calendly' || card.key === 'chatgpt') setActiveCard(card.key)
                  }}
                  className={`rounded-2xl border p-4 text-left transition ${
                    isEnabled ? 'border-slate-800 bg-slate-900/40 hover:border-emerald-500/30' : 'cursor-not-allowed border-slate-800 bg-slate-900/20 opacity-60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-base font-semibold text-white">{card.title}</p>
                      <p className="text-xs text-slate-500">{card.subtitle}</p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${isEnabled ? 'bg-emerald-800/30 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                      {isEnabled ? 'Open' : 'Soon'}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-slate-400">{card.description}</p>
                </button>
              )
            })}
          </div>
        </section>
      ) : null}

      {activeCard === 'calendly' ? (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
          <div className="mb-4">
            <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setActiveCard(null)}>
              Back to integrations
            </Button>
          </div>
          <div className="mb-4 flex gap-2">
            <Button type="button" variant={calendlyTab === 'settings' ? 'primary' : 'secondary'} className="px-3 py-1.5 text-xs" onClick={() => setCalendlyTab('settings')}>Settings</Button>
            <Button type="button" variant={calendlyTab === 'logs' ? 'primary' : 'secondary'} className="px-3 py-1.5 text-xs" onClick={() => setCalendlyTab('logs')}>Logs</Button>
          </div>
          {calendlyTab === 'settings' ? (
            <div className="space-y-5">
              <form className="grid gap-4 md:grid-cols-2" onSubmit={connectCalendlyToken}>
                <label className="block text-sm text-slate-300 md:col-span-2">Personal token<TextInput className="mt-1" value={calendlyToken} onChange={(event) => setCalendlyToken(event.target.value)} placeholder="pat_..." /></label>
                <div className="md:col-span-2"><Button type="submit" disabled={connectingCalendly}>{connectingCalendly ? 'Connecting…' : 'Save token'}</Button></div>
              </form>
              <form className="grid gap-4 md:grid-cols-2" onSubmit={createCalendlyWebhookSubscription}>
                <label className="block text-sm text-slate-300">Scope<select value={calendlyScope} onChange={(event) => setCalendlyScope(event.target.value as CalendlyScope)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"><option value="organization">organization</option><option value="user">user</option><option value="group">group</option></select></label>
                <label className="block text-sm text-slate-300">Organization URI<TextInput className="mt-1" value={calendlyOrganizationUri} onChange={(event) => setCalendlyOrganizationUri(event.target.value)} /></label>
                {calendlyScope === 'user' ? <label className="block text-sm text-slate-300">User URI<TextInput className="mt-1" value={calendlyUserUri} onChange={(event) => setCalendlyUserUri(event.target.value)} /></label> : null}
                {calendlyScope === 'group' ? <label className="block text-sm text-slate-300">Group URI<TextInput className="mt-1" value={calendlyGroupUri} onChange={(event) => setCalendlyGroupUri(event.target.value)} /></label> : null}
                <label className="block text-sm text-slate-300 md:col-span-2">Callback URL<TextInput className="mt-1" value={calendlyCallbackUrl} onChange={(event) => setCalendlyCallbackUrl(event.target.value)} /></label>
                <label className="block text-sm text-slate-300 md:col-span-2">Signing key (optional)<TextInput className="mt-1" value={calendlySigningKey} onChange={(event) => setCalendlySigningKey(event.target.value)} /></label>
                <div className="md:col-span-2 grid gap-2 sm:grid-cols-2">
                  {calendlyEventOptions.map((eventName) => (
                    <label key={eventName} className="flex items-center gap-2 rounded-lg bg-slate-950 px-2 py-2 text-sm text-slate-300">
                      <input type="checkbox" checked={calendlySelectedEvents.includes(eventName)} onChange={(event) => event.target.checked ? setCalendlySelectedEvents([...calendlySelectedEvents, eventName]) : setCalendlySelectedEvents(calendlySelectedEvents.filter((value) => value !== eventName))} />
                      <span>{eventName}</span>
                    </label>
                  ))}
                </div>
                <div className="md:col-span-2 flex gap-2">
                  <Button type="submit" disabled={creatingWebhook}>{creatingWebhook ? 'Creating…' : 'Create webhook subscription'}</Button>
                  <Button type="button" variant="secondary" onClick={() => void refreshCalendlyWebhooks()}>Refresh</Button>
                </div>
              </form>
              <div className="space-y-2">
                <p className="text-sm font-medium text-white">Webhook subscriptions</p>
                {calendlyWebhooks.length === 0 ? <p className="text-sm text-slate-500">No webhook subscriptions yet.</p> : null}
                {calendlyWebhooks.map((row) => (
                  <article key={row.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                    <p className="text-sm text-white">{row.scope} - {row.state}</p>
                    <p className="text-xs text-slate-500 break-all">{row.calendly_webhook_uri}</p>
                    <p className="text-xs text-slate-400">Events: {row.events.join(', ')}</p>
                  </article>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {calendlyEvents.length === 0 ? <p className="text-sm text-slate-500">No Calendly webhook events yet.</p> : null}
              {calendlyEvents.map((row) => (
                <article key={row.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">{row.processing_status}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${row.signature_valid ? 'bg-emerald-800/30 text-emerald-300' : 'bg-rose-800/30 text-rose-300'}`}>{row.signature_valid ? 'signature ok' : 'signature failed'}</span>
                  </div>
                  <p className="mt-1 text-sm text-white">{row.event}</p>
                  <p className="text-xs text-slate-500">{new Date(row.created_at).toLocaleString()}</p>
                  {row.error ? <p className="text-xs text-rose-300">{row.error}</p> : null}
                  <details className="mt-2 rounded-lg border border-slate-800 bg-slate-950/80 p-2">
                    <summary className="cursor-pointer text-xs text-slate-300">Payload JSON</summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-[11px] text-slate-300">{toPrettyJson(row.payload)}</pre>
                  </details>
                </article>
              ))}
              {logs.filter((log) => log.provider === 'calendly').map((log) => (
                <article key={log.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                  <p className="text-xs text-slate-500">{new Date(log.created_at).toLocaleString()}</p>
                  <p className="text-sm text-white">{log.action}</p>
                  <p className="text-xs text-slate-400">{log.message}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : activeCard === 'chatgpt' ? (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
          <div className="mb-4">
            <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setActiveCard(null)}>
              Back to integrations
            </Button>
          </div>
          <div className="mb-4 flex gap-2">
            <Button type="button" variant={chatgptTab === 'settings' ? 'primary' : 'secondary'} className="px-3 py-1.5 text-xs" onClick={() => setChatgptTab('settings')}>Settings</Button>
            <Button type="button" variant={chatgptTab === 'logs' ? 'primary' : 'secondary'} className="px-3 py-1.5 text-xs" onClick={() => setChatgptTab('logs')}>Logs</Button>
          </div>
          {chatgptTab === 'settings' ? (
            <form className="grid gap-4 md:grid-cols-2" onSubmit={saveChatgpt}>
              <label className="block text-sm text-slate-300 md:col-span-2">ChatGPT API key<TextInput className="mt-1" value={chatgptApiKey} onChange={(event) => setChatgptApiKey(event.target.value)} placeholder="sk-..." /></label>
              <label className="block text-sm text-slate-300">Base URL<TextInput className="mt-1" value={chatgptBaseUrl} onChange={(event) => setChatgptBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" /></label>
              <label className="block text-sm text-slate-300">Model<TextInput className="mt-1" value={chatgptModel} onChange={(event) => setChatgptModel(event.target.value)} placeholder="gpt-4o-mini" /></label>
              <div className="md:col-span-2"><Button type="submit" disabled={savingChatgpt}>{savingChatgpt ? 'Saving…' : 'Save ChatGPT settings'}</Button></div>
            </form>
          ) : (
            <div className="space-y-2">
              {logs.filter((log) => log.provider === 'chatgpt').length === 0 ? <p className="text-sm text-slate-500">No ChatGPT logs yet.</p> : null}
              {logs.filter((log) => log.provider === 'chatgpt').map((log) => (
                <article key={log.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                  <p className="text-xs text-slate-500">{new Date(log.created_at).toLocaleString()}</p>
                  <p className="text-sm text-white">{log.action}</p>
                  <p className="text-xs text-slate-400">{log.message}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  )
}
