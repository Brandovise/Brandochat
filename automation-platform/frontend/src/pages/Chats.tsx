import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { waFetchMediaBlobUrl, waInstances, waSendMessage, waSyncChat, type WhatsAppInstance } from '../lib/api'
import { supabase } from '../lib/supabase'
import { useWorkspaceId } from '../shared/hooks/useWorkspaceId'
import { Button } from '../shared/ui/button'
import { FormError } from '../shared/ui/form-error'
import { PageHeader } from '../shared/ui/page-header'
import { TextInput } from '../shared/ui/text-input'

type Contact = {
  id: string
  wa_jid: string
  display_name: string | null
  phone_e164: string | null
  metadata: Record<string, unknown> | null
}

type MessageEvent = {
  id: string
  contact_id: string | null
  direction: 'inbound' | 'outbound'
  body: string | null
  wa_chat_jid: string | null
  created_at: string
  raw: Record<string, unknown> | null
}
type MessageMedia = { kind: 'image' | 'video'; caption: string | null; url: string | null }

type ConversationRow = {
  id: string
  status: string
}

type WorkspaceLabel = {
  id: string
  name: string
  color: string
}

type ConversationLabel = {
  conversation_id: string
  label_id: string
  conversations?: { contact_id?: string | null } | null
}

const PAGE_SIZE = 1000
const MESSAGE_PAGE_SIZE = 500

function unreadCount(contact: Contact): number {
  const meta = contact.metadata ?? {}
  const marked = meta.wa_marked_unread === true
  const value = meta.wa_unread_count
  const n = typeof value === 'number' ? value : 0
  if (marked) return Math.max(1, n)
  return n
}

function assignedTo(contact: Contact): string {
  const value = contact.metadata?.assigned_to
  return typeof value === 'string' ? value : ''
}

function assignedToName(contact: Contact): string {
  const value = contact.metadata?.assigned_to_name
  return typeof value === 'string' ? value : ''
}

function assigneeLabel(contact: Contact): string {
  const explicitName = assignedToName(contact).trim()
  if (explicitName) return explicitName
  const email = assignedTo(contact).trim()
  if (!email) return ''
  const local = email.split('@')[0] ?? email
  return local.replace(/[._+-]/g, ' ')
}

function firstName(contact: Contact): string {
  const value = contact.metadata?.first_name
  return typeof value === 'string' && value.trim() ? value : ''
}

function contactLabel(contact: Contact): string {
  return contact.display_name || firstName(contact) || contact.phone_e164 || contact.wa_jid
}

function contactIdLabel(contact: Contact): string {
  return `Contact ID: ${contact.id}`
}

function latestMessageTime(contact: Contact): number {
  const value = contact.metadata?.wa_last_message_at ?? contact.metadata?.wa_conversation_timestamp
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  if (typeof value === 'number') {
    return value > 10_000_000_000 ? value : value * 1000
  }
  return 0
}

function latestMessageBody(contact: Contact): string {
  const value = contact.metadata?.wa_last_message_body
  return typeof value === 'string' ? value : ''
}

function isGroup(contact: Contact): boolean {
  return contact.wa_jid.endsWith('@g.us') || contact.metadata?.wa_is_group === true
}

function senderFromRaw(message: MessageEvent): string {
  const key = message.raw?.key
  if (!key || typeof key !== 'object' || Array.isArray(key)) return ''
  const participant = (key as Record<string, unknown>).participantAlt ?? (key as Record<string, unknown>).participant
  return typeof participant === 'string' ? participant : ''
}

function normalizeJid(value: string): string {
  return value.trim().toLowerCase()
}

function phoneFromJid(value: string): string {
  return value.split('@')[0]?.replace(/\D/g, '') ?? ''
}

function unwrapRawMessage(message: unknown): Record<string, unknown> | null {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null
  const m = message as Record<string, unknown>
  const wrappers = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage'] as const
  for (const key of wrappers) {
    const wrapped = m[key] as { message?: unknown } | undefined
    if (wrapped?.message) return unwrapRawMessage(wrapped.message)
  }
  return m
}

function mediaFromRaw(message: MessageEvent): MessageMedia | null {
  const content = unwrapRawMessage(message.raw?.message)
  if (!content) return null
  const image = content.imageMessage as { caption?: string; url?: string } | undefined
  if (image) return { kind: 'image', caption: image.caption ?? null, url: image.url ?? null }
  const video = content.videoMessage as { caption?: string; url?: string } | undefined
  if (video) return { kind: 'video', caption: video.caption ?? null, url: video.url ?? null }
  return null
}

function ContactIdWithHoverJid({ contact, className = '' }: { contact: Contact; className?: string }) {
  return (
    <div className={`group relative ${className}`}>
      <p className="truncate text-xs text-slate-500">{contactIdLabel(contact)}</p>
      <p className="pointer-events-none absolute inset-0 truncate font-mono text-xs text-slate-400 opacity-0 transition-opacity delay-1000 duration-200 group-hover:opacity-100">
        {contact.wa_jid}
      </p>
    </div>
  )
}

export default function ChatsPage() {
  const workspaceId = useWorkspaceId()
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [messages, setMessages] = useState<MessageEvent[]>([])
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null)
  const [instances, setInstances] = useState<WhatsAppInstance[]>([])
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>('')
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [conversationSearch, setConversationSearch] = useState('')
  const [chatSearch, setChatSearch] = useState('')
  const [messageMatches, setMessageMatches] = useState<MessageEvent[]>([])
  const [messageLimit, setMessageLimit] = useState(MESSAGE_PAGE_SIZE)
  const [messageCount, setMessageCount] = useState(0)
  const [syncingChat, setSyncingChat] = useState(false)
  const [syncNotice, setSyncNotice] = useState<string | null>(null)
  const [conversation, setConversation] = useState<ConversationRow | null>(null)
  const [labels, setLabels] = useState<WorkspaceLabel[]>([])
  const [conversationLabels, setConversationLabels] = useState<ConversationLabel[]>([])
  const [mobileConversationOpen, setMobileConversationOpen] = useState(false)
  const [mediaBlobUrls, setMediaBlobUrls] = useState<Record<string, string>>({})
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
    window.requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ block: 'end', behavior })
    })
  }

  const selectedContact = useMemo(
    () => contacts.find((contact) => contact.id === selectedContactId) ?? null,
    [contacts, selectedContactId],
  )
  const contactNameByJid = useMemo(() => {
    const map = new Map<string, string>()
    for (const contact of contacts) {
      const label = contactLabel(contact)
      if (!label) continue
      map.set(normalizeJid(contact.wa_jid), label)
      const lid = contact.metadata?.wa_lid
      if (typeof lid === 'string' && lid.trim()) map.set(normalizeJid(lid), label)
      const alt = contact.metadata?.wa_jid_alt
      if (typeof alt === 'string' && alt.trim()) map.set(normalizeJid(alt), label)
      const phone = contact.phone_e164?.replace(/\D/g, '') ?? phoneFromJid(contact.wa_jid)
      if (phone) map.set(phone, label)
    }
    return map
  }, [contacts])
  const labelById = useMemo(() => new Map(labels.map((label) => [label.id, label])), [labels])

  function labelsForContact(contactId: string | null): WorkspaceLabel[] {
    if (!contactId) return []
    return conversationLabels
      .filter((row) => row.conversations?.contact_id === contactId)
      .map((row) => labelById.get(row.label_id))
      .filter((label): label is WorkspaceLabel => Boolean(label))
  }

  const selectedLabels = useMemo(() => labelsForContact(selectedContactId), [conversationLabels, labelById, selectedContactId])

  const view = searchParams.get('view') ?? 'all'
  const visibleContacts = useMemo(() => {
    const baseContacts =
      view === 'unread'
        ? contacts.filter((contact) => unreadCount(contact) > 0)
        : view === 'assigned'
          ? contacts.filter((contact) => assignedTo(contact) === user?.email)
          : contacts

    const query = conversationSearch.trim().toLowerCase()
    if (!query) return baseContacts

    const matchingContactIds = new Set(messageMatches.map((message) => message.contact_id).filter(Boolean))
    const matchingChatJids = new Set(messageMatches.map((message) => message.wa_chat_jid).filter(Boolean))

    return baseContacts.filter((contact) => {
      const contactHaystack = [
        contactLabel(contact),
        contact.wa_jid,
        contact.phone_e164,
        assignedTo(contact),
        firstName(contact),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return contactHaystack.includes(query) || matchingContactIds.has(contact.id) || matchingChatJids.has(contact.wa_jid)
    })
  }, [contacts, conversationSearch, messageMatches, user?.email, view])

  const visibleMessages = useMemo(() => {
    const query = chatSearch.trim().toLowerCase()
    if (!query) return messages
    return messages.filter((message) => message.body?.toLowerCase().includes(query))
  }, [chatSearch, messages])

  const loadContacts = useCallback(async () => {
    if (!workspaceId) return
    const allRows: Contact[] = []
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error: loadErr } = await supabase
        .from('contacts')
        .select('id, wa_jid, display_name, phone_e164, metadata')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1)

      if (loadErr) {
        setError(loadErr.message)
        return
      }

      const page = (data as Contact[]) ?? []
      allRows.push(...page)
      if (page.length < PAGE_SIZE) break
    }

    const rows = allRows
      .filter((contact) => Boolean(contact.wa_jid))
      .sort((a, b) => latestMessageTime(b) - latestMessageTime(a))
    setContacts(rows)
    setSelectedContactId((current) => current ?? rows[0]?.id ?? null)
  }, [workspaceId])

  const loadInstances = useCallback(async () => {
    if (!workspaceId) return
    const data = await waInstances(workspaceId)
    setInstances(data.instances)
    setSelectedInstanceId((current) => {
      if (current && data.instances.some((instance) => instance.id === current)) return current
      return data.instances.find((instance) => instance.pairing_status === 'connected')?.id ?? data.instances[0]?.id ?? ''
    })
  }, [workspaceId])

  const loadMessages = useCallback(async () => {
    if (!workspaceId || !selectedContact) {
      setMessages([])
      setMessageCount(0)
      return
    }
    const { data, error: loadErr, count } = await supabase
      .from('message_events')
      .select('id, contact_id, direction, body, wa_chat_jid, raw, created_at', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .or(`contact_id.eq.${selectedContact.id},wa_chat_jid.eq.${selectedContact.wa_jid}`)
      .order('created_at', { ascending: false })
      .range(0, messageLimit - 1)

    if (loadErr) {
      setError(loadErr.message)
      return
    }
    setMessages([...((data as MessageEvent[]) ?? [])].reverse())
    setMessageCount(count ?? 0)
  }, [messageLimit, selectedContact, workspaceId])

  const loadConversation = useCallback(async () => {
    if (!workspaceId || !selectedContact) {
      setConversation(null)
      return
    }
    const { data } = await supabase
      .from('conversations')
      .select('id, status')
      .eq('workspace_id', workspaceId)
      .eq('contact_id', selectedContact.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    setConversation((data as ConversationRow | null) ?? null)
  }, [selectedContact, workspaceId])

  const loadLabels = useCallback(async () => {
    if (!workspaceId) return
    const [{ data: labelRows, error: labelsErr }, { data: assignmentRows, error: assignmentsErr }] = await Promise.all([
      supabase.from('workspace_labels').select('id, name, color').eq('workspace_id', workspaceId).order('name'),
      supabase
        .from('conversation_labels')
        .select('conversation_id, label_id, conversations(contact_id)')
        .eq('workspace_id', workspaceId),
    ])
    if (labelsErr) {
      setError(labelsErr.message)
      return
    }
    if (assignmentsErr) {
      setError(assignmentsErr.message)
      return
    }
    setLabels((labelRows as WorkspaceLabel[]) ?? [])
    setConversationLabels((assignmentRows as ConversationLabel[]) ?? [])
  }, [workspaceId])

  useEffect(() => {
    void loadContacts()
  }, [loadContacts])

  useEffect(() => {
    void loadInstances().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load WhatsApp numbers'))
  }, [loadInstances])

  useEffect(() => {
    void loadMessages()
  }, [loadMessages])

  useEffect(() => {
    void loadConversation()
  }, [loadConversation])

  useEffect(() => {
    void loadLabels()
  }, [loadLabels])

  useEffect(() => {
    setMessageLimit(MESSAGE_PAGE_SIZE)
    setChatSearch('')
    setSyncNotice(null)
    scrollToBottom('auto')
    setMobileConversationOpen(Boolean(selectedContactId))
  }, [selectedContactId])

  /** Opening a chat clears unread (WhatsApp count + manual "mark as unread"). */
  useEffect(() => {
    if (!workspaceId || !selectedContactId) return
    let cancelled = false
    void (async () => {
      const { data, error: fetchErr } = await supabase.from('contacts').select('metadata').eq('id', selectedContactId).maybeSingle()
      if (cancelled || fetchErr || !data?.metadata || typeof data.metadata !== 'object' || Array.isArray(data.metadata)) return
      const meta = data.metadata as Record<string, unknown>
      const count = typeof meta.wa_unread_count === 'number' ? meta.wa_unread_count : 0
      const marked = meta.wa_marked_unread === true
      if (count <= 0 && !marked) return
      const nextMeta = { ...meta, wa_unread_count: 0, wa_marked_unread: false }
      const { error: updateErr } = await supabase.from('contacts').update({ metadata: nextMeta }).eq('id', selectedContactId)
      if (!cancelled && !updateErr) void loadContacts()
    })()
    return () => {
      cancelled = true
    }
  }, [selectedContactId, workspaceId, loadContacts])

  useEffect(() => {
    if (!selectedContactId || messages.length === 0) return
    scrollToBottom()
  }, [messages.length, selectedContactId])

  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    const pending = visibleMessages
      .filter((message) => {
        const media = mediaFromRaw(message)
        return Boolean(media && (media.kind === 'image' || media.kind === 'video') && !mediaBlobUrls[message.id])
      })
      .map((message) => message.id)
    if (pending.length === 0) return

    void Promise.all(
      pending.map(async (messageId) => {
        try {
          const url = await waFetchMediaBlobUrl(workspaceId, messageId)
          return [messageId, url] as const
        } catch {
          return null
        }
      }),
    ).then((entries) => {
      if (cancelled) {
        for (const entry of entries) {
          if (entry?.[1]) URL.revokeObjectURL(entry[1])
        }
        return
      }
      setMediaBlobUrls((current) => {
        const next = { ...current }
        for (const entry of entries) {
          if (!entry) continue
          const [messageId, url] = entry
          if (next[messageId]) {
            URL.revokeObjectURL(url)
            continue
          }
          next[messageId] = url
        }
        return next
      })
    })

    return () => {
      cancelled = true
    }
  }, [mediaBlobUrls, visibleMessages, workspaceId])

  useEffect(() => {
    return () => {
      Object.values(mediaBlobUrls).forEach((url) => URL.revokeObjectURL(url))
    }
  }, [mediaBlobUrls])

  useEffect(() => {
    if (!workspaceId || !conversationSearch.trim()) {
      setMessageMatches([])
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      void supabase
        .from('message_events')
        .select('id, contact_id, direction, body, wa_chat_jid, raw, created_at')
        .eq('workspace_id', workspaceId)
        .ilike('body', `%${conversationSearch.trim()}%`)
        .order('created_at', { ascending: false })
        .limit(50)
        .then(({ data, error: searchErr }) => {
          if (cancelled) return
          if (searchErr) {
            setError(searchErr.message)
            return
          }
          setMessageMatches((data as MessageEvent[]) ?? [])
        })
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [conversationSearch, workspaceId])

  useEffect(() => {
    if (!workspaceId || !selectedContactId) return
    const channel = supabase
      .channel(`message-events:${workspaceId}:${selectedContactId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'message_events',
          filter: `workspace_id=eq.${workspaceId}`,
        },
        () => {
          void loadMessages()
          void loadContacts()
          void loadConversation()
          void loadLabels()
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [loadContacts, loadConversation, loadLabels, loadMessages, selectedContactId, workspaceId])

  useEffect(() => {
    if (!workspaceId) return
    const timer = window.setInterval(() => {
      void loadContacts()
      void loadMessages()
      void loadConversation()
      void loadLabels()
    }, 5000)
    return () => window.clearInterval(timer)
  }, [loadContacts, loadConversation, loadLabels, loadMessages, workspaceId])

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault()
    if (!workspaceId || !selectedContact) return
    const text = draft.trim()
    if (!text) return

    setError(null)
    setSending(true)
    try {
      await waSendMessage(workspaceId, selectedContact.id, text, selectedInstanceId || undefined)
      setDraft('')
      await loadMessages()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message')
    } finally {
      setSending(false)
    }
  }

  async function assignToMe() {
    if (!selectedContact || !user?.email) return
    const displayName =
      (typeof user.user_metadata?.display_name === 'string' && user.user_metadata.display_name.trim()) ||
      (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim()) ||
      ''
    const metadata = {
      ...(selectedContact.metadata ?? {}),
      assigned_to: user.email,
      assigned_to_name: displayName || (user.email.split('@')[0] ?? user.email),
    }
    const { error: updateErr } = await supabase.from('contacts').update({ metadata }).eq('id', selectedContact.id)
    if (updateErr) {
      setError(updateErr.message)
      return
    }
    await loadContacts()
  }

  async function markRead() {
    if (!selectedContact) return
    const metadata = { ...(selectedContact.metadata ?? {}), wa_unread_count: 0, wa_marked_unread: false }
    const { error: updateErr } = await supabase.from('contacts').update({ metadata }).eq('id', selectedContact.id)
    if (updateErr) {
      setError(updateErr.message)
      return
    }
    await loadContacts()
  }

  async function markUnread() {
    if (!selectedContact) return
    const meta = selectedContact.metadata ?? {}
    const current = typeof meta.wa_unread_count === 'number' ? meta.wa_unread_count : 0
    const metadata = {
      ...meta,
      wa_marked_unread: true,
      wa_unread_count: Math.max(1, current),
    }
    const { error: updateErr } = await supabase.from('contacts').update({ metadata }).eq('id', selectedContact.id)
    if (updateErr) {
      setError(updateErr.message)
      return
    }
    await loadContacts()
  }

  async function syncSelectedChat() {
    if (!workspaceId || !selectedContact || !selectedInstanceId) return
    setError(null)
    setSyncNotice(null)
    setSyncingChat(true)
    try {
      const result = await waSyncChat(workspaceId, selectedInstanceId, selectedContact.id)
      setSyncNotice(`Requested ${result.requestedCount} older messages from WhatsApp. They will appear when Baileys emits the history batch.`)
      window.setTimeout(() => {
        void loadMessages()
        void loadContacts()
      }, 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync selected chat')
    } finally {
      setSyncingChat(false)
    }
  }

  async function setConversationStatus(status: 'closed' | 'deleted') {
    if (!conversation) return
    setError(null)
    const { error: updateErr } = await supabase
      .from('conversations')
      .update({ status, closed_at: new Date().toISOString() })
      .eq('id', conversation.id)
    if (updateErr) {
      setError(updateErr.message)
      return
    }
    await loadConversation()
  }

  async function toggleConversationLabel(labelId: string, checked: boolean) {
    if (!workspaceId || !conversation) return
    setError(null)
    if (checked) {
      const { error: insertErr } = await supabase.from('conversation_labels').insert({
        workspace_id: workspaceId,
        conversation_id: conversation.id,
        label_id: labelId,
      })
      if (insertErr) {
        setError(insertErr.message)
        return
      }
    } else {
      const { error: deleteErr } = await supabase
        .from('conversation_labels')
        .delete()
        .eq('conversation_id', conversation.id)
        .eq('label_id', labelId)
      if (deleteErr) {
        setError(deleteErr.message)
        return
      }
    }
    await loadLabels()
  }

  if (!workspaceId) {
    return <p className="text-slate-500">Missing workspace.</p>
  }

  return (
    <div className="flex h-[calc(100vh-3rem)] min-h-[680px] flex-col space-y-4 pb-16 lg:pb-0">
      <PageHeader
        title={view === 'unread' ? 'Unread conversations' : view === 'assigned' ? 'Assigned to me' : 'All conversations'}
        description="Pick a contact, review logged inbound/outbound messages, and send WhatsApp text messages through the connected session."
      />
      <FormError message={error} />

      <div className="grid min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white lg:grid-cols-[280px_1fr] dark:border-slate-800 dark:bg-slate-900/40">
        <aside className={`flex min-h-0 flex-col border-b border-slate-200 dark:border-slate-800 lg:border-b-0 lg:border-r ${mobileConversationOpen ? 'hidden lg:flex' : 'flex'}`}>
          <div className="shrink-0 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <h2 className="text-sm font-medium text-slate-900 dark:text-white">Conversations</h2>
            <p className="text-xs text-slate-500">{visibleContacts.length} visible chats</p>
            <TextInput
              value={conversationSearch}
              onChange={(event) => setConversationSearch(event.target.value)}
              placeholder="Search name, phone, JID, or messages..."
              className="mt-3"
            />
            {conversationSearch.trim() ? (
              <p className="mt-2 text-xs text-slate-500">
                {messageMatches.length} message match{messageMatches.length === 1 ? '' : 'es'} across conversations
              </p>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {visibleContacts.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">No contacts yet. Add one in Contacts first.</p>
            ) : (
              visibleContacts.map((contact) => (
                <button
                  key={contact.id}
                  type="button"
                  onClick={() => {
                    setSelectedContactId(contact.id)
                    setMobileConversationOpen(true)
                  }}
                  className={`block w-full border-b border-slate-200 px-4 py-3 text-left transition dark:border-slate-800 ${
                    selectedContactId === contact.id
                      ? 'bg-cyan-500/10 text-slate-900 dark:text-white'
                      : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/70'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-medium">{contactLabel(contact)}</p>
                    {isGroup(contact) ? (
                      <span className="rounded-full border border-sky-500/40 px-2 py-0.5 text-[10px] text-sky-300">Group</span>
                    ) : null}
                    {unreadCount(contact) > 0 ? (
                      <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] text-white">{unreadCount(contact)}</span>
                    ) : null}
                  </div>
                  {latestMessageBody(contact) ? (
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">{latestMessageBody(contact)}</p>
                  ) : null}
                  {messageMatches.some((message) => message.contact_id === contact.id || message.wa_chat_jid === contact.wa_jid) ? (
                    <p className="truncate text-xs text-cyan-300">Matched message text</p>
                  ) : null}
                  {labelsForContact(contact.id).length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {labelsForContact(contact.id).map((label) => (
                        <span key={label.id} className="rounded-full px-2 py-0.5 text-[10px] text-white" style={{ backgroundColor: label.color }}>
                          {label.name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {assignedTo(contact) ? (
                    <div className="mt-2 inline-flex max-w-full items-center gap-2 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-200">
                      <span className="h-2 w-2 rounded-full bg-cyan-400" />
                      <span className="truncate">
                        Assigned: <span className="font-medium text-cyan-100">{assigneeLabel(contact)}</span>
                      </span>
                    </div>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </aside>

        <section className={`flex min-h-0 min-w-0 flex-col ${mobileConversationOpen ? 'flex' : 'hidden lg:flex'}`}>
          <header className="shrink-0 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            {selectedContact ? (
              <>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300 lg:hidden"
                    onClick={() => setMobileConversationOpen(false)}
                  >
                    Back
                  </button>
                  <h2 className="font-medium text-slate-900 dark:text-white">{contactLabel(selectedContact)}</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <ContactIdWithHoverJid contact={selectedContact} className="min-w-[240px]" />
                  {isGroup(selectedContact) ? (
                    <span className="rounded-full border border-sky-500/40 px-2 py-0.5 text-xs text-sky-300">Group thread</span>
                  ) : null}
                  {conversation ? (
                    <span className="rounded-full border border-slate-300 px-2 py-0.5 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-400">
                      Conversation: {conversation.status}
                    </span>
                  ) : null}
                  {assignedTo(selectedContact) ? (
                    <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-200">
                      Assigned to <span className="font-medium text-cyan-100">{assigneeLabel(selectedContact)}</span>
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedLabels.map((label) => (
                    <span key={label.id} className="rounded-full px-2 py-0.5 text-xs text-white" style={{ backgroundColor: label.color }}>
                      {label.name}
                    </span>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => void assignToMe()}>
                    Assign to me{user?.user_metadata?.display_name ? ` (${String(user.user_metadata.display_name)})` : ''}
                  </Button>
                  <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => void markRead()}>
                    Mark read
                  </Button>
                  <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => void markUnread()}>
                    Mark as unread
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="px-3 py-1.5 text-xs"
                    disabled={!selectedInstanceId || syncingChat}
                    onClick={() => void syncSelectedChat()}
                  >
                    {syncingChat ? 'Syncing…' : 'Sync this chat'}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="px-3 py-1.5 text-xs"
                    disabled={!conversation || conversation.status !== 'open'}
                    onClick={() => void setConversationStatus('closed')}
                  >
                    Close chat
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="px-3 py-1.5 text-xs"
                    disabled={!conversation || conversation.status !== 'open'}
                    onClick={() => void setConversationStatus('deleted')}
                  >
                    Delete chat
                  </Button>
                </div>
                <TextInput
                  value={chatSearch}
                  onChange={(event) => setChatSearch(event.target.value)}
                  placeholder="Search this chat..."
                  className="mt-3 max-w-sm"
                />
                {labels.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {labels.map((label) => {
                      const checked = selectedLabels.some((selected) => selected.id === label.id)
                      return (
                        <label
                          key={label.id}
                          className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-xs ${
                            checked
                              ? 'border-cyan-500/60 bg-cyan-500/10 text-slate-900 dark:text-white'
                              : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!conversation}
                            onChange={(event) => void toggleConversationLabel(label.id, event.target.checked)}
                          />
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: label.color }} />
                          {label.name}
                        </label>
                      )
                    })}
                  </div>
                ) : null}
                {syncNotice ? <p className="mt-2 text-xs text-cyan-300">{syncNotice}</p> : null}
              </>
            ) : (
              <h2 className="font-medium text-slate-500">Select a contact</h2>
            )}
          </header>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50/80 p-4 dark:bg-slate-950/40">
            {!selectedContact ? (
              <p className="text-sm text-slate-500">Choose a contact to open the conversation.</p>
            ) : messages.length === 0 ? (
              <p className="text-sm text-slate-500">No messages logged yet. Send the first one below.</p>
            ) : visibleMessages.length === 0 ? (
              <p className="text-sm text-slate-500">No messages match this chat search.</p>
            ) : (
              <>
                {!chatSearch.trim() && messageCount > messages.length ? (
                  <div className="flex justify-center">
                    <Button
                      type="button"
                      variant="secondary"
                      className="px-3 py-1.5 text-xs"
                      onClick={() => setMessageLimit((current) => current + MESSAGE_PAGE_SIZE)}
                    >
                      Load older history ({messages.length}/{messageCount})
                    </Button>
                  </div>
                ) : null}
                {visibleMessages.map((message) => {
                  const media = mediaFromRaw(message)
                  const isMediaPlaceholder = message.body === '[image]' || message.body === '[video]'
                  const participantJid = senderFromRaw(message)
                  const participantName =
                    contactNameByJid.get(normalizeJid(participantJid)) ||
                    contactNameByJid.get(phoneFromJid(participantJid))
                  return (
                  <div key={message.id} className={`flex ${message.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm shadow ${
                        message.direction === 'outbound'
                          ? 'bg-cyan-600 text-white'
                          : 'bg-white text-slate-800 border border-slate-200 dark:border-0 dark:bg-slate-800 dark:text-slate-100'
                      }`}
                    >
                      {media ? (
                        <div className="mb-2 space-y-1">
                          <p className="text-[11px] font-medium uppercase tracking-wide opacity-80">{media.kind}</p>
                          {media.kind === 'image' ? (
                            <a href={mediaBlobUrls[message.id] ?? '#'} target="_blank" rel="noreferrer">
                              <img
                                src={mediaBlobUrls[message.id] ?? ''}
                                alt="WhatsApp media"
                                className="max-h-56 rounded-lg border border-black/10 object-contain"
                                loading="lazy"
                              />
                            </a>
                          ) : media.kind === 'video' ? (
                            <video controls preload="metadata" className="max-h-64 rounded-lg border border-black/10">
                              <source src={mediaBlobUrls[message.id] ?? ''} />
                            </video>
                          ) : media.url ? (
                            <a href={media.url} target="_blank" rel="noreferrer" className="text-xs underline underline-offset-2 opacity-90">
                              Open {media.kind}
                            </a>
                          ) : (
                            <p className="text-xs opacity-80">{media.kind} received</p>
                          )}
                          {media.caption ? <p className="whitespace-pre-wrap">{media.caption}</p> : null}
                        </div>
                      ) : null}
                      {isGroup(selectedContact) && participantJid && message.direction === 'inbound' ? (
                        <p className="mb-1 text-[10px] text-sky-300">
                          <span className="font-medium">{participantName ?? participantJid}</span>
                          {participantName ? <span className="ml-1 font-mono opacity-80">({participantJid})</span> : null}
                        </p>
                      ) : null}
                      {message.body && !(media && isMediaPlaceholder) ? <p className="whitespace-pre-wrap">{message.body}</p> : null}
                      <p
                        className={`mt-1 text-[10px] ${
                          message.direction === 'outbound' ? 'text-cyan-100/80' : 'text-slate-500'
                        }`}
                      >
                        {new Date(message.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                )})}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          <form onSubmit={sendMessage} className="shrink-0 border-t border-slate-200 p-3 dark:border-slate-800">
            <div className="flex gap-2">
            <select
              value={selectedInstanceId}
              onChange={(event) => setSelectedInstanceId(event.target.value)}
              className="hidden max-w-[220px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-white sm:block"
            >
              {instances.length === 0 ? (
                <option value="">No WhatsApp number</option>
              ) : (
                instances.map((instance) => (
                  <option key={instance.id} value={instance.id}>
                    {instance.display_name || 'WhatsApp'} ({instance.pairing_status})
                  </option>
                ))
              )}
            </select>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={!selectedContact || sending}
              rows={2}
              placeholder={selectedContact ? 'Type a WhatsApp message…' : 'Select a contact first'}
              className="min-h-[52px] flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-cyan-500/50 focus:ring-2 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
            <Button type="submit" disabled={!selectedContact || sending || !draft.trim() || !selectedInstanceId} className="self-end">
              {sending ? 'Sending…' : 'Send'}
            </Button>
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}
