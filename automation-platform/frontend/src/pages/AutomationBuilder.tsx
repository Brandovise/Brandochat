import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { supabase } from '../lib/supabase'
import { useTheme } from '../context/ThemeContext'
import { Button } from '../shared/ui/button'
import { FormError } from '../shared/ui/form-error'
import { FormField } from '../shared/ui/form-field'
import { PageHeader } from '../shared/ui/page-header'
import { TextInput } from '../shared/ui/text-input'

type TriggerType = 'conversation.created' | 'message.received' | 'contact.datetime' | 'webhook.received' | 'calendly.event'
type NodeType = 'send' | 'branch' | 'condition' | 'updateContact' | 'assignConversation' | 'delayUntil' | 'webhookResponse' | 'aiSkill' | 'end'
type BuilderNode = {
  id: string
  type: NodeType
  label: string
  data: Record<string, unknown>
  position?: { x: number; y: number }
}
type TemplateRow = { id: string; name: string; body?: string }
type WhatsAppInstanceRow = { id: string; display_name: string | null; pairing_status: string | null }
type WorkspaceContactFieldRow = { key: string; label: string; type: 'string' | 'date' | 'datetime' | 'url' | 'integer' }
type VariableOption = { value: string; label: string; group: string }
type PaletteGroup = { title: string; description: string; items: Array<{ type: NodeType; label: string }> }
type FlowNodeData = Record<string, unknown> & {
  builderNode: BuilderNode
  templates: TemplateRow[]
  allNodes: BuilderNode[]
  selected: boolean
  onSelect: (id: string) => void
}
type WorkflowFlowNode = Node<FlowNodeData, 'workflow'>
type TriggerFlowData = Record<string, unknown> & {
  triggerType: TriggerType
  triggerConfig: Record<string, unknown>
  selected: boolean
  onSelect: () => void
}
type TriggerFlowNode = Node<TriggerFlowData, 'trigger'>
type BuilderFlowNode = WorkflowFlowNode | TriggerFlowNode

const PALETTE_GROUPS: PaletteGroup[] = [
  {
    title: 'Input nodes',
    description: 'Wait for customer input and decide where it goes.',
    items: [{ type: 'branch', label: 'AI reply router' }],
  },
  {
    title: 'Output nodes',
    description: 'Send plain text templates or AI-written responses.',
    items: [
      { type: 'send', label: 'Send text template' },
      { type: 'aiSkill', label: 'AI skill response' },
    ],
  },
  {
    title: 'Action nodes',
    description: 'Update data, assign chats, delay, or finish the flow.',
    items: [
      { type: 'condition', label: 'Condition' },
      { type: 'updateContact', label: 'Update contact' },
      { type: 'assignConversation', label: 'Assign conversation' },
      { type: 'delayUntil', label: 'Delay until' },
      { type: 'webhookResponse', label: 'Webhook response' },
      { type: 'end', label: 'End' },
    ],
  },
]
const NODE_LABELS = Object.fromEntries(PALETTE_GROUPS.flatMap((group) => group.items).map((item) => [item.type, item.label])) as Record<NodeType, string>
const BASE_VARIABLE_OPTIONS: VariableOption[] = [
  { value: 'contact.phone_e164', label: 'Contact phone number', group: 'Contact' },
  { value: 'contact.wa_jid', label: 'Contact WhatsApp JID', group: 'Contact' },
  { value: 'contact.display_name', label: 'Contact display name', group: 'Contact' },
  { value: 'contact.first_name', label: 'Contact first name', group: 'Contact' },
  { value: 'contact.last_name', label: 'Contact last name', group: 'Contact' },
  { value: 'contact.gender', label: 'Contact gender', group: 'Contact' },
  { value: 'contact.birthday', label: 'Contact birthday', group: 'Contact' },
  { value: 'contact.notes', label: 'Contact notes', group: 'Contact' },
  { value: 'latestReply', label: 'Latest customer reply', group: 'Previous steps' },
  { value: 'chosenOptionId', label: 'Chosen AI route id', group: 'Previous steps' },
  { value: 'chosenRouteLabel', label: 'Chosen AI route label', group: 'Previous steps' },
  { value: 'skillReply', label: 'AI skill output', group: 'Previous steps' },
  { value: 'whatsappInstanceId', label: 'WhatsApp number id', group: 'Trigger' },
  { value: 'conversationStatus', label: 'Conversation status', group: 'Trigger' },
  { value: 'contactStatus', label: 'Contact status', group: 'Trigger' },
  { value: 'calendlyEvent', label: 'Calendly event name', group: 'Calendly trigger' },
  { value: 'inviteeName', label: 'Invitee name', group: 'Calendly trigger' },
  { value: 'inviteeEmail', label: 'Invitee email', group: 'Calendly trigger' },
  { value: 'inviteePhone', label: 'Invitee phone', group: 'Calendly trigger' },
  { value: 'inviteeStatus', label: 'Invitee status', group: 'Calendly trigger' },
  { value: 'inviteeRescheduleUrl', label: 'Invitee reschedule URL', group: 'Calendly trigger' },
  { value: 'inviteeCancelUrl', label: 'Invitee cancel URL', group: 'Calendly trigger' },
  { value: 'meetingName', label: 'Meeting name', group: 'Calendly trigger' },
  { value: 'meetingStart', label: 'Meeting start datetime', group: 'Calendly trigger' },
  { value: 'meetingEnd', label: 'Meeting end datetime', group: 'Calendly trigger' },
  { value: 'meetingJoinUrl', label: 'Meeting join URL (Google Meet)', group: 'Calendly trigger' },
  { value: 'eventType', label: 'Calendly event type URI', group: 'Calendly trigger' },
  { value: 'eventUri', label: 'Calendly event URI', group: 'Calendly trigger' },
  { value: 'timezone', label: 'Calendly timezone', group: 'Calendly trigger' },
]

function defaultNode(type: NodeType, index: number): BuilderNode {
  const id = `${type}_${index}`
  if (type === 'send') return { id, type, label: 'Send message', data: { templateId: '', to: 'Current conversation contact', next: '' } }
  if (type === 'branch') {
    return {
      id,
      type,
      label: 'AI reply router',
      data: {
        expectedReplyCount: 3,
        routingInstructions: 'Classify the customer reply into the best route. Accept natural language, numbers, and short answers.',
        fallbackNext: '',
        options: [
          { id: 'sales', label: 'Sales interest', hint: 'Customer asks about buying, pricing, or demos', next: '' },
          { id: 'support', label: 'Support request', hint: 'Customer needs help with an existing issue', next: '' },
          { id: 'other', label: 'Other', hint: 'Customer reply does not fit the other routes', next: '' },
        ],
      },
    }
  }
  if (type === 'condition') return { id, type, label: 'Condition', data: { variable: 'contact.attr.plan', operator: 'equals', value: '', trueNext: '', falseNext: '' } }
  if (type === 'updateContact') return { id, type, label: 'Update contact', data: { path: 'custom_status', value: '', next: '' } }
  if (type === 'assignConversation') return { id, type, label: 'Assign user', data: { assignee: '', next: '' } }
  if (type === 'delayUntil') return { id, type, label: 'Delay until', data: { until: '{{contact.attr.follow_up_at}}', next: '' } }
  if (type === 'webhookResponse') return { id, type, label: 'Webhook response', data: { body: '{"ok":true}', next: '' } }
  if (type === 'aiSkill') {
    return {
      id,
      type,
      label: 'AI skill',
      data: {
        instructions: 'Read {{latestReply}} and ask the customer one helpful follow-up question. Keep it concise and friendly.',
        outputVariable: 'skillReply',
        sendAsMessage: true,
        next: '',
      },
    }
  }
  return { id, type, label: 'End', data: {} }
}

function graphToNodes(graph: unknown): BuilderNode[] {
  if (!graph || typeof graph !== 'object' || !('nodes' in graph)) return [defaultNode('send', 1), defaultNode('end', 2)]
  const nodes = (graph as { nodes?: Record<string, Record<string, unknown>> }).nodes ?? {}
  return Object.entries(nodes).map(([id, node]) => ({
    id,
    type: node.type as NodeType,
    label: NODE_LABELS[node.type as NodeType] ?? String(node.type),
    data: Object.fromEntries(Object.entries(node).filter(([key]) => key !== 'type')),
  }))
}

function nodesToGraph(entry: string, nodes: BuilderNode[]) {
  return {
    entry,
    nodes: Object.fromEntries(nodes.map((node) => [node.id, { type: node.type, ...node.data }])),
  }
}

function triggerLabel(triggerType: TriggerType) {
  if (triggerType === 'conversation.created') return 'New conversation'
  if (triggerType === 'message.received') return 'Inbound message'
  if (triggerType === 'contact.datetime') return 'Contact date/time'
  if (triggerType === 'calendly.event') return 'Calendly event'
  return 'Webhook'
}

function nodeIcon(type: NodeType) {
  if (type === 'send') return '>'
  if (type === 'branch') return '?'
  if (type === 'aiSkill') return '*'
  if (type === 'condition') return '='
  if (type === 'updateContact') return '+'
  if (type === 'assignConversation') return '@'
  if (type === 'delayUntil') return '~'
  if (type === 'webhookResponse') return '{}'
  return 'x'
}

function nodeAccent(type: NodeType) {
  if (type === 'branch') return 'border-amber-200 bg-amber-50 text-amber-700'
  if (type === 'send' || type === 'aiSkill') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (type === 'end') return 'border-slate-200 bg-slate-100 text-slate-600'
  return 'border-sky-200 bg-sky-50 text-sky-700'
}

function selectedNodeClass(isSelected: boolean) {
  return isSelected ? 'border-emerald-400 shadow-[0_20px_60px_rgba(16,185,129,0.18)] ring-4 ring-emerald-500/10' : 'border-slate-200 shadow-sm hover:border-slate-300'
}

function findNodeLabel(nodes: BuilderNode[], id: unknown) {
  if (!id) return 'End'
  return nodes.find((node) => node.id === id)?.label ?? String(id)
}

function nodeSummary(node: BuilderNode, templates: TemplateRow[]) {
  const data = node.data
  if (node.type === 'send') {
    const template = templates.find((item) => item.id === data.templateId)
    return template ? `Sends "${template.name}" to ${String(data.to ?? 'current contact')}` : 'Choose a text template and recipient'
  }
  if (node.type === 'branch') {
    const options = Array.isArray(data.options) ? data.options : []
    return `Waits for reply and routes into ${options.length || 1} path${options.length === 1 ? '' : 's'}`
  }
  if (node.type === 'aiSkill') return Boolean(data.sendAsMessage) ? 'AI writes and sends a reply' : 'AI writes output into a variable'
  if (node.type === 'condition') return `Checks ${String(data.variable ?? 'a variable')}`
  if (node.type === 'updateContact') return `Updates ${String(data.path ?? 'contact data')}`
  if (node.type === 'assignConversation') return `Assigns chat to ${String(data.assignee || 'a user')}`
  if (node.type === 'delayUntil') return `Pauses until ${String(data.until ?? 'a date')}`
  if (node.type === 'webhookResponse') return 'Returns a webhook response'
  return 'Stops this automation run'
}

function nextNodeIds(node: BuilderNode) {
  const data = node.data
  if (node.type === 'branch') {
    const options = Array.isArray(data.options) ? (data.options as Array<Record<string, string>>) : []
    return [
      ...options.map((option) => option.next).filter(Boolean),
      typeof data.fallbackNext === 'string' && data.fallbackNext ? data.fallbackNext : '',
    ].filter(Boolean)
  }
  if (node.type === 'condition') return [String(data.trueNext ?? ''), String(data.falseNext ?? '')].filter(Boolean)
  return [String(data.next ?? '')].filter(Boolean)
}

function NextPreview({ node, nodes }: { node: BuilderNode; nodes: BuilderNode[] }) {
  const ids = nextNodeIds(node)
  if (ids.length === 0) return <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Output: end here</p>
  return (
    <div className="space-y-1">
      {ids.map((id) => (
        <p key={id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Output {'->'} {findNodeLabel(nodes, id)}
        </p>
      ))}
    </div>
  )
}

function RouterPreview({ node, nodes }: { node: BuilderNode; nodes: BuilderNode[] }) {
  const options = Array.isArray(node.data.options) ? (node.data.options as Array<Record<string, string>>) : []
  return (
    <div className="space-y-2">
      {options.slice(0, 4).map((option) => (
        <div key={`${option.id}-${option.next}`} className="flex items-center justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-xs">
          <span className="font-medium text-amber-700">{option.label || option.id}</span>
          <span className="text-slate-500">{'->'} {findNodeLabel(nodes, option.next)}</span>
        </div>
      ))}
      {typeof node.data.fallbackNext === 'string' && node.data.fallbackNext ? (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs">
          <span className="font-medium text-slate-600">Fallback</span>
          <span className="text-slate-500">{'->'} {findNodeLabel(nodes, node.data.fallbackNext)}</span>
        </div>
      ) : null}
    </div>
  )
}

function defaultPosition(index: number) {
  return { x: 80 + index * 360, y: index % 2 === 0 ? 120 : 320 }
}

function flowNodesFromBuilder(
  nodes: BuilderNode[],
  selectedId: string,
  templates: TemplateRow[],
  onSelect: (id: string) => void,
  triggerType: TriggerType,
  triggerConfig: Record<string, unknown>,
): BuilderFlowNode[] {
  return [
    {
      id: '__trigger',
      type: 'trigger',
      position: { x: -300, y: 120 },
      data: { triggerType, triggerConfig, selected: selectedId === '__trigger', onSelect: () => onSelect('__trigger') },
      draggable: false,
    },
    ...nodes.map((node, index): WorkflowFlowNode => ({
    id: node.id,
    type: 'workflow',
    position: node.position ?? defaultPosition(index),
    data: { builderNode: node, templates, allNodes: nodes, selected: selectedId === node.id, onSelect },
    })),
  ]
}

function flowEdgesFromBuilder(nodes: BuilderNode[], entry: string): Edge[] {
  const edges: Edge[] = entry
    ? [{ id: `__trigger->${entry}`, source: '__trigger', sourceHandle: 'next', target: entry, type: 'smoothstep', animated: true, label: 'Start' }]
    : []
  for (const node of nodes) {
    if (node.type === 'branch') {
      const options = Array.isArray(node.data.options) ? (node.data.options as Array<Record<string, string>>) : []
      for (const option of options) {
        if (!option.next) continue
        edges.push({
          id: `${node.id}:${option.id}->${option.next}`,
          source: node.id,
          sourceHandle: `option:${option.id}`,
          target: option.next,
          label: option.label || option.id,
          type: 'smoothstep',
          animated: true,
        })
      }
      if (typeof node.data.fallbackNext === 'string' && node.data.fallbackNext) {
        edges.push({
          id: `${node.id}:fallback->${node.data.fallbackNext}`,
          source: node.id,
          sourceHandle: 'fallback',
          target: node.data.fallbackNext,
          label: 'Fallback',
          type: 'smoothstep',
          animated: true,
        })
      }
      continue
    }
    if (node.type === 'condition') {
      if (typeof node.data.trueNext === 'string' && node.data.trueNext) {
        edges.push({ id: `${node.id}:true->${node.data.trueNext}`, source: node.id, sourceHandle: 'trueNext', target: node.data.trueNext, label: 'True', type: 'smoothstep' })
      }
      if (typeof node.data.falseNext === 'string' && node.data.falseNext) {
        edges.push({ id: `${node.id}:false->${node.data.falseNext}`, source: node.id, sourceHandle: 'falseNext', target: node.data.falseNext, label: 'False', type: 'smoothstep' })
      }
      continue
    }
    if (typeof node.data.next === 'string' && node.data.next) {
      edges.push({ id: `${node.id}:next->${node.data.next}`, source: node.id, sourceHandle: 'next', target: node.data.next, type: 'smoothstep' })
    }
  }
  return edges
}

function patchConnection(sourceHandle: string | null | undefined, target: string) {
  if (!sourceHandle || sourceHandle === 'next') return { next: target }
  if (sourceHandle === 'trueNext') return { trueNext: target }
  if (sourceHandle === 'falseNext') return { falseNext: target }
  if (sourceHandle === 'fallback') return { fallbackNext: target }
  if (sourceHandle.startsWith('option:')) return { optionId: sourceHandle.replace('option:', ''), target }
  return { next: target }
}

function primaryNextForDeletedNode(node: BuilderNode) {
  return nextNodeIds(node)[0] ?? ''
}

function replaceDeletedReference(node: BuilderNode, deletedId: string, replacementId: string): BuilderNode {
  if (node.type === 'branch') {
    const options = Array.isArray(node.data.options) ? (node.data.options as Array<Record<string, string>>) : []
    return {
      ...node,
      data: {
        ...node.data,
        options: options.map((option) => ({
          ...option,
          next: option.next === deletedId ? replacementId : option.next,
        })),
        fallbackNext: node.data.fallbackNext === deletedId ? replacementId : node.data.fallbackNext,
      },
    }
  }
  if (node.type === 'condition') {
    return {
      ...node,
      data: {
        ...node.data,
        trueNext: node.data.trueNext === deletedId ? replacementId : node.data.trueNext,
        falseNext: node.data.falseNext === deletedId ? replacementId : node.data.falseNext,
      },
    }
  }
  return {
    ...node,
    data: {
      ...node.data,
      next: node.data.next === deletedId ? replacementId : node.data.next,
    },
  }
}

function WorkflowNode({ data }: NodeProps<WorkflowFlowNode>) {
  const node = data.builderNode
  const templates = data.templates
  const allNodes = data.allNodes
  const isSelected = data.selected
  return (
    <button
      type="button"
      onClick={() => data.onSelect(node.id)}
      className={`block w-80 rounded-2xl border bg-white text-left transition ${selectedNodeClass(Boolean(isSelected))}`}
    >
      <Handle type="target" position={Position.Left} className="!h-4 !w-4 !border-4 !border-white !bg-slate-300" />
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`flex h-8 min-w-8 items-center justify-center rounded-lg border px-1 text-xs font-bold ${nodeAccent(node.type)}`}>{nodeIcon(node.type)}</span>
          <div>
            <p className="font-semibold text-slate-950">{node.label}</p>
            <p className="font-mono text-xs text-slate-400">{node.id}</p>
          </div>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-500">{node.type}</span>
      </div>
      <div className="space-y-3 p-4">
        <p className="text-sm text-slate-600">{nodeSummary(node, templates)}</p>
        {node.type === 'branch' ? <RouterPreview node={node} nodes={allNodes} /> : <NextPreview node={node} nodes={allNodes} />}
      </div>
      <WorkflowHandles node={node} />
    </button>
  )
}

function TriggerNode({ data }: NodeProps<TriggerFlowNode>) {
  const selected = Boolean(data.selected)
  const whatsappIds = Array.isArray(data.triggerConfig.whatsappInstanceIds) ? data.triggerConfig.whatsappInstanceIds : []
  return (
    <button
      type="button"
      onClick={() => data.onSelect()}
      className={`block w-80 rounded-2xl border bg-white text-left transition ${selectedNodeClass(selected)}`}
    >
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <span className="flex h-8 min-w-8 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-xs font-bold text-emerald-700">T</span>
        <div>
          <p className="font-semibold text-slate-950">Trigger</p>
          <p className="text-xs text-slate-500">{triggerLabel(data.triggerType)}</p>
        </div>
      </div>
      <div className="space-y-3 p-4">
        <p className="text-sm text-slate-600">Starts the automation when this event happens.</p>
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          WhatsApp: {whatsappIds.length > 0 ? `${whatsappIds.length} selected number${whatsappIds.length === 1 ? '' : 's'}` : 'All numbers'}
        </p>
      </div>
      <Handle id="next" type="source" position={Position.Right} className="!h-4 !w-4 !border-4 !border-white !bg-emerald-500" />
    </button>
  )
}

function WorkflowHandles({ node }: { node: BuilderNode }) {
  if (node.type === 'branch') {
    const options = Array.isArray(node.data.options) ? (node.data.options as Array<Record<string, string>>) : []
    return (
      <>
        {options.map((option, index) => (
          <Handle
            key={option.id || index}
            id={`option:${option.id}`}
            type="source"
            position={Position.Right}
            className="!h-4 !w-4 !border-4 !border-white !bg-amber-500"
            style={{ top: 92 + index * 34 }}
          />
        ))}
        <Handle id="fallback" type="source" position={Position.Right} className="!h-4 !w-4 !border-4 !border-white !bg-slate-400" style={{ top: 92 + options.length * 34 }} />
      </>
    )
  }
  if (node.type === 'condition') {
    return (
      <>
        <Handle id="trueNext" type="source" position={Position.Right} className="!h-4 !w-4 !border-4 !border-white !bg-emerald-500" style={{ top: 92 }} />
        <Handle id="falseNext" type="source" position={Position.Right} className="!h-4 !w-4 !border-4 !border-white !bg-rose-500" style={{ top: 128 }} />
      </>
    )
  }
  if (node.type === 'end') return null
  return <Handle id="next" type="source" position={Position.Right} className="!h-4 !w-4 !border-4 !border-white !bg-emerald-500" />
}

export default function AutomationBuilder() {
  const { workspaceId, automationId } = useParams()
  const navigate = useNavigate()
  const isNew = !automationId || automationId === 'new'
  const [name, setName] = useState('New automation')
  const [active, setActive] = useState(false)
  const [triggerType, setTriggerType] = useState<TriggerType>('conversation.created')
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>({ conversationStatus: 'new' })
  const [nodes, setNodes] = useState<BuilderNode[]>([defaultNode('send', 1), defaultNode('end', 2)])
  const [entry, setEntry] = useState('send_1')
  const [selectedId, setSelectedId] = useState('send_1')
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [whatsappInstances, setWhatsappInstances] = useState<WhatsAppInstanceRow[]>([])
  const [datetimeFields, setDatetimeFields] = useState<Array<{ key: string; label: string }>>([])
  const [conditionVariables, setConditionVariables] = useState<VariableOption[]>(BASE_VARIABLE_OPTIONS)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { theme } = useTheme()

  const selected = useMemo(() => nodes.find((node) => node.id === selectedId) ?? nodes[0], [nodes, selectedId])

  useEffect(() => {
    if (!workspaceId) return
    void supabase
      .from('message_templates')
      .select('id, name, body')
      .eq('workspace_id', workspaceId)
      .order('name')
      .then(({ data }) => setTemplates((data as TemplateRow[]) ?? []))

    void supabase
      .from('whatsapp_instances')
      .select('id, display_name, pairing_status')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true })
      .then(({ data }) => setWhatsappInstances((data as WhatsAppInstanceRow[]) ?? []))

    void supabase
      .from('workspace_contact_fields')
      .select('key, label, type')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        const rows = ((data ?? []) as WorkspaceContactFieldRow[])
        const customOptions = rows.map((field) => ({
          value: `contact.attr.${field.key.replace(/[^\w.-]/g, '_')}`,
          label: `Custom attribute: ${field.label || field.key}`,
          group: 'Custom attributes',
        }))
        setDatetimeFields(
          rows
            .filter((field) => field.type === 'date' || field.type === 'datetime')
            .map((field) => ({ key: field.key, label: field.label || field.key })),
        )
        setConditionVariables([...BASE_VARIABLE_OPTIONS, ...customOptions])
      })
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId || isNew) return
    void supabase
      .from('automations')
      .select('name, is_active, entry_node_id, graph, trigger_type, trigger_config')
      .eq('id', automationId)
      .eq('workspace_id', workspaceId)
      .single()
      .then(({ data, error: loadErr }) => {
        if (loadErr) {
          setError(loadErr.message)
          return
        }
        setName((data.name as string) ?? 'Automation')
        setActive(Boolean(data.is_active))
        setTriggerType((data.trigger_type as TriggerType) ?? 'message.received')
        setTriggerConfig((data.trigger_config as Record<string, unknown>) ?? {})
        const nextNodes = graphToNodes(data.graph)
        setNodes(nextNodes)
        setEntry((data.entry_node_id as string) || nextNodes[0]?.id || 'start')
        setSelectedId((data.entry_node_id as string) || nextNodes[0]?.id || 'start')
      })
  }, [automationId, isNew, workspaceId])

  function updateSelected(patch: Record<string, unknown>) {
    if (!selected) return
    setNodes((current) => current.map((node) => (node.id === selected.id ? { ...node, data: { ...node.data, ...patch } } : node)))
  }

  function renameSelected(label: string) {
    if (!selected) return
    setNodes((current) => current.map((node) => (node.id === selected.id ? { ...node, label } : node)))
  }

  const selectedNode = selectedId === '__trigger' ? null : selected

  function addNode(type: NodeType, position?: { x: number; y: number }) {
    const node = defaultNode(type, nodes.length + 1)
    if (position) node.position = position
    setNodes((current) => [...current, node])
    setSelectedId(node.id)
  }

  function deleteNode(nodeId: string) {
    if (nodeId === '__trigger') return
    setNodes((current) => {
      const deleted = current.find((node) => node.id === nodeId)
      if (!deleted) return current
      const replacementId = primaryNextForDeletedNode(deleted)
      const remaining = current
        .filter((node) => node.id !== nodeId)
        .map((node) => replaceDeletedReference(node, nodeId, replacementId))
      setEntry((currentEntry) => (currentEntry === nodeId ? replacementId || remaining[0]?.id || '' : currentEntry))
      setSelectedId((currentSelected) => (currentSelected === nodeId ? replacementId || remaining[0]?.id || '__trigger' : currentSelected))
      return remaining
    })
  }

  async function save() {
    if (!workspaceId) return
    setSaving(true)
    setError(null)
    const payload = {
      workspace_id: workspaceId,
      name: name.trim() || 'Untitled automation',
      is_active: active,
      entry_node_id: entry,
      trigger_type: triggerType,
      trigger_config: triggerConfig,
      graph: nodesToGraph(entry, nodes),
    }
    try {
      let id = automationId
      if (isNew) {
        const { data, error: insertErr } = await supabase.from('automations').insert(payload).select('id').single()
        if (insertErr || !data) throw new Error(insertErr?.message ?? 'Failed to create automation')
        id = data.id as string
      } else {
        const { error: updateErr } = await supabase.from('automations').update(payload).eq('id', automationId)
        if (updateErr) throw new Error(updateErr.message)
      }
      if (triggerType === 'webhook.received' && id) {
        await supabase
          .from('webhook_triggers')
          .upsert({ workspace_id: workspaceId, automation_id: id }, { onConflict: 'automation_id' })
          .select('id')
          .maybeSingle()
      }
      navigate(`/w/${workspaceId}/automations`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save automation')
    } finally {
      setSaving(false)
    }
  }

  if (!workspaceId) return <p className="text-slate-500">Missing workspace.</p>

  return (
    <div className="flex h-screen flex-col bg-slate-50 dark:bg-slate-950">
      <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader title="Automation builder" description="Build text-message workflows powered by AI skills and reply routing." />
        <div className="flex gap-2">
          <Link to={`/w/${workspaceId}/automations`} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-300">
            Back
          </Link>
          <Button type="button" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving...' : 'Save automation'}
          </Button>
        </div>
      </div>
      <FormError message={error} />

      <section className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[280px_1fr_360px]">
        <aside className="min-h-0 space-y-3 overflow-y-auto border-b border-slate-200 bg-slate-100/80 p-4 dark:border-r dark:border-b-0 dark:border-slate-800 dark:bg-slate-900/80">
          <h2 className="text-sm font-semibold text-white">Node palette</h2>
          {PALETTE_GROUPS.map((group) => (
            <div key={group.title} className="space-y-2 border-t border-slate-800 pt-3 first:border-t-0 first:pt-0">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{group.title}</p>
                <p className="mt-1 text-xs text-slate-500">{group.description}</p>
              </div>
              {group.items.map((item) => (
                <button
                  key={item.type}
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData('node/type', item.type)}
                  onClick={() => addNode(item.type)}
                  className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-700 hover:border-emerald-500/60 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300"
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </aside>

        <main className="relative min-h-0 overflow-hidden bg-slate-100 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
          <div className="absolute left-4 right-4 top-4 z-20 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/85 sm:flex-row sm:items-center sm:justify-between">
            <FormField label="Automation name">
              <TextInput value={name} onChange={(event) => setName(event.target.value)} className="border-slate-200 bg-white text-slate-950" />
            </FormField>
            <div className="flex flex-wrap items-end gap-3">
              <FormField label="Entry node">
                <select value={entry} onChange={(event) => setEntry(event.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950">
                  {nodes.map((node) => <option key={node.id} value={node.id}>{node.id}</option>)}
                </select>
              </FormField>
              <label className="mb-2 flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
                Active
              </label>
            </div>
          </div>
          <ReactFlowProvider>
            <WorkflowCanvas
              nodes={nodes}
              setNodes={setNodes}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              templates={templates}
              addNode={addNode}
              deleteNode={deleteNode}
              triggerType={triggerType}
              triggerConfig={triggerConfig}
              entry={entry}
              theme={theme}
            />
          </ReactFlowProvider>
        </main>

        <aside className="min-h-0 space-y-4 overflow-y-auto border-t border-slate-200 bg-slate-100/80 p-4 dark:border-l dark:border-t-0 dark:border-slate-800 dark:bg-slate-900/80">
          <h2 className="text-sm font-semibold text-white">Properties</h2>
          <FormField label="Trigger">
            <select value={triggerType} onChange={(event) => setTriggerType(event.target.value as TriggerType)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
              <option value="conversation.created">New conversation</option>
              <option value="message.received">Inbound message</option>
              <option value="contact.datetime">Contact date/time</option>
              <option value="webhook.received">Webhook</option>
              <option value="calendly.event">Calendly event</option>
            </select>
          </FormField>
          <TriggerConfig
            triggerType={triggerType}
            value={triggerConfig}
            whatsappInstances={whatsappInstances}
            datetimeFields={datetimeFields}
            onChange={setTriggerConfig}
          />
          <PlaceholderHints triggerType={triggerType} />
          {selectedNode ? (
            <NodeProperties node={selectedNode} nodes={nodes} templates={templates} conditionVariables={conditionVariables} onChange={updateSelected} onRename={renameSelected} onDelete={() => deleteNode(selectedNode.id)} />
          ) : null}
        </aside>
      </section>
    </div>
  )
}

function PlaceholderHints({ triggerType }: { triggerType: TriggerType }) {
  if (triggerType !== 'calendly.event') return null
  const examples = [
    '{{inviteeName}}',
    '{{inviteeEmail}}',
    '{{inviteePhone}}',
    '{{meetingName}}',
    '{{meetingStart}}',
    '{{meetingJoinUrl}}',
    '{{inviteeRescheduleUrl}}',
    '{{inviteeCancelUrl}}',
    '{{qa.handynummer}}',
  ]
  return (
    <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
      <p className="text-sm font-medium text-white">Calendly placeholders</p>
      <p className="text-xs text-slate-500">
        Use these directly in message templates. Google Meet link is available as <span className="font-mono text-slate-300">{'{{meetingJoinUrl}}'}</span> when Calendly sends it.
      </p>
      <div className="grid gap-1">
        {examples.map((item) => (
          <code key={item} className="rounded bg-slate-900 px-2 py-1 text-xs text-slate-300">
            {item}
          </code>
        ))}
      </div>
    </div>
  )
}

function WorkflowCanvas({
  nodes,
  setNodes,
  selectedId,
  setSelectedId,
  templates,
  addNode,
  deleteNode,
  triggerType,
  triggerConfig,
  entry,
  theme,
}: {
  nodes: BuilderNode[]
  setNodes: Dispatch<SetStateAction<BuilderNode[]>>
  selectedId: string
  setSelectedId: (id: string) => void
  templates: TemplateRow[]
  addNode: (type: NodeType, position?: { x: number; y: number }) => void
  deleteNode: (nodeId: string) => void
  triggerType: TriggerType
  triggerConfig: Record<string, unknown>
  entry: string
  theme: 'light' | 'dark'
}) {
  const { screenToFlowPosition, fitView } = useReactFlow()
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<BuilderFlowNode>([])
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState<Edge>([])

  useEffect(() => {
    setFlowNodes(flowNodesFromBuilder(nodes, selectedId, templates, setSelectedId, triggerType, triggerConfig))
    setFlowEdges(flowEdgesFromBuilder(nodes, entry))
  }, [entry, nodes, selectedId, setFlowEdges, setFlowNodes, setSelectedId, templates, triggerConfig, triggerType])

  function onNodeDragStop(_: unknown, dragged: Node) {
    setNodes((current) => current.map((node) => (node.id === dragged.id ? { ...node, position: dragged.position } : node)))
  }

  function onConnect(connection: Connection) {
    if (!connection.source || !connection.target) return
    const patch = patchConnection(connection.sourceHandle, connection.target)
    setNodes((current) =>
      current.map((node) => {
        if (node.id !== connection.source) return node
        if ('optionId' in patch) {
          const options = Array.isArray(node.data.options) ? (node.data.options as Array<Record<string, string>>) : []
          return {
            ...node,
            data: {
              ...node.data,
              options: options.map((option) => (option.id === patch.optionId ? { ...option, next: patch.target } : option)),
            },
          }
        }
        return { ...node, data: { ...node.data, ...patch } }
      }),
    )
    setFlowEdges((current) => addEdge({ ...connection, type: 'smoothstep', animated: true }, current))
  }

  return (
    <div
      className="h-full w-full"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        const type = event.dataTransfer.getData('node/type') as NodeType
        if (!type) return
        addNode(type, screenToFlowPosition({ x: event.clientX, y: event.clientY }))
      }}
    >
      <ReactFlow<BuilderFlowNode, Edge>
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={{ workflow: WorkflowNode, trigger: TriggerNode }}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onNodesDelete={(deletedNodes) => {
          for (const node of deletedNodes) {
            if (node.id !== '__trigger') deleteNode(node.id)
          }
        }}
        onNodeClick={(_, node) => setSelectedId(node.id)}
        fitView
        className={theme === 'dark' ? 'bg-slate-900' : 'bg-slate-100'}
        defaultEdgeOptions={{ type: 'smoothstep' }}
      >
        <Background color={theme === 'dark' ? '#334155' : '#cbd5e1'} gap={24} size={1.2} />
        <Controls position="bottom-center" />
        <MiniMap
          position="bottom-left"
          nodeBorderRadius={12}
          pannable
          zoomable
          nodeColor={(node) => {
            const builder = node.data?.builderNode as BuilderNode | undefined
            if (builder?.type === 'branch') return '#fde68a'
            if (builder?.type === 'send' || builder?.type === 'aiSkill') return '#a7f3d0'
            return '#bae6fd'
          }}
        />
        <div className="absolute right-4 top-24 z-10 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 text-sm shadow dark:border-slate-700 dark:bg-slate-900/95">
          <p className="font-semibold text-slate-950 dark:text-white">Trigger</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{triggerLabel(triggerType)}</p>
          <button type="button" className="mt-3 text-xs font-medium text-emerald-600 dark:text-emerald-400" onClick={() => fitView({ padding: 0.2 })}>
            Fit view
          </button>
        </div>
      </ReactFlow>
    </div>
  )
}

function TriggerConfig({
  triggerType,
  value,
  whatsappInstances,
  datetimeFields,
  onChange,
}: {
  triggerType: TriggerType
  value: Record<string, unknown>
  whatsappInstances: WhatsAppInstanceRow[]
  datetimeFields: Array<{ key: string; label: string }>
  onChange: (value: Record<string, unknown>) => void
}) {
  const calendlyEventOptions = [
    'invitee.created',
    'invitee.canceled',
    'invitee_no_show.created',
    'invitee_no_show.deleted',
    'event_type.created',
    'event_type.deleted',
    'event_type.updated',
    'routing_form_submission.created',
  ]
  const selectedCalendlyEvents = Array.isArray(value.events) ? value.events.filter((entry): entry is string => typeof entry === 'string') : []
  const setCalendlyEvents = (events: string[]) => onChange({ ...value, events })

  const selectedIds = Array.isArray(value.whatsappInstanceIds) ? value.whatsappInstanceIds.filter((id): id is string => typeof id === 'string') : []
  const setWhatsappIds = (ids: string[]) => onChange({ ...value, whatsappInstanceIds: ids })
  const whatsappPicker = (
    <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
      <div>
        <p className="text-sm font-medium text-white">WhatsApp numbers</p>
        <p className="mt-1 text-xs text-slate-500">Leave empty to run this automation for all connected numbers.</p>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input type="checkbox" checked={selectedIds.length === 0} onChange={() => setWhatsappIds([])} />
        All WhatsApp numbers
      </label>
      <div className="space-y-1">
        {whatsappInstances.length === 0 ? <p className="text-xs text-slate-500">No WhatsApp numbers yet.</p> : null}
        {whatsappInstances.map((instance) => {
          const checked = selectedIds.includes(instance.id)
          return (
            <label key={instance.id} className="flex items-center gap-2 rounded-lg bg-slate-900 px-2 py-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => {
                  if (event.target.checked) setWhatsappIds([...selectedIds, instance.id])
                  else setWhatsappIds(selectedIds.filter((id) => id !== instance.id))
                }}
              />
              <span className="min-w-0 flex-1 truncate">{instance.display_name || 'WhatsApp number'}</span>
              <span className="text-xs text-slate-500">{instance.pairing_status ?? 'unknown'}</span>
            </label>
          )
        })}
      </div>
    </div>
  )

  if (triggerType === 'contact.datetime') {
    const legacyOffsetMinutes = Number(value.offsetMinutes ?? 0)
    const direction = value.offsetDirection === 'after' || (typeof value.offsetDirection !== 'string' && legacyOffsetMinutes < 0) ? 'after' : 'before'
    const unit = value.offsetUnit === 'weeks' || value.offsetUnit === 'days' || value.offsetUnit === 'hours' || value.offsetUnit === 'minutes' ? value.offsetUnit : 'hours'
    const unitToMinutes = unit === 'weeks' ? 10_080 : unit === 'days' ? 1_440 : unit === 'hours' ? 60 : 1
    const fallbackAmount = Math.round(Math.abs(legacyOffsetMinutes) / unitToMinutes)
    const amount = Math.max(0, Number(value.offsetAmount ?? fallbackAmount))
    const selectedFieldKey =
      typeof value.fieldKey === 'string' && value.fieldKey
        ? value.fieldKey
        : typeof value.attributePath === 'string' && value.attributePath.startsWith('custom_attributes.')
          ? value.attributePath.slice('custom_attributes.'.length)
          : ''
    const signedOffset = direction === 'before' ? amount * unitToMinutes : -amount * unitToMinutes
    const nextAttributePath = selectedFieldKey ? `custom_attributes.${selectedFieldKey}` : ''

    return (
      <>
        {whatsappPicker}
        <FormField label="Date/time field">
          <select
            value={selectedFieldKey}
            onChange={(event) =>
              onChange({
                ...value,
                fieldKey: event.target.value,
                attributePath: event.target.value ? `custom_attributes.${event.target.value}` : '',
                offsetDirection: direction,
                offsetAmount: amount,
                offsetUnit: unit,
                offsetMinutes: signedOffset,
              })
            }
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
          >
            <option value="">Select field</option>
            {datetimeFields.map((field) => (
              <option key={field.key} value={field.key}>
                {field.label} ({field.key})
              </option>
            ))}
          </select>
        </FormField>
        {datetimeFields.length === 0 ? <p className="text-xs text-slate-500">No date/datetime contact fields found. Create them in Settings -&gt; Contacts first.</p> : null}
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label="When">
            <select
              value={direction}
              onChange={(event) =>
                onChange({
                  ...value,
                  fieldKey: selectedFieldKey,
                  attributePath: nextAttributePath,
                  offsetDirection: event.target.value,
                  offsetAmount: amount,
                  offsetUnit: unit,
                  offsetMinutes: event.target.value === 'before' ? amount * unitToMinutes : -amount * unitToMinutes,
                })
              }
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              <option value="before">Before</option>
              <option value="after">After</option>
            </select>
          </FormField>
          <FormField label="Amount">
            <TextInput
              type="number"
              min={0}
              value={String(amount)}
              onChange={(event) => {
                const nextAmount = Math.max(0, Number(event.target.value || 0))
                onChange({
                  ...value,
                  fieldKey: selectedFieldKey,
                  attributePath: nextAttributePath,
                  offsetDirection: direction,
                  offsetAmount: nextAmount,
                  offsetUnit: unit,
                  offsetMinutes: direction === 'before' ? nextAmount * unitToMinutes : -nextAmount * unitToMinutes,
                })
              }}
            />
          </FormField>
          <FormField label="Unit">
            <select
              value={unit}
              onChange={(event) => {
                const nextUnit = event.target.value
                const nextUnitMinutes = nextUnit === 'weeks' ? 10_080 : nextUnit === 'days' ? 1_440 : nextUnit === 'hours' ? 60 : 1
                onChange({
                  ...value,
                  fieldKey: selectedFieldKey,
                  attributePath: nextAttributePath,
                  offsetDirection: direction,
                  offsetAmount: amount,
                  offsetUnit: nextUnit,
                  offsetMinutes: direction === 'before' ? amount * nextUnitMinutes : -amount * nextUnitMinutes,
                })
              }}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
              <option value="weeks">Weeks</option>
            </select>
          </FormField>
        </div>
        <p className="text-xs text-slate-500">
          Automation runs {direction} {amount} {unit} relative to the selected contact field.
        </p>
        <FormField label="Attribute path (advanced)">
          <TextInput value={String(value.attributePath ?? '')} onChange={(event) => onChange({ ...value, attributePath: event.target.value })} />
        </FormField>
      </>
    )
  }
  if (triggerType === 'conversation.created' || triggerType === 'message.received') {
    return (
      <>
        {whatsappPicker}
        <FormField label="Conversation status">
          <select value={String(value.conversationStatus ?? '')} onChange={(event) => onChange({ ...value, conversationStatus: event.target.value || undefined })} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
            <option value="">Any</option>
            <option value="new">New</option>
            <option value="existing">Existing</option>
          </select>
        </FormField>
        <FormField label="Contact status">
          <select value={String(value.contactStatus ?? '')} onChange={(event) => onChange({ ...value, contactStatus: event.target.value || undefined })} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
            <option value="">Any</option>
            <option value="new">First-ever contact</option>
            <option value="existing">Existing contact</option>
          </select>
        </FormField>
      </>
    )
  }
  if (triggerType === 'calendly.event') {
    return (
      <>
        <FormField label="Calendly scope">
          <select
            value={String(value.scope ?? '')}
            onChange={(event) => onChange({ ...value, scope: event.target.value || undefined })}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
          >
            <option value="">Any scope</option>
            <option value="organization">Organization</option>
            <option value="user">User</option>
            <option value="group">Group</option>
          </select>
        </FormField>
        <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
          <div>
            <p className="text-sm font-medium text-white">Calendly events</p>
            <p className="mt-1 text-xs text-slate-500">Leave empty to match all Calendly webhook events.</p>
          </div>
          {calendlyEventOptions.map((eventName) => {
            const checked = selectedCalendlyEvents.includes(eventName)
            return (
              <label key={eventName} className="flex items-center gap-2 rounded-lg bg-slate-900 px-2 py-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    if (event.target.checked) setCalendlyEvents([...selectedCalendlyEvents, eventName])
                    else setCalendlyEvents(selectedCalendlyEvents.filter((value) => value !== eventName))
                  }}
                />
                <span className="min-w-0 flex-1 truncate">{eventName}</span>
              </label>
            )
          })}
        </div>
        <FormField label="Event type URI (optional)">
          <TextInput
            value={String(value.eventTypeUri ?? '')}
            onChange={(event) => onChange({ ...value, eventTypeUri: event.target.value || undefined })}
            placeholder="https://api.calendly.com/event_types/..."
          />
        </FormField>
      </>
    )
  }
  return (
    <>
      {whatsappPicker}
      <p className="text-xs text-slate-500">Webhook URL and secret are generated after saving.</p>
    </>
  )
}

function nextSelect(nodes: BuilderNode[], value: unknown, onChange: (next: string) => void) {
  return (
    <select value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
      <option value="">End here</option>
      {nodes.map((node) => <option key={node.id} value={node.id}>{node.id}</option>)}
    </select>
  )
}

function NodeProperties({
  node,
  nodes,
  templates,
  conditionVariables,
  onChange,
  onRename,
  onDelete,
}: {
  node: BuilderNode
  nodes: BuilderNode[]
  templates: TemplateRow[]
  conditionVariables: VariableOption[]
  onChange: (patch: Record<string, unknown>) => void
  onRename: (label: string) => void
  onDelete: () => void
}) {
  const data = node.data
  return (
    <div className="space-y-3 border-t border-slate-800 pt-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-white">{node.label}</p>
        <Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={onDelete}>Delete</Button>
      </div>
      <FormField label="Node name">
        <TextInput value={node.label} onChange={(event) => onRename(event.target.value)} placeholder="Name this step" />
      </FormField>
      {node.type === 'send' ? (
        <>
          <FormField label="To">
            <select value={String(data.to ?? 'Current conversation contact')} onChange={(event) => onChange({ to: event.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
              <option value="Current conversation contact">Current conversation contact</option>
              <option value="{{contact.wa_jid}}">Contact WhatsApp JID</option>
              <option value="{{contact.phone_e164}}">Contact phone</option>
              <option value="{{inviteePhone}}">Calendly invitee phone</option>
              <option value="{{qa.handynummer}}">Calendly Q&A phone (Handynummer)</option>
            </select>
          </FormField>
          <FormField label="Template">
            <select value={String(data.templateId ?? '')} onChange={(event) => onChange({ templateId: event.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
              <option value="">Choose template</option>
              {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
          </FormField>
          <TemplatePreview template={templates.find((template) => template.id === data.templateId)} />
          <FormField label="Next">{nextSelect(nodes, data.next, (next) => onChange({ next }))}</FormField>
        </>
      ) : null}
      {node.type === 'branch' ? <BranchProperties node={node} nodes={nodes} onChange={onChange} /> : null}
      {node.type === 'condition' ? (
        <>
          <FormField label="Variable">
            <select value={String(data.variable ?? '')} onChange={(event) => onChange({ variable: event.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
              <option value="">Choose contact field, custom attribute, or previous output</option>
              {Array.from(new Set(conditionVariables.map((option) => option.group))).map((group) => (
                <optgroup key={group} label={group}>
                  {conditionVariables.filter((option) => option.group === group).map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </FormField>
          <FormField label="Or custom variable path">
            <TextInput value={String(data.variable ?? '')} onChange={(event) => onChange({ variable: event.target.value })} placeholder="Example: contact.attr.plan or skillReply" />
          </FormField>
          <FormField label="Operator">
            <select value={String(data.operator ?? 'equals')} onChange={(event) => onChange({ operator: event.target.value })} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
              <option value="exists">exists</option>
              <option value="equals">equals</option>
              <option value="contains">contains</option>
            </select>
          </FormField>
          <FormField label="Value"><TextInput value={String(data.value ?? '')} onChange={(event) => onChange({ value: event.target.value })} /></FormField>
          <FormField label="True next">{nextSelect(nodes, data.trueNext, (next) => onChange({ trueNext: next }))}</FormField>
          <FormField label="False next">{nextSelect(nodes, data.falseNext, (next) => onChange({ falseNext: next }))}</FormField>
        </>
      ) : null}
      {node.type === 'aiSkill' ? (
        <>
          <FormField label="Instructions">
            <textarea
              value={String(data.instructions ?? '')}
              onChange={(event) => onChange({ instructions: event.target.value })}
              rows={6}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            />
          </FormField>
          <FormField label="Output variable"><TextInput value={String(data.outputVariable ?? '')} onChange={(event) => onChange({ outputVariable: event.target.value })} /></FormField>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={Boolean(data.sendAsMessage)} onChange={(event) => onChange({ sendAsMessage: event.target.checked })} />
            Send skill output as WhatsApp message
          </label>
          <FormField label="Next">{nextSelect(nodes, data.next, (next) => onChange({ next }))}</FormField>
        </>
      ) : null}
      {['updateContact', 'assignConversation', 'delayUntil', 'webhookResponse'].includes(node.type) ? (
        <>
          {Object.keys(data).filter((key) => key !== 'next').map((key) => (
            <FormField key={key} label={key}>
              <TextInput value={String(data[key] ?? '')} onChange={(event) => onChange({ [key]: event.target.value })} />
            </FormField>
          ))}
          <FormField label="Next">{nextSelect(nodes, data.next, (next) => onChange({ next }))}</FormField>
        </>
      ) : null}
    </div>
  )
}

function TemplatePreview({ template }: { template?: TemplateRow }) {
  if (!template) return null
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">Text template preview</p>
      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{template.body || 'No body'}</p>
    </div>
  )
}

function BranchProperties({ node, nodes, onChange }: { node: BuilderNode; nodes: BuilderNode[]; onChange: (patch: Record<string, unknown>) => void }) {
  const options = Array.isArray(node.data.options) ? (node.data.options as Array<Record<string, string>>) : []
  function updateOption(index: number, patch: Record<string, string>) {
    onChange({ options: options.map((option, i) => (i === index ? { ...option, ...patch } : option)) })
  }
  function resizeOptions(size: number) {
    const nextSize = Math.max(1, Math.min(12, size))
    const nextOptions = Array.from({ length: nextSize }, (_, index) => {
      return options[index] ?? { id: `route_${index + 1}`, label: `Route ${index + 1}`, hint: '', next: '' }
    })
    onChange({ expectedReplyCount: nextSize, options: nextOptions })
  }
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Input</p>
        <p className="mt-1 text-sm text-slate-300">This node waits for the next customer reply, sends it to AI, then routes to one output path.</p>
      </div>
      <FormField label="How many reply routes?">
        <TextInput type="number" min={1} max={12} value={String((node.data.expectedReplyCount ?? options.length) || 1)} onChange={(event) => resizeOptions(Number(event.target.value))} />
      </FormField>
      <FormField label="How AI should classify the reply">
        <textarea
          value={String(node.data.routingInstructions ?? '')}
          onChange={(event) => onChange({ routingInstructions: event.target.value })}
          rows={4}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
          placeholder="Example: If the customer says 1 or asks about buying, route to sales. If they say 2 or mention a problem, route to support."
        />
      </FormField>
      {options.map((option, index) => (
        <div key={`${option.id}-${index}`} className="space-y-2 rounded-xl border border-slate-800 p-3">
          <p className="text-xs font-medium text-slate-500">Output route {index + 1}</p>
          <TextInput value={option.id ?? ''} onChange={(event) => updateOption(index, { id: event.target.value })} placeholder="Option id, e.g. 1" />
          <TextInput value={option.label ?? ''} onChange={(event) => updateOption(index, { label: event.target.value })} placeholder="Route name" />
          <TextInput value={option.hint ?? ''} onChange={(event) => updateOption(index, { hint: event.target.value })} placeholder="AI routing instruction, e.g. customer wants pricing" />
          {nextSelect(nodes, option.next, (next) => updateOption(index, { next }))}
        </div>
      ))}
      <Button type="button" variant="secondary" className="py-1.5 text-xs" onClick={() => onChange({ options: [...options, { id: String(options.length + 1), label: `Option ${options.length + 1}`, hint: '', next: '' }] })}>
        Add branch option
      </Button>
      <FormField label="Fallback if AI is unsure">{nextSelect(nodes, node.data.fallbackNext, (fallbackNext) => onChange({ fallbackNext }))}</FormField>
    </div>
  )
}
