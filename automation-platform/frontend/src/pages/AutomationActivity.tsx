import { Fragment, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { FormError } from '../shared/ui/form-error'
import { PageHeader } from '../shared/ui/page-header'

type AutomationRun = {
  id: string
  automation_id: string
  contact_id: string | null
  conversation_id: string | null
  status: string
  trigger_type: string
  current_node_id: string
  error: string | null
  started_at: string
  completed_at: string | null
  updated_at: string
  variables: Record<string, unknown> | null
  trigger_payload: Record<string, unknown> | null
  automations?: { name?: string | null } | null
  contacts?: { display_name?: string | null; wa_jid?: string | null } | null
}

type TraceEntry = {
  at?: string
  nodeId?: string
  nodeType?: string
  event?: string
  detail?: Record<string, unknown>
}

function executionTrace(row: AutomationRun): TraceEntry[] {
  const trace = row.variables?.executionTrace
  return Array.isArray(trace) ? (trace as TraceEntry[]) : []
}

function formatDetailValue(value: unknown): string {
  if (value == null || value === '') return '-'
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'number') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export default function AutomationActivity() {
  const { workspaceId } = useParams()
  const [rows, setRows] = useState<AutomationRun[]>([])
  const [error, setError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const PAGE_SIZE = 25

  useEffect(() => {
    if (!workspaceId) return
    void supabase
      .from('automation_runs')
      .select('id, automation_id, contact_id, conversation_id, status, trigger_type, trigger_payload, current_node_id, variables, error, started_at, completed_at, updated_at, automations(name), contacts(display_name, wa_jid)', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('started_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      .then(({ data, count, error: loadErr }) => {
        if (loadErr) setError(loadErr.message)
        else {
          setRows((data as AutomationRun[]) ?? [])
          setTotal(count ?? 0)
        }
      })
  }, [workspaceId, page])

  if (!workspaceId) return <p className="text-slate-500">Missing workspace.</p>

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader title="Automation activity" description="Recent automation runs, trigger events, current nodes, and failures." />
        <Link
          to={`/w/${workspaceId}/automations`}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-transparent dark:text-slate-300 dark:hover:bg-slate-800/60"
        >
          Back to automations
        </Link>
      </div>
      <FormError message={error} />
      <div className="flex items-center gap-2 text-xs">
        <button
          type="button"
          disabled={page === 0}
          onClick={() => setPage((current) => Math.max(0, current - 1))}
          className="rounded border border-slate-300 px-2 py-1 text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300"
        >
          Prev
        </button>
        <span className="text-slate-500">
          Page {page + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))}
        </span>
        <button
          type="button"
          disabled={(page + 1) * PAGE_SIZE >= total}
          onClick={() => setPage((current) => current + 1)}
          className="rounded border border-slate-300 px-2 py-1 text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300"
        >
          Next
        </button>
      </div>

      <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1 text-sm dark:border-slate-800 dark:bg-slate-950/60">
        <Link to={`/w/${workspaceId}/automations`} className="rounded-lg px-3 py-1.5 text-slate-600 dark:text-slate-400">
          Automations
        </Link>
        <span className="rounded-lg bg-white px-3 py-1.5 text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white dark:shadow-none">Activity log</span>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/50">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-100 text-xs uppercase tracking-wide text-slate-600 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-500">
            <tr>
              <th className="px-4 py-3">Started</th>
              <th className="px-4 py-3">Automation</th>
              <th className="px-4 py-3">Trigger</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Current node</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Error</th>
              <th className="px-4 py-3">Trace</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                  No automation runs yet. Send a WhatsApp message that matches an active trigger to create one.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const trace = executionTrace(row)
                const expanded = expandedId === row.id
                return (
                  <Fragment key={row.id}>
                    <tr>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        {new Date(row.started_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <p className="font-medium text-slate-900 dark:text-white">{row.automations?.name ?? 'Automation'}</p>
                        <p className="font-mono text-xs text-slate-500">{row.automation_id}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800/30">{row.trigger_type}</td>
                      <td className="px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <p className="text-slate-700 dark:text-slate-300">{row.contacts?.display_name ?? row.contacts?.wa_jid ?? '-'}</p>
                        {row.contacts?.wa_jid ? <p className="font-mono text-xs text-slate-500">{row.contacts.wa_jid}</p> : null}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800/30">{row.current_node_id}</td>
                      <td className="px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${
                            row.status === 'failed'
                              ? 'bg-red-500/15 text-red-600 dark:text-red-300'
                              : row.status === 'completed'
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                : 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                          }`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="max-w-xs px-4 py-3 text-red-600 hover:bg-slate-50 dark:text-red-300 dark:hover:bg-slate-800/30">{row.error ?? '-'}</td>
                      <td className="px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <button
                          type="button"
                          onClick={() => setExpandedId(expanded ? null : row.id)}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:border-cyan-500/70 hover:text-slate-900 dark:border-slate-700 dark:bg-transparent dark:text-slate-300 dark:hover:text-white"
                        >
                          {expanded ? 'Hide' : 'View'} trace ({trace.length})
                        </button>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="bg-slate-50 dark:bg-slate-950/40">
                        <td colSpan={8} className="px-4 py-4">
                          {trace.length === 0 ? (
                            <p className="text-sm text-slate-500">No detailed trace was recorded for this older run. New runs will include node-by-node details.</p>
                          ) : (
                            <div className="space-y-3">
                              {trace.map((entry, index) => (
                                <div key={`${row.id}-${index}`} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/70">
                                  <div className="flex flex-wrap items-center gap-2 text-xs">
                                    <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 font-medium text-cyan-700 dark:text-cyan-300">{index + 1}</span>
                                    <span className="font-mono text-slate-600 dark:text-slate-400">{entry.nodeId ?? '-'}</span>
                                    <span className="text-slate-500">{entry.nodeType ?? '-'}</span>
                                    <span className="font-medium text-slate-900 dark:text-white">{entry.event ?? 'step'}</span>
                                    {entry.at ? <span className="ml-auto font-mono text-slate-600">{new Date(entry.at).toLocaleTimeString()}</span> : null}
                                  </div>
                                  {entry.detail ? (
                                    <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                                      {Object.entries(entry.detail).map(([key, value]) => (
                                        <div key={key} className="rounded-lg bg-slate-100 p-2 dark:bg-slate-900/70">
                                          <dt className="text-slate-500">{key}</dt>
                                          <dd className="mt-1 break-words font-mono text-slate-700 dark:text-slate-300">{formatDetailValue(value)}</dd>
                                        </div>
                                      ))}
                                    </dl>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
