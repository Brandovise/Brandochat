import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useWorkspaceId } from '../shared/hooks/useWorkspaceId'
import { Button } from '../shared/ui/button'
import { FormError } from '../shared/ui/form-error'
import { FormField } from '../shared/ui/form-field'
import { PageHeader } from '../shared/ui/page-header'
import { TextInput } from '../shared/ui/text-input'

type Contact = {
  id: string
  wa_jid: string
  phone_e164: string | null
  display_name: string | null
  notes: string | null
  metadata: Record<string, unknown> | null
}

type ContactList = {
  id: string
  name: string
  color: string
  description: string | null
}

type ContactTag = {
  id: string
  name: string
  color: string
}

type AttributeType = 'string' | 'date' | 'datetime' | 'url' | 'integer'

type WorkspaceContactField = {
  id: string
  key: string
  label: string
  type: AttributeType
  required: boolean
}

type ContactColumn = {
  id: string
  label: string
}

const GENDER_OPTIONS = ['', 'female', 'male', 'non_binary', 'unknown'] as const
const PAGE_SIZE = 1000
const CONTACT_COLUMNS_STORAGE_KEY = 'contacts_table_columns_v1'
const DEFAULT_CONTACT_COLUMNS = ['name', 'conversations', 'phone', 'labels', 'actions']

function attributeInputType(type: AttributeType): React.HTMLInputTypeAttribute {
  if (type === 'date') return 'date'
  if (type === 'datetime') return 'datetime-local'
  if (type === 'url') return 'url'
  if (type === 'integer') return 'number'
  return 'text'
}

function safeAttributeKey(name: string): string {
  return name.trim().replace(/[^\w.-]/g, '_')
}

function metadataFromForm(input: {
  firstName: string
  lastName: string
  gender: string
  birthday: string
  fieldDefinitions: WorkspaceContactField[]
  fieldValues: Record<string, string>
  baseMetadata?: Record<string, unknown> | null
}): Record<string, unknown> {
  const customAttributes: Record<string, { type: AttributeType; value: string | number }> = {}
  for (const definition of input.fieldDefinitions) {
    const key = safeAttributeKey(definition.key)
    if (!key) continue
    const rawValue = input.fieldValues[key] ?? ''
    if (!rawValue && !definition.required) continue
    customAttributes[key] = {
      type: definition.type,
      value: definition.type === 'integer' ? Number(rawValue || 0) : rawValue,
    }
  }

  return {
    ...(input.baseMetadata ?? {}),
    first_name: input.firstName.trim(),
    last_name: input.lastName.trim(),
    gender: input.gender || null,
    birthday: input.birthday || null,
    custom_attributes: customAttributes,
  }
}

function normalizePhoneE164(value: string): string | null {
  const digits = value.replace(/\D/g, '')
  return digits ? `+${digits}` : null
}

function phoneFromJid(jid: string): string | null {
  if (!jid.endsWith('@s.whatsapp.net')) return null
  return normalizePhoneE164(jid.split('@')[0] ?? '')
}

function displayName(firstName: string, lastName: string): string | null {
  return [firstName.trim(), lastName.trim()].filter(Boolean).join(' ') || null
}

function standardField(row: Contact, key: string): string {
  const value = row.metadata?.[key]
  return typeof value === 'string' ? value : ''
}

function attributeValuesFromMetadata(metadata: Contact['metadata']): Record<string, string> {
  const raw = metadata?.custom_attributes
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}

  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).map(([name, value]) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const typed = value as { value?: unknown }
        return [name, typed.value == null ? '' : String(typed.value)]
      }
      return [name, String(value ?? '')]
    }),
  )
}

function customAttributePills(metadata: Contact['metadata']): Array<{ key: string; value: string }> {
  const raw = metadata?.custom_attributes
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  return Object.entries(raw as Record<string, unknown>).map(([name, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const typed = value as { value?: unknown }
      return { key: name, value: typed.value == null ? '' : String(typed.value) }
    }
    return { key: name, value: String(value ?? '') }
  })
}

export default function ContactsPage() {
  const [searchParams] = useSearchParams()
  const workspaceId = useWorkspaceId()
  const view = searchParams.get('view') ?? 'all'
  const selectedListFilter = searchParams.get('list') ?? ''
  const selectedTagFilter = searchParams.get('tag') ?? ''
  const [rows, setRows] = useState<Contact[]>([])
  const [contactFields, setContactFields] = useState<WorkspaceContactField[]>([])
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([])
  const [lists, setLists] = useState<ContactList[]>([])
  const [tags, setTags] = useState<ContactTag[]>([])
  const [listMemberships, setListMemberships] = useState<Array<{ list_id: string; contact_id: string }>>([])
  const [tagMemberships, setTagMemberships] = useState<Array<{ tag_id: string; contact_id: string }>>([])
  const [newListName, setNewListName] = useState('')
  const [newListColor, setNewListColor] = useState('#10b981')
  const [newTagName, setNewTagName] = useState('')
  const [newTagColor, setNewTagColor] = useState('#0ea5e9')
  const [editingListId, setEditingListId] = useState<string | null>(null)
  const [editingListName, setEditingListName] = useState('')
  const [editingListColor, setEditingListColor] = useState('#10b981')
  const [editingTagId, setEditingTagId] = useState<string | null>(null)
  const [editingTagName, setEditingTagName] = useState('')
  const [editingTagColor, setEditingTagColor] = useState('#0ea5e9')
  const [selectedListId, setSelectedListId] = useState('')
  const [selectedTagId, setSelectedTagId] = useState('')
  const [waJid, setWaJid] = useState('')
  const [phone, setPhone] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [gender, setGender] = useState('')
  const [birthday, setBirthday] = useState('')
  const [notes, setNotes] = useState('')
  const [attributeValues, setAttributeValues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editWaJid, setEditWaJid] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editDisplayName, setEditDisplayName] = useState('')
  const [editFirstName, setEditFirstName] = useState('')
  const [editLastName, setEditLastName] = useState('')
  const [editGender, setEditGender] = useState('')
  const [editBirthday, setEditBirthday] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editAttributeValues, setEditAttributeValues] = useState<Record<string, string>>({})
  const [showCreate, setShowCreate] = useState(false)
  const [showColumnsPopup, setShowColumnsPopup] = useState(false)
  const [columnOrder, setColumnOrder] = useState<string[]>(DEFAULT_CONTACT_COLUMNS)
  const [filterField, setFilterField] = useState<string>('all')
  const [filterMode, setFilterMode] = useState<'has' | 'missing'>('has')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    if (!workspaceId) return
    const allRows: Contact[] = []
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error: loadErr } = await supabase
        .from('contacts')
        .select('id, wa_jid, phone_e164, display_name, notes, metadata')
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
    setRows(allRows)
  }, [workspaceId])

  const loadListsAndTags = useCallback(async () => {
    if (!workspaceId) return
    const [{ data: listRows, error: listErr }, { data: tagRows, error: tagErr }, { data: listMemberRows }, { data: tagMemberRows }] = await Promise.all([
      supabase.from('workspace_contact_lists').select('id, name, color, description').eq('workspace_id', workspaceId).order('name'),
      supabase.from('workspace_contact_tags').select('id, name, color').eq('workspace_id', workspaceId).order('name'),
      supabase.from('contact_list_members').select('list_id, contact_id').eq('workspace_id', workspaceId),
      supabase.from('contact_tag_members').select('tag_id, contact_id').eq('workspace_id', workspaceId),
    ])
    if (listErr) {
      setError(listErr.message)
      return
    }
    if (tagErr) {
      setError(tagErr.message)
      return
    }
    setLists((listRows as ContactList[] | null) ?? [])
    setTags((tagRows as ContactTag[] | null) ?? [])
    setListMemberships((listMemberRows as Array<{ list_id: string; contact_id: string }> | null) ?? [])
    setTagMemberships((tagMemberRows as Array<{ tag_id: string; contact_id: string }> | null) ?? [])
  }, [workspaceId])

  const loadContactFields = useCallback(async () => {
    if (!workspaceId) return
    const { data, error: loadErr } = await supabase
      .from('workspace_contact_fields')
      .select('id, key, label, type, required')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true })
    if (loadErr) {
      setError(loadErr.message)
      return
    }
    setContactFields((data as WorkspaceContactField[] | null) ?? [])
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadListsAndTags()
  }, [loadListsAndTags])

  useEffect(() => {
    void loadContactFields()
  }, [loadContactFields])

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault()
    if (!workspaceId) return
    setError(null)
    const metadata = metadataFromForm({
      firstName,
      lastName,
      gender,
      birthday,
      fieldDefinitions: contactFields,
      fieldValues: attributeValues,
    })
    const { error: insertErr } = await supabase.from('contacts').insert({
      workspace_id: workspaceId,
      wa_jid: waJid.trim(),
      phone_e164: normalizePhoneE164(phone) ?? phoneFromJid(waJid.trim()),
      display_name: displayName(firstName, lastName),
      notes: notes.trim() || null,
      metadata,
    })
    if (insertErr) {
      setError(insertErr.message)
      return
    }
    setWaJid('')
    setPhone('')
    setFirstName('')
    setLastName('')
    setGender('')
    setBirthday('')
    setNotes('')
    setAttributeValues({})
    await load()
  }

  function openEditor(row: Contact) {
    setEditingId(row.id)
    setEditWaJid(row.wa_jid)
    setEditPhone(row.phone_e164 ?? '')
    setEditDisplayName(row.display_name ?? '')
    setEditFirstName(standardField(row, 'first_name'))
    setEditLastName(standardField(row, 'last_name'))
    setEditGender(standardField(row, 'gender'))
    setEditBirthday(standardField(row, 'birthday'))
    setEditNotes(row.notes ?? '')
    setEditAttributeValues(attributeValuesFromMetadata(row.metadata))
    setError(null)
  }

  async function saveContact(rowId: string) {
    setError(null)
    const currentRow = rows.find((row) => row.id === rowId)
    const metadata = metadataFromForm({
      firstName: editFirstName,
      lastName: editLastName,
      gender: editGender,
      birthday: editBirthday,
      fieldDefinitions: contactFields,
      fieldValues: editAttributeValues,
      baseMetadata: currentRow?.metadata ?? null,
    })
    const nextDisplayName = editDisplayName.trim() || displayName(editFirstName, editLastName)
    const nextWaJid = editWaJid.trim()
    const { error: updateErr } = await supabase
      .from('contacts')
      .update({
        wa_jid: nextWaJid,
        phone_e164: normalizePhoneE164(editPhone) ?? phoneFromJid(nextWaJid),
        display_name: nextDisplayName,
        notes: editNotes.trim() || null,
        metadata,
      })
      .eq('id', rowId)
    if (updateErr) {
      setError(updateErr.message)
      return
    }
    setEditingId(null)
    await load()
  }

  async function createList(event: React.FormEvent) {
    event.preventDefault()
    if (!workspaceId || !newListName.trim()) return
    setError(null)
    const { error: insertErr } = await supabase.from('workspace_contact_lists').insert({
      workspace_id: workspaceId,
      name: newListName.trim(),
      color: newListColor,
    })
    if (insertErr) {
      setError(insertErr.message)
      return
    }
    setNewListName('')
    await loadListsAndTags()
  }

  async function createTag(event: React.FormEvent) {
    event.preventDefault()
    if (!workspaceId || !newTagName.trim()) return
    setError(null)
    const { error: insertErr } = await supabase.from('workspace_contact_tags').insert({
      workspace_id: workspaceId,
      name: newTagName.trim(),
      color: newTagColor,
    })
    if (insertErr) {
      setError(insertErr.message)
      return
    }
    setNewTagName('')
    await loadListsAndTags()
  }

  function startEditList(list: ContactList) {
    setEditingListId(list.id)
    setEditingListName(list.name)
    setEditingListColor(list.color)
  }

  async function saveList() {
    if (!workspaceId || !editingListId || !editingListName.trim()) return
    setError(null)
    const { error: updateErr } = await supabase
      .from('workspace_contact_lists')
      .update({ name: editingListName.trim(), color: editingListColor })
      .eq('workspace_id', workspaceId)
      .eq('id', editingListId)
    if (updateErr) {
      setError(updateErr.message)
      return
    }
    setEditingListId(null)
    setEditingListName('')
    await loadListsAndTags()
  }

  async function deleteList(listId: string) {
    if (!workspaceId) return
    setError(null)
    const { error: deleteMembersErr } = await supabase
      .from('contact_list_members')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('list_id', listId)
    if (deleteMembersErr) {
      setError(deleteMembersErr.message)
      return
    }
    const { error: deleteErr } = await supabase
      .from('workspace_contact_lists')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('id', listId)
    if (deleteErr) {
      setError(deleteErr.message)
      return
    }
    await loadListsAndTags()
  }

  function startEditTag(tag: ContactTag) {
    setEditingTagId(tag.id)
    setEditingTagName(tag.name)
    setEditingTagColor(tag.color)
  }

  async function saveTag() {
    if (!workspaceId || !editingTagId || !editingTagName.trim()) return
    setError(null)
    const { error: updateErr } = await supabase
      .from('workspace_contact_tags')
      .update({ name: editingTagName.trim(), color: editingTagColor })
      .eq('workspace_id', workspaceId)
      .eq('id', editingTagId)
    if (updateErr) {
      setError(updateErr.message)
      return
    }
    setEditingTagId(null)
    setEditingTagName('')
    await loadListsAndTags()
  }

  async function deleteTag(tagId: string) {
    if (!workspaceId) return
    setError(null)
    const { error: deleteMembersErr } = await supabase
      .from('contact_tag_members')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('tag_id', tagId)
    if (deleteMembersErr) {
      setError(deleteMembersErr.message)
      return
    }
    const { error: deleteErr } = await supabase
      .from('workspace_contact_tags')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('id', tagId)
    if (deleteErr) {
      setError(deleteErr.message)
      return
    }
    await loadListsAndTags()
  }

  async function addSelectedToList() {
    if (!workspaceId || !selectedListId || selectedContactIds.length === 0) return
    setError(null)
    const payload = selectedContactIds.map((contactId) => ({ workspace_id: workspaceId, list_id: selectedListId, contact_id: contactId }))
    const { error: insertErr } = await supabase.from('contact_list_members').upsert(payload, { onConflict: 'list_id,contact_id' })
    if (insertErr) {
      setError(insertErr.message)
      return
    }
    await loadListsAndTags()
  }

  async function addSelectedToTag() {
    if (!workspaceId || !selectedTagId || selectedContactIds.length === 0) return
    setError(null)
    const payload = selectedContactIds.map((contactId) => ({ workspace_id: workspaceId, tag_id: selectedTagId, contact_id: contactId }))
    const { error: insertErr } = await supabase.from('contact_tag_members').upsert(payload, { onConflict: 'tag_id,contact_id' })
    if (insertErr) {
      setError(insertErr.message)
      return
    }
    await loadListsAndTags()
  }

  if (!workspaceId) {
    return <p className="text-slate-500">Missing workspace.</p>
  }

  const visibleRows = useMemo(
    () =>
      rows.filter((row) => {
        const haystack = [row.display_name, row.wa_jid, row.phone_e164, standardField(row, 'first_name'), standardField(row, 'last_name')]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(search.toLowerCase())) return false
        if (selectedListFilter && !listMemberships.some((member) => member.list_id === selectedListFilter && member.contact_id === row.id)) return false
        if (selectedTagFilter && !tagMemberships.some((member) => member.tag_id === selectedTagFilter && member.contact_id === row.id)) return false
        if (filterField !== 'all') {
          let value = ''
          if (filterField === 'display_name') value = row.display_name ?? ''
          else if (filterField === 'phone_e164') value = row.phone_e164 ?? ''
          else if (filterField === 'wa_jid') value = row.wa_jid ?? ''
          else if (filterField === 'notes') value = row.notes ?? ''
          else if (filterField === 'first_name') value = standardField(row, 'first_name')
          else if (filterField === 'last_name') value = standardField(row, 'last_name')
          else if (filterField === 'gender') value = standardField(row, 'gender')
          else if (filterField === 'birthday') value = standardField(row, 'birthday')
          else if (filterField.startsWith('attr:')) {
            const key = filterField.replace(/^attr:/, '')
            value = attributeValuesFromMetadata(row.metadata)[key] ?? ''
          }
          const hasValue = value.trim().length > 0
          if (filterMode === 'has' && !hasValue) return false
          if (filterMode === 'missing' && hasValue) return false
        }
        return true
      }),
    [rows, search, selectedListFilter, selectedTagFilter, listMemberships, tagMemberships, filterField, filterMode],
  )

  const filterableFields = useMemo(
    () => [
      { id: 'display_name', label: 'Display name' },
      { id: 'phone_e164', label: 'Phone' },
      { id: 'wa_jid', label: 'WhatsApp JID' },
      { id: 'notes', label: 'Notes' },
      { id: 'first_name', label: 'First name' },
      { id: 'last_name', label: 'Last name' },
      { id: 'gender', label: 'Gender' },
      { id: 'birthday', label: 'Birthday' },
      ...contactFields.map((field) => ({ id: `attr:${field.key}`, label: field.label || field.key })),
    ],
    [contactFields],
  )

  const availableColumns = useMemo<ContactColumn[]>(() => {
    const base: ContactColumn[] = [
      { id: 'name', label: 'Name' },
      { id: 'conversations', label: 'Conversations' },
      { id: 'email', label: 'Email' },
      { id: 'phone', label: 'Phone' },
      { id: 'gender', label: 'Gender' },
      { id: 'birthday', label: 'Birthday' },
      { id: 'notes', label: 'Notes' },
      { id: 'labels', label: 'Labels' },
      { id: 'actions', label: 'Actions' },
    ]
    const custom = contactFields.map((field) => ({ id: `attr:${field.key}`, label: field.label || field.key }))
    return [...base, ...custom]
  }, [contactFields])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CONTACT_COLUMNS_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as string[]
      if (Array.isArray(parsed) && parsed.length > 0) setColumnOrder(parsed)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    setColumnOrder((current) => {
      const known = new Set(availableColumns.map((column) => column.id))
      const cleaned = current.filter((id) => known.has(id))
      const required = DEFAULT_CONTACT_COLUMNS.filter((id) => known.has(id))
      const next = [...new Set([...cleaned, ...required])]
      return next.length > 0 ? next : required
    })
  }, [availableColumns])

  useEffect(() => {
    try {
      localStorage.setItem(CONTACT_COLUMNS_STORAGE_KEY, JSON.stringify(columnOrder))
    } catch {
      /* ignore */
    }
  }, [columnOrder])

  const selectedColumns = useMemo(() => {
    const byId = new Map(availableColumns.map((column) => [column.id, column]))
    return columnOrder.map((id) => byId.get(id)).filter((column): column is ContactColumn => Boolean(column))
  }, [availableColumns, columnOrder])

  function toggleColumn(columnId: string, checked: boolean) {
    setColumnOrder((current) => {
      if (checked) return [...new Set([...current, columnId])]
      const next = current.filter((id) => id !== columnId)
      return next.length > 0 ? next : current
    })
  }

  function moveColumn(columnId: string, direction: -1 | 1) {
    setColumnOrder((current) => {
      const index = current.indexOf(columnId)
      if (index < 0) return current
      const nextIndex = index + direction
      if (nextIndex < 0 || nextIndex >= current.length) return current
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(nextIndex, 0, item)
      return next
    })
  }

  function renderContactCell(row: Contact, columnId: string) {
    if (columnId === 'name') {
      return (
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700 dark:bg-slate-800/80 dark:text-slate-300">
            {(row.display_name || row.wa_jid).slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900 dark:text-white">{row.display_name || row.wa_jid}</p>
            <p className="truncate font-mono text-xs text-slate-500">{row.wa_jid}</p>
          </div>
        </div>
      )
    }
    if (columnId === 'conversations') return <span className="text-slate-600 dark:text-slate-500">WhatsApp</span>
    if (columnId === 'email') return <span className="text-slate-500">-</span>
    if (columnId === 'phone') return <span className="text-slate-700 dark:text-slate-300">{row.phone_e164 || '-'}</span>
    if (columnId === 'gender') return <span className="text-slate-700 dark:text-slate-300">{standardField(row, 'gender') || '-'}</span>
    if (columnId === 'birthday') return <span className="text-slate-700 dark:text-slate-300">{standardField(row, 'birthday') || '-'}</span>
    if (columnId === 'notes') return <span className="text-slate-700 dark:text-slate-300">{row.notes || '-'}</span>
    if (columnId === 'labels') {
      return (
        <div className="flex min-h-[28px] flex-wrap items-center gap-1.5">
          {[standardField(row, 'gender'), standardField(row, 'birthday')].filter(Boolean).map((label) => (
            <span key={label} className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] leading-none text-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
              {label}
            </span>
          ))}
          <AttributePills metadata={row.metadata} />
        </div>
      )
    }
    if (columnId === 'actions') {
      return (
        <Button type="button" variant="ghost" className="py-1.5 text-xs" onClick={() => openEditor(row)}>
          Edit
        </Button>
      )
    }
    if (columnId.startsWith('attr:')) {
      const key = columnId.replace(/^attr:/, '')
      const value = attributeValuesFromMetadata(row.metadata)[key] ?? ''
      return <span className="text-slate-700 dark:text-slate-300">{value || '-'}</span>
    }
    return <span className="text-slate-500">-</span>
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader
          title={
            view === 'lists'
              ? `Contact lists (${lists.length})`
              : view === 'tags'
                ? `Contact tags (${tags.length})`
                : `All contacts ${rows.length ? `(${rows.length})` : ''}`
          }
          description="Manage workspace contacts and custom attributes used in automation placeholders."
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" className="bg-white/5">
            Export all
          </Button>
          <Button type="button" variant="secondary" className="bg-white/5">
            Import
          </Button>
          <Button type="button" onClick={() => setShowCreate((value) => !value)}>
            {showCreate ? 'Close form' : 'New contact'}
          </Button>
        </div>
      </div>
      <FormError message={error} />

      {showCreate ? (
      <form onSubmit={handleCreate} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/40">
        <p className="text-sm text-slate-400">
          JID example: <code className="text-emerald-300">491234567890@s.whatsapp.net</code>
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="WhatsApp JID" className="sm:col-span-2">
            <TextInput required value={waJid} onChange={(e) => setWaJid(e.target.value)} placeholder="wa_jid" />
          </FormField>
          <FormField label="Phone (E.164)">
            <TextInput value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+491234567890" />
          </FormField>
          <FormField label="First name">
            <TextInput value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </FormField>
          <FormField label="Last name">
            <TextInput value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </FormField>
          <FormField label="Gender">
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            >
              {GENDER_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option ? option.replace('_', ' ') : 'Not set'}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Birthday">
            <TextInput type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
          </FormField>
        </div>
        <FormField label="Notes">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-cyan-500/50 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
        </FormField>
        <ConfiguredAttributesEditor
          definitions={contactFields}
          values={attributeValues}
          onChange={setAttributeValues}
          emptyLabel="No custom fields configured yet. Add them in Settings -> Contacts."
        />
        <Button type="submit" variant="primary">
          Add contact
        </Button>
      </form>
      ) : null}

      {editingId ? (
        <section className="rounded-2xl border border-cyan-500/30 bg-white p-4 shadow-xl shadow-slate-200/30 dark:bg-slate-900/80 dark:shadow-cyan-950/10">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-cyan-600 dark:text-cyan-300">Editing contact</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{editDisplayName || editWaJid}</h2>
              <p className="mt-1 font-mono text-xs text-slate-500">{editingId}</p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="primary" className="py-1.5 text-xs" onClick={() => void saveContact(editingId)}>
                Save contact
              </Button>
              <Button type="button" variant="secondary" className="py-1.5 text-xs" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Display name">
              <TextInput value={editDisplayName} onChange={(e) => setEditDisplayName(e.target.value)} placeholder="Customer name" />
            </FormField>
            <FormField label="WhatsApp JID">
              <TextInput value={editWaJid} onChange={(e) => setEditWaJid(e.target.value)} placeholder="491234567890@s.whatsapp.net" />
            </FormField>
            <FormField label="Phone">
              <TextInput value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="+491234567890" />
            </FormField>
            <FormField label="First name">
              <TextInput value={editFirstName} onChange={(e) => setEditFirstName(e.target.value)} />
            </FormField>
            <FormField label="Last name">
              <TextInput value={editLastName} onChange={(e) => setEditLastName(e.target.value)} />
            </FormField>
            <FormField label="Gender">
              <select
                value={editGender}
                onChange={(e) => setEditGender(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              >
                {GENDER_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option ? option.replace('_', ' ') : 'Not set'}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Birthday">
              <TextInput type="date" value={editBirthday} onChange={(e) => setEditBirthday(e.target.value)} />
            </FormField>
          </div>
          <FormField label="Notes" className="mt-3">
            <textarea
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-cyan-500/50 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </FormField>
          <div className="mt-3">
            <ConfiguredAttributesEditor
              definitions={contactFields}
              values={editAttributeValues}
              onChange={setEditAttributeValues}
              compact
              emptyLabel="No custom fields configured yet. Add them in Settings -> Contacts."
            />
          </div>
        </section>
      ) : null}

      {view === 'lists' ? (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/40">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Contact lists ({lists.length})</h2>
          </div>
          <form onSubmit={createList} className="grid gap-2 sm:grid-cols-[1fr_130px_auto]">
            <TextInput value={newListName} onChange={(event) => setNewListName(event.target.value)} placeholder="New list name" />
            <TextInput type="color" value={newListColor} onChange={(event) => setNewListColor(event.target.value)} />
            <Button type="submit">Create list</Button>
          </form>
          {lists.length === 0 ? <p className="text-sm text-slate-500">No lists yet.</p> : null}
          <div className="grid gap-2">
            {lists.map((list) => {
              const count = listMemberships.filter((member) => member.list_id === list.id).length
              return (
                <article key={list.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 transition hover:bg-slate-100 dark:border-slate-800/80 dark:bg-slate-900/70 dark:hover:bg-slate-800/60">
                  {editingListId === list.id ? (
                    <div className="space-y-2">
                      <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
                        <TextInput value={editingListName} onChange={(event) => setEditingListName(event.target.value)} placeholder="List name" />
                        <TextInput type="color" value={editingListColor} onChange={(event) => setEditingListColor(event.target.value)} />
                      </div>
                      <div className="flex gap-2">
                        <Button type="button" className="px-3 py-1.5 text-xs" onClick={() => void saveList()}>
                          Save
                        </Button>
                        <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setEditingListId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: list.color }} />
                      <p className="font-medium text-slate-900 dark:text-white">{list.name}</p>
                      <span className="ml-auto rounded-full bg-slate-200 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800/80 dark:text-slate-300">
                        {count} contacts
                      </span>
                      <Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={() => startEditList(list)}>
                        Edit
                      </Button>
                      <Button type="button" variant="ghost" className="px-2 py-1 text-xs text-rose-500" onClick={() => void deleteList(list.id)}>
                        Delete
                      </Button>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        </section>
      ) : null}

      {view === 'tags' ? (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/40">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Contact tags ({tags.length})</h2>
          </div>
          <form onSubmit={createTag} className="grid gap-2 sm:grid-cols-[1fr_130px_auto]">
            <TextInput value={newTagName} onChange={(event) => setNewTagName(event.target.value)} placeholder="New tag name" />
            <TextInput type="color" value={newTagColor} onChange={(event) => setNewTagColor(event.target.value)} />
            <Button type="submit">Create tag</Button>
          </form>
          {tags.length === 0 ? <p className="text-sm text-slate-500">No tags yet.</p> : null}
          <div className="grid gap-2">
            {tags.map((tag) => {
              const count = tagMemberships.filter((member) => member.tag_id === tag.id).length
              return (
                <article key={tag.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 transition hover:bg-slate-100 dark:border-slate-800/80 dark:bg-slate-900/70 dark:hover:bg-slate-800/60">
                  {editingTagId === tag.id ? (
                    <div className="space-y-2">
                      <div className="grid gap-2 sm:grid-cols-[1fr_120px]">
                        <TextInput value={editingTagName} onChange={(event) => setEditingTagName(event.target.value)} placeholder="Tag name" />
                        <TextInput type="color" value={editingTagColor} onChange={(event) => setEditingTagColor(event.target.value)} />
                      </div>
                      <div className="flex gap-2">
                        <Button type="button" className="px-3 py-1.5 text-xs" onClick={() => void saveTag()}>
                          Save
                        </Button>
                        <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setEditingTagId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: tag.color }} />
                      <p className="font-medium text-slate-900 dark:text-white">{tag.name}</p>
                      <span className="ml-auto rounded-full bg-slate-200 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800/80 dark:text-slate-300">
                        {count} contacts
                      </span>
                      <Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={() => startEditTag(tag)}>
                        Edit
                      </Button>
                      <Button type="button" variant="ghost" className="px-2 py-1 text-xs text-rose-500" onClick={() => void deleteTag(tag.id)}>
                        Delete
                      </Button>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        </section>
      ) : null}

      {view === 'all' ? (
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
          <TextInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search for contact..."
            className="max-w-md"
          />
          <div className="flex gap-2 text-xs text-slate-500">
            <span>Page size: 100</span>
            <span>1 / 1</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <select value={selectedListId} onChange={(event) => setSelectedListId(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
            <option value="">Choose list</option>
            {lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </select>
          <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" disabled={!selectedListId || selectedContactIds.length === 0} onClick={() => void addSelectedToList()}>
            Add selected to list
          </Button>
          <select value={selectedTagId} onChange={(event) => setSelectedTagId(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
            <option value="">Choose tag</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
          <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" disabled={!selectedTagId || selectedContactIds.length === 0} onClick={() => void addSelectedToTag()}>
            Add selected to tag
          </Button>
          <Button type="button" variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setShowColumnsPopup((value) => !value)}>
            Columns
          </Button>
          <select
            value={filterField}
            onChange={(event) => setFilterField(event.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          >
            <option value="all">All fields</option>
            {filterableFields.map((field) => (
              <option key={field.id} value={field.id}>
                {field.label}
              </option>
            ))}
          </select>
          {filterField !== 'all' ? (
            <select
              value={filterMode}
              onChange={(event) => setFilterMode(event.target.value as 'has' | 'missing')}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            >
              <option value="has">Has value</option>
              <option value="missing">Missing value</option>
            </select>
          ) : null}
          <span className="ml-auto text-xs text-slate-500">{selectedContactIds.length} selected</span>
        </div>
        {showColumnsPopup ? (
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/60">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Visible columns and order</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {availableColumns.map((column) => {
                const checked = columnOrder.includes(column.id)
                const index = columnOrder.indexOf(column.id)
                return (
                  <div key={column.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900">
                    <input type="checkbox" checked={checked} onChange={(event) => toggleColumn(column.id, event.target.checked)} />
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-700 dark:text-slate-300">{column.label}</span>
                    {checked ? (
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="rounded border border-slate-300 px-1 text-[10px] text-slate-600 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300"
                          onClick={() => moveColumn(column.id, -1)}
                          disabled={index <= 0}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="rounded border border-slate-300 px-1 text-[10px] text-slate-600 disabled:opacity-40 dark:border-slate-600 dark:text-slate-300"
                          onClick={() => moveColumn(column.id, 1)}
                          disabled={index < 0 || index >= columnOrder.length - 1}
                        >
                          ↓
                        </button>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-100 text-xs uppercase tracking-wide text-slate-600 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={visibleRows.length > 0 && selectedContactIds.length === visibleRows.length}
                    onChange={(event) => {
                      if (event.target.checked) setSelectedContactIds(visibleRows.map((row) => row.id))
                      else setSelectedContactIds([])
                    }}
                  />
                </th>
                {selectedColumns.map((column) => (
                  <th key={column.id} className={`px-4 py-3 ${column.id === 'actions' ? 'text-right' : ''}`}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80">
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={selectedColumns.length + 1} className="px-4 py-8 text-center text-slate-500">
                    No contacts found.
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => (
                  <tr key={row.id} className="align-middle hover:bg-slate-50 dark:hover:bg-slate-800/20">
                    <td className="whitespace-nowrap px-4 py-4">
                      <input
                        type="checkbox"
                        checked={selectedContactIds.includes(row.id)}
                        onChange={(event) => {
                          if (event.target.checked) setSelectedContactIds((current) => [...new Set([...current, row.id])])
                          else setSelectedContactIds((current) => current.filter((id) => id !== row.id))
                        }}
                      />
                    </td>
                    {selectedColumns.map((column) => (
                      <td key={`${row.id}-${column.id}`} className={`px-4 py-4 ${column.id === 'actions' ? 'whitespace-nowrap text-right' : 'align-middle'}`}>
                        {renderContactCell(row, column.id)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      ) : null}

    </div>
  )
}

function ConfiguredAttributesEditor({
  definitions,
  values,
  onChange,
  compact = false,
  emptyLabel,
}: {
  definitions: WorkspaceContactField[]
  values: Record<string, string>
  onChange: (values: Record<string, string>) => void
  compact?: boolean
  emptyLabel: string
}) {
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
      <div>
        <h2 className="text-sm font-medium text-slate-900 dark:text-white">Custom attributes</h2>
        {!compact ? (
          <p className="mt-1 text-xs text-slate-500">
            These are shared workspace fields configured in Settings and become placeholders like{' '}
            <code className="text-cyan-600 dark:text-cyan-300">{'{{contact.attr.meeting_datetime}}'}</code>.
          </p>
        ) : null}
      </div>
      {definitions.length === 0 ? <p className="text-xs text-slate-500">{emptyLabel}</p> : null}
      {definitions.map((field) => (
        <div key={field.id} className="grid gap-2 sm:grid-cols-[180px_1fr]">
          <label className="text-xs text-slate-600 dark:text-slate-400">
            {field.label}
            <span className="ml-1 font-mono text-slate-500">{field.key}</span>
            {field.required ? <span className="ml-1 text-rose-300">*</span> : null}
          </label>
          <TextInput
            type={attributeInputType(field.type)}
            step={field.type === 'integer' ? 1 : undefined}
            required={field.required}
            placeholder={field.type}
            value={values[field.key] ?? ''}
            onChange={(event) => onChange({ ...values, [field.key]: event.target.value })}
          />
        </div>
      ))}
    </section>
  )
}

function AttributePills({ metadata }: { metadata: Contact['metadata'] }) {
  const attrs = customAttributePills(metadata).filter((attr) => attr.key && attr.value)
  if (attrs.length === 0) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {attrs.map((attr) => (
        <span key={attr.key} className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] leading-none text-slate-700 dark:border-slate-700/80 dark:bg-slate-900 dark:text-slate-300">
          <span className="text-slate-500 dark:text-slate-400">{attr.key}:</span>{' '}
          <span className="text-cyan-700 dark:text-cyan-300/90">{attr.value}</span>
        </span>
      ))}
    </div>
  )
}
