import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { supabase } from '../lib/supabase'

const navCls = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive
      ? 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
  }`

type Workspace = {
  id: string
  name: string
}

type ContactListLite = { id: string; name: string }
type ContactTagLite = { id: string; name: string }

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

export function AppShell() {
  const { user } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { workspaceId } = useParams()
  const location = useLocation()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const isBuilder = location.pathname.includes('/automations/') && location.pathname.endsWith('/builder')

  useEffect(() => {
    void supabase
      .from('workspaces')
      .select('id, name')
      .order('created_at', { ascending: false })
      .then(({ data }) => setWorkspaces((data as Workspace[]) ?? []))
  }, [])

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <aside className={`hidden w-[76px] shrink-0 border-r border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950 lg:flex-col ${isBuilder ? 'lg:hidden' : 'lg:flex'}`}>
        <Link
          to="/workspaces"
          title="All workspaces"
          className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-indigo-500 text-lg font-bold text-white shadow-lg shadow-cyan-950/40"
        >
          BC
        </Link>

        <nav className="flex flex-1 flex-col items-center gap-3 overflow-y-auto">
          {workspaces.map((workspace) => {
            const active = workspace.id === workspaceId
            return (
              <Link
                key={workspace.id}
                to={`/w/${workspace.id}/chats`}
                title={workspace.name}
                className={`group relative flex h-12 w-12 items-center justify-center rounded-2xl text-sm font-semibold transition ${
                  active
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-200 text-slate-700 hover:rounded-xl hover:bg-slate-300 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white'
                }`}
              >
                {active ? <span className="absolute -left-3 h-8 w-1 rounded-r bg-cyan-300" /> : null}
                {initials(workspace.name) || 'WS'}
              </Link>
            )
          })}
          <Link
            to="/workspaces"
            title="Create or choose workspace"
            className="flex h-12 w-12 items-center justify-center rounded-2xl border border-dashed border-slate-300 text-xl text-slate-500 hover:border-cyan-500/60 hover:text-cyan-300 dark:border-slate-700 dark:text-slate-400"
          >
            +
          </Link>
        </nav>

        <div className="mt-4 flex flex-col items-center gap-2">
          <button
            title="Toggle theme"
            onClick={toggleTheme}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button
            title="Notifications"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            🔔
          </button>
          <Link
            title="Settings"
            to="/account/settings"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            ⚙️
          </Link>
          <Link
            title={user?.email}
            to="/account/settings"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:text-white"
          >
            {user?.email?.slice(0, 2).toUpperCase() ?? 'ME'}
          </Link>
        </div>
      </aside>
      <main className={`flex min-w-0 flex-1 flex-col ${isBuilder ? 'p-0' : 'px-4 py-6 lg:px-6'}`}>
        <Outlet />
      </main>
    </div>
  )
}

export function WorkspaceShell() {
  const { workspaceId } = useParams()
  const location = useLocation()
  const { theme, toggleTheme } = useTheme()
  const base = `/w/${workspaceId}`
  const [stats, setStats] = useState({ connected: 0, unread: 0, assigned: 0 })
  const [workspaceName, setWorkspaceName] = useState('Current workspace')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [contactLists, setContactLists] = useState<ContactListLite[]>([])
  const [contactTags, setContactTags] = useState<ContactTagLite[]>([])

  const loadStats = useCallback(async () => {
    if (!workspaceId) return
    const [{ data: instances }, { data: contacts }] = await Promise.all([
      supabase.from('whatsapp_instances').select('pairing_status').eq('workspace_id', workspaceId),
      supabase.from('contacts').select('metadata').eq('workspace_id', workspaceId),
    ])

    const connected = (instances ?? []).filter((instance) => instance.pairing_status === 'connected').length
    const unread = (contacts ?? []).reduce((total, row) => {
      const value = (row.metadata as Record<string, unknown> | null)?.wa_unread_count
      return total + (typeof value === 'number' ? value : 0)
    }, 0)
    const assigned = (contacts ?? []).filter((row) => {
      const value = (row.metadata as Record<string, unknown> | null)?.assigned_to
      return typeof value === 'string' && value.length > 0
    }).length
    setStats({ connected, unread, assigned })
  }, [workspaceId])

  useEffect(() => {
    void loadStats()
    const t = setInterval(() => void loadStats(), 5000)
    return () => clearInterval(t)
  }, [loadStats])

  useEffect(() => {
    if (!workspaceId) return
    void supabase
      .from('workspaces')
      .select('name')
      .eq('id', workspaceId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.name) setWorkspaceName(data.name as string)
      })
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId) return
    void Promise.all([
      supabase.from('workspace_contact_lists').select('id, name').eq('workspace_id', workspaceId).order('name').limit(50),
      supabase.from('workspace_contact_tags').select('id, name').eq('workspace_id', workspaceId).order('name').limit(50),
    ]).then(([listsRes, tagsRes]) => {
      setContactLists((listsRes.data as ContactListLite[] | null) ?? [])
      setContactTags((tagsRes.data as ContactTagLite[] | null) ?? [])
    })
  }, [workspaceId])

  const productItems = useMemo(
    () => [
      { to: `${base}/templates`, label: 'Templates', symbol: '🧩' },
      { to: `${base}/automations`, label: 'Automations', symbol: '⚡' },
      { to: `${base}/whatsapp`, label: 'WhatsApp numbers', symbol: '🟢', badge: stats.connected },
      { to: `${base}/integrations`, label: 'Integrations', symbol: '🔌' },
    ],
    [base, stats.connected],
  )
  const mobileTabs = [
    { to: `${base}/chats`, label: 'Chats', icon: '💬' },
    { to: `${base}/contacts`, label: 'Contacts', icon: '👥' },
    { to: `${base}/templates`, label: 'Templates', icon: '🧩' },
    { to: `${base}/automations`, label: 'Flows', icon: '⚡' },
    { to: `${base}/whatsapp`, label: 'WhatsApp', icon: '🟢' },
  ]
  const isBuilder = location.pathname.includes('/automations/') && location.pathname.endsWith('/builder')

  if (isBuilder) {
    return <Outlet />
  }

  return (
    <div className="grid min-h-[calc(100vh-3rem)] grid-cols-1 gap-4 lg:grid-cols-[240px_1fr]">
      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/70 lg:hidden">
        <p className="truncate font-medium">{workspaceName}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            className="rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-700"
            title="Toggle theme"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button
            type="button"
            onClick={() => setMobileNavOpen((value) => !value)}
            className="rounded-lg border border-slate-300 px-3 py-1 text-sm dark:border-slate-700"
          >
            {mobileNavOpen ? 'Close menu' : 'Open menu'}
          </button>
        </div>
      </div>
      <aside className={`rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-xl shadow-slate-200/40 dark:border-slate-800 dark:bg-slate-900/70 dark:shadow-slate-950/20 ${mobileNavOpen ? 'block' : 'hidden'} lg:block`}>
        <div className="mb-3 flex items-center gap-3 rounded-xl border border-cyan-500/20 bg-gradient-to-r from-cyan-50 to-indigo-50 px-3 py-2 dark:border-slate-700 dark:from-slate-900 dark:to-slate-800">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-indigo-500 text-sm font-bold text-white">
            BC
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              <span className="text-cyan-600 dark:text-cyan-300">Brando</span>
              <span className="text-indigo-600 dark:text-indigo-300">chat</span>
            </p>
            <p className="truncate text-[11px] text-slate-500 dark:text-slate-500">Brandovise team inbox</p>
          </div>
        </div>
        <div className="mb-4 rounded-xl bg-slate-100 p-3 dark:bg-slate-950/60">
          <p className="text-xs uppercase tracking-wide text-slate-500">Workspace</p>
          <p className="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-white">{workspaceName}</p>
        </div>

        <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-950/40">
          <div className="mb-1 flex items-center gap-2 px-2 py-1 text-xs uppercase tracking-wide text-slate-500">
            <span>💬</span>
            Inbox
          </div>
          <nav className="space-y-1">
            <NavLink to={`${base}/chats`} end className={navCls}>
              <span className="ml-9">All conversations</span>
            </NavLink>
            <NavLink to={`${base}/chats?view=assigned`} className={navCls}>
              <span className="ml-9">Assigned to me</span>
              <span className="ml-auto rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">{stats.assigned}</span>
            </NavLink>
            <NavLink to={`${base}/chats?view=unread`} className={navCls}>
              <span className="ml-9">Unread</span>
              <span className="ml-auto rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">{stats.unread}</span>
            </NavLink>
          </nav>
        </div>

        <nav className="space-y-1 border-t border-slate-200 pt-2 dark:border-slate-800">
          <div className="px-2 py-1 text-xs uppercase tracking-wide text-slate-500">Contacts</div>
          <NavLink to={`${base}/contacts`} end className={navCls}>
            <span className="mr-1 inline-flex h-8 w-8 items-center justify-center rounded-xl bg-slate-200 text-base text-slate-700 dark:bg-slate-800 dark:text-slate-300">👥</span>
            <span>All contacts</span>
          </NavLink>
          <NavLink to={`${base}/contacts?view=lists`} className={navCls}>
            <span className="mr-1 inline-flex h-8 w-8 items-center justify-center rounded-xl bg-slate-200 text-base text-slate-700 dark:bg-slate-800 dark:text-slate-300">📋</span>
            <span>Lists</span>
          </NavLink>
          <div className="ml-11 space-y-1 pb-1">
            {contactLists.slice(0, 10).map((list) => (
              <NavLink
                key={list.id}
                to={`${base}/contacts?view=all&list=${list.id}`}
                className={({ isActive }) =>
                  `block rounded-md px-2 py-1 text-xs transition ${
                    isActive
                      ? 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-300'
                  }`
                }
              >
                {list.name}
              </NavLink>
            ))}
            {contactLists.length > 10 ? (
              <NavLink to={`${base}/contacts?view=lists`} className="block rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                See more ({contactLists.length - 10}+)
              </NavLink>
            ) : null}
          </div>
          <NavLink to={`${base}/contacts?view=tags`} className={navCls}>
            <span className="mr-1 inline-flex h-8 w-8 items-center justify-center rounded-xl bg-slate-200 text-base text-slate-700 dark:bg-slate-800 dark:text-slate-300">🏷️</span>
            <span>Tags</span>
          </NavLink>
          <div className="ml-11 space-y-1 pb-1">
            {contactTags.slice(0, 10).map((tag) => (
              <NavLink
                key={tag.id}
                to={`${base}/contacts?view=all&tag=${tag.id}`}
                className={({ isActive }) =>
                  `block rounded-md px-2 py-1 text-xs transition ${
                    isActive
                      ? 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-300'
                  }`
                }
              >
                {tag.name}
              </NavLink>
            ))}
            {contactTags.length > 10 ? (
              <NavLink to={`${base}/contacts?view=tags`} className="block rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                See more ({contactTags.length - 10}+)
              </NavLink>
            ) : null}
          </div>

          <div className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-800" />
          {productItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={navCls}>
              <span className="mr-1 inline-flex h-8 w-8 items-center justify-center rounded-xl bg-slate-200 text-base text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {item.symbol}
              </span>
              <span>{item.label}</span>
              {typeof item.badge === 'number' ? (
                <span className="ml-auto rounded-full bg-cyan-500/15 px-2 py-0.5 text-xs text-cyan-700 dark:text-cyan-300">{item.badge}</span>
              ) : null}
            </NavLink>
          ))}
        </nav>

        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-950/40">
          <div className="mb-1 flex items-center gap-2 px-2 py-1 text-xs uppercase tracking-wide text-slate-500">
            <span>⚙️</span>
            Settings
          </div>
          <nav className="space-y-1">
            <NavLink to={`${base}/settings`} end className={navCls}>
              <span className="ml-9">Workspace settings</span>
            </NavLink>
            <NavLink to={`${base}/logs`} className={navCls}>
              <span className="ml-9">Message log</span>
            </NavLink>
          </nav>
        </div>
      </aside>
      <div className="min-w-0">
        <Outlet />
      </div>
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 px-2 py-1 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 lg:hidden">
        <div className="grid grid-cols-5 gap-1">
          {mobileTabs.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center rounded-lg px-1 py-1 text-[11px] ${
                  isActive ? 'bg-cyan-500/15 text-cyan-500 dark:text-cyan-300' : 'text-slate-500 dark:text-slate-400'
                }`
              }
            >
              <span className="text-sm">{item.icon}</span>
              <span className="truncate">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
