import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Row = {
  id: string
  direction: string
  body: string | null
  wa_chat_jid: string | null
  node_id: string | null
  created_at: string
}

export default function MessageLog() {
  const { workspaceId } = useParams()
  const [rows, setRows] = useState<Row[]>([])
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const PAGE_SIZE = 50

  useEffect(() => {
    if (!workspaceId) return
    void supabase
      .from('message_events')
      .select('id, direction, body, wa_chat_jid, node_id, created_at', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      .then(({ data, count }) => {
        setRows((data as Row[]) ?? [])
        setTotal(count ?? 0)
      })
  }, [workspaceId, page])

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Message log</h1>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600 dark:text-slate-400">Inbound and outbound message events.</p>
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
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Dir</th>
              <th className="px-3 py-2">Chat</th>
              <th className="px-3 py-2">Node</th>
              <th className="px-3 py-2">Body</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                  No events yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="bg-white hover:bg-slate-50 dark:bg-slate-900/30 dark:hover:bg-slate-800/30">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-500">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        r.direction === 'inbound' ? 'text-sky-600 dark:text-sky-400' : 'text-emerald-600 dark:text-emerald-400'
                      }
                    >
                      {r.direction}
                    </span>
                  </td>
                  <td className="max-w-[140px] truncate px-3 py-2 font-mono text-xs text-slate-500">
                    {r.wa_chat_jid}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">{r.node_id}</td>
                  <td className="max-w-md px-3 py-2 text-slate-700 dark:text-slate-300">{r.body}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
