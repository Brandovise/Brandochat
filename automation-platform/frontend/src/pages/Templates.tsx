import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Row = { id: string; name: string; body: string }
type PlaceholderOption = { value: string; label: string; group: string }

const BASE_PLACEHOLDERS: PlaceholderOption[] = [
  { value: 'contact.display_name', label: 'Display name', group: 'Contact' },
  { value: 'contact.first_name', label: 'First name', group: 'Contact' },
  { value: 'contact.last_name', label: 'Last name', group: 'Contact' },
  { value: 'contact.phone_e164', label: 'Phone number', group: 'Contact' },
  { value: 'contact.wa_jid', label: 'WhatsApp JID', group: 'Contact' },
  { value: 'contact.gender', label: 'Gender', group: 'Contact' },
  { value: 'contact.birthday', label: 'Birthday', group: 'Contact' },
  { value: 'contact.notes', label: 'Notes', group: 'Contact' },
  { value: 'latestReply', label: 'Latest reply', group: 'Automation' },
  { value: 'chosenRouteLabel', label: 'AI route label', group: 'Automation' },
  { value: 'skillReply', label: 'AI skill output', group: 'Automation' },
]

const CALENDLY_PLACEHOLDERS: PlaceholderOption[] = [
  { value: 'calendlyEvent', label: 'Event name', group: 'Calendly' },
  { value: 'inviteeName', label: 'Invitee name', group: 'Calendly' },
  { value: 'inviteeEmail', label: 'Invitee email', group: 'Calendly' },
  { value: 'inviteePhone', label: 'Invitee phone', group: 'Calendly' },
  { value: 'inviteeStatus', label: 'Invitee status', group: 'Calendly' },
  { value: 'inviteeRescheduleUrl', label: 'Reschedule URL', group: 'Calendly' },
  { value: 'inviteeCancelUrl', label: 'Cancel URL', group: 'Calendly' },
  { value: 'schedulingMethod', label: 'Scheduling method', group: 'Calendly' },
  { value: 'meetingName', label: 'Meeting name', group: 'Calendly' },
  { value: 'meetingStart', label: 'Meeting start', group: 'Calendly' },
  { value: 'meetingEnd', label: 'Meeting end', group: 'Calendly' },
  { value: 'meetingJoinUrl', label: 'Meeting join URL', group: 'Calendly' },
  { value: 'meetingStatus', label: 'Meeting status', group: 'Calendly' },
  { value: 'eventType', label: 'Event type URI', group: 'Calendly' },
  { value: 'eventUri', label: 'Scheduled event URI', group: 'Calendly' },
  { value: 'timezone', label: 'Timezone', group: 'Calendly' },
  { value: 'qa.handynummer', label: 'Q&A: Handynummer', group: 'Calendly' },
]

export default function Templates() {
  const { workspaceId } = useParams()
  const [rows, setRows] = useState<Row[]>([])
  const [name, setName] = useState('')
  const [body, setBody] = useState('')
  const [placeholders, setPlaceholders] = useState<PlaceholderOption[]>(BASE_PLACEHOLDERS)
  const [error, setError] = useState<string | null>(null)
  const bodyRef = useRef<HTMLTextAreaElement | null>(null)

  async function load() {
    if (!workspaceId) return
    const { data, error: loadErr } = await supabase
      .from('message_templates')
      .select('id, name, body')
      .eq('workspace_id', workspaceId)
      .order('name')
    if (loadErr) setError(loadErr.message)
    else setRows((data as Row[]) ?? [])
  }

  useEffect(() => {
    void load()
    if (!workspaceId) return
    void (async () => {
      const [{ data: integrations }, { data: contacts }] = await Promise.all([
        supabase
          .from('workspace_integrations')
          .select('provider')
          .eq('workspace_id', workspaceId)
          .eq('status', 'active'),
        supabase.from('contacts').select('metadata').eq('workspace_id', workspaceId).limit(200),
      ])

      const providers = ((integrations ?? []) as Array<{ provider: string }>).map((row) => row.provider)

      const customKeys = new Set<string>()
      for (const row of contacts ?? []) {
        const metadata = row.metadata as Record<string, unknown> | null
        const attrs = metadata?.custom_attributes
        if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) continue
        for (const key of Object.keys(attrs as Record<string, unknown>)) customKeys.add(key)
      }
      const customPlaceholders = [...customKeys].sort().map((key) => ({
        value: `contact.attr.${key.replace(/[^\w.-]/g, '_')}`,
        label: key,
        group: 'Custom attributes',
      }))
      const integrationPlaceholders = providers.includes('calendly') ? CALENDLY_PLACEHOLDERS : []
      setPlaceholders([...BASE_PLACEHOLDERS, ...integrationPlaceholders, ...customPlaceholders])
    })()
  }, [workspaceId])

  function insertPlaceholder(value: string) {
    const token = `{{${value}}}`
    const textarea = bodyRef.current
    if (!textarea) {
      setBody((current) => `${current}${token}`)
      return
    }
    const start = textarea.selectionStart ?? body.length
    const end = textarea.selectionEnd ?? body.length
    const nextBody = `${body.slice(0, start)}${token}${body.slice(end)}`
    setBody(nextBody)
    window.requestAnimationFrame(() => {
      textarea.focus()
      const cursor = start + token.length
      textarea.setSelectionRange(cursor, cursor)
    })
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!workspaceId) return
    setError(null)
    const { error: insErr } = await supabase.from('message_templates').insert({
      workspace_id: workspaceId,
      name: name.trim(),
      body,
    })
    if (insErr) {
      setError(insErr.message)
      return
    }
    setName('')
    setBody('')
    await load()
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-white">Message templates</h1>
      <p className="text-sm text-slate-400">
        Templates are plain WhatsApp text messages, not Meta button templates. Add numbered choices in the
        message body when needed, then use automation skills/branches to interpret replies. Placeholders:
        flow variables <code className="text-emerald-300">{'{{name}}'}</code> from automation
        state, plus contact fields{' '}
        <code className="text-emerald-300">{'{{contact.display_name}}'}</code>,{' '}
        <code className="text-emerald-300">{'{{contact.phone_e164}}'}</code>,{' '}
        <code className="text-emerald-300">{'{{contact.wa_jid}}'}</code>,{' '}
        <code className="text-emerald-300">{'{{contact.notes}}'}</code>, and{' '}
        <code className="text-emerald-300">{'{{contact.attr.plan}}'}</code> for each key in contact metadata
        JSON, plus Calendly fields like <code className="text-emerald-300">{'{{meetingJoinUrl}}'}</code> and Q&A keys like{' '}
        <code className="text-emerald-300">{'{{qa.handynummer}}'}</code>.
      </p>
      <form onSubmit={add} className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <input
          required
          placeholder="Template name (unique in workspace)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
        />
        <textarea
          ref={bodyRef}
          required
          placeholder="Message body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
        />
        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <div>
            <h2 className="text-sm font-medium text-white">Insert placeholders</h2>
            <p className="mt-1 text-xs text-slate-500">Click a variable to add it to the message body at your cursor.</p>
          </div>
          {Array.from(new Set(placeholders.map((item) => item.group))).map((group) => (
            <div key={group} className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{group}</p>
              <div className="flex flex-wrap gap-2">
                {placeholders.filter((item) => item.group === group).map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => insertPlaceholder(item.value)}
                    className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-300 hover:border-emerald-500/60 hover:text-emerald-300"
                    title={`Insert {{${item.value}}}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white">
          Save template
        </button>
      </form>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <h2 className="font-medium text-emerald-300">{r.name}</h2>
            <pre className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{r.body}</pre>
          </li>
        ))}
      </ul>
    </div>
  )
}
