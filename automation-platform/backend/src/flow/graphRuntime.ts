export type GraphNode =
  | { type: 'send'; templateId: string; to?: string; next?: string }
  | {
      type: 'branch'
      options: Array<{ id: string; next: string; label: string; hint: string }>
      routingInstructions?: string
      expectedReplyCount?: number
      fallbackNext?: string
    }
  | {
      type: 'condition'
      variable: string
      operator: 'exists' | 'equals' | 'contains'
      value?: string
      trueNext: string
      falseNext?: string
    }
  | { type: 'updateContact'; path: string; value: string; next?: string }
  | { type: 'assignConversation'; assignee: string; next?: string }
  | { type: 'delayUntil'; until: string; next?: string }
  | { type: 'webhookResponse'; body?: string; next?: string }
  | {
      type: 'aiSkill'
      instructions: string
      outputVariable?: string
      sendAsMessage?: boolean
      next?: string
    }
  | { type: 'end' }

export type AutomationGraph = {
  entry: string
  nodes: Record<string, GraphNode>
}

export function applyTemplateVars(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key: string) => {
    const k = key.trim()
    return vars[k] ?? ''
  })
}

function stringifyAttrValue(value: unknown): string {
  if (value == null) return ''
  if (
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'value' in value &&
    Object.keys(value as Record<string, unknown>).some((key) => key === 'type' || key === 'value')
  ) {
    return stringifyAttrValue((value as { value?: unknown }).value)
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    return value.map((v) => stringifyAttrValue(v)).filter(Boolean).join(', ')
  }
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

/**
 * Maps DB contact row + JSON `metadata` (custom attributes) into template keys.
 * Use in templates: {{contact.first_name}}, {{contact.display_name}}, {{contact.phone_e164}},
 * and for each typed custom attribute `plan` → {{contact.attr.plan}}.
 */
export function buildContactPlaceholderVars(contact: {
  display_name: string | null
  phone_e164: string | null
  wa_jid: string
  notes: string | null
  metadata: Record<string, unknown> | null | undefined
}): Record<string, string> {
  const meta =
    contact.metadata && typeof contact.metadata === 'object' && !Array.isArray(contact.metadata)
      ? contact.metadata
      : {}
  const out: Record<string, string> = {
    'contact.first_name': stringifyAttrValue(meta.first_name),
    'contact.last_name': stringifyAttrValue(meta.last_name),
    'contact.gender': stringifyAttrValue(meta.gender),
    'contact.birthday': stringifyAttrValue(meta.birthday),
    'contact.display_name': contact.display_name ?? '',
    'contact.phone_e164': contact.phone_e164 ?? '',
    'contact.wa_jid': contact.wa_jid,
    'contact.notes': contact.notes ?? '',
  }

  const customAttributes =
    meta.custom_attributes &&
    typeof meta.custom_attributes === 'object' &&
    !Array.isArray(meta.custom_attributes)
      ? (meta.custom_attributes as Record<string, unknown>)
      : null

  if (customAttributes) {
    for (const [rawKey, value] of Object.entries(customAttributes)) {
      const safe = rawKey.replace(/[^\w.-]/g, '_')
      out[`contact.attr.${safe}`] = stringifyAttrValue(value)
    }
  }

  const reservedKeys = new Set(['first_name', 'last_name', 'gender', 'birthday', 'custom_attributes'])
  for (const [rawKey, value] of Object.entries(meta)) {
    if (reservedKeys.has(rawKey)) continue
    const safe = rawKey.replace(/[^\w.-]/g, '_')
    out[`contact.attr.${safe}`] = stringifyAttrValue(value)
  }
  return out
}

export function parseGraph(raw: unknown): AutomationGraph | null {
  if (!raw || typeof raw !== 'object') return null
  const g = raw as Record<string, unknown>
  if (typeof g.entry !== 'string' || !g.nodes || typeof g.nodes !== 'object') return null
  return { entry: g.entry, nodes: g.nodes as Record<string, GraphNode> }
}

export function readVariable(path: string, vars: Record<string, string>): string {
  return vars[path] ?? ''
}

export function parseGptBranchChoice(content: string): string | null {
  const trimmed = content.trim()
  try {
    const j = JSON.parse(trimmed) as { chosenOptionId?: string }
    if (j.chosenOptionId && typeof j.chosenOptionId === 'string') return j.chosenOptionId
  } catch {
    const m = trimmed.match(/"chosenOptionId"\s*:\s*"([^"]+)"/)
    if (m) return m[1] ?? null
  }
  return null
}
