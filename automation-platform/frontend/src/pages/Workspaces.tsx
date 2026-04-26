import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Workspace = { id: string; name: string; slug: string | null; created_at: string }

export default function Workspaces() {
  const [list, setList] = useState<Workspace[]>([])
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const { data, error: loadErr } = await supabase
      .from('workspaces')
      .select('id, name, slug, created_at')
      .order('created_at', { ascending: false })
    if (loadErr) setError(loadErr.message)
    else setList((data as Workspace[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const { error: insErr } = await supabase.from('workspaces').insert({ name: name.trim() })
    if (insErr) {
      setError(insErr.message)
      return
    }
    setName('')
    await load()
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Workspaces</h1>
        <p className="mt-1 text-slate-600 dark:text-slate-400">Each workspace has its own WhatsApp session, contacts, and automations.</p>
      </div>

      <form onSubmit={create} className="flex max-w-xl flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/40 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1 text-sm">
          <span className="text-slate-600 dark:text-slate-400">New workspace name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sales team"
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-cyan-500/50 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-500"
        >
          Create
        </button>
      </form>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {loading ? (
        <p className="text-slate-500">Loading workspaces…</p>
      ) : list.length === 0 ? (
        <p className="text-slate-500">No workspaces yet. Create one above.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map((w) => (
            <li key={w.id}>
              <Link
                to={`/w/${w.id}`}
                className="block rounded-xl border border-slate-200 bg-white p-4 transition hover:border-cyan-500/40 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:bg-slate-900"
              >
                <h2 className="font-medium text-slate-900 dark:text-white">{w.name}</h2>
                <p className="mt-1 text-xs text-slate-500">{w.id}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
