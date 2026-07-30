import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { getDemoAuthConfig } from '../config/public-env'

export default function Login() {
  const { user, loading, signIn, signUp, configured } = useAuth()
  const demo = getDemoAuthConfig()
  const [email, setEmail] = useState(demo.prefillLoginFields ? demo.email : '')
  const [password, setPassword] = useState(demo.prefillLoginFields ? demo.password : '')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-slate-500">Loading…</div>
    )
  }
  if (!configured) {
    return (
      <div className="mx-auto max-w-md rounded-xl border border-amber-500/30 bg-amber-500/10 p-6 text-amber-100">
        <h1 className="text-lg font-semibold">Configure Supabase</h1>
        <p className="mt-2 text-sm text-amber-200/90">
          Add <code className="rounded bg-slate-900 px-1">VITE_SUPABASE_URL</code> and{' '}
          <code className="rounded bg-slate-900 px-1">VITE_SUPABASE_ANON_KEY</code> to{' '}
          <code className="rounded bg-slate-900 px-1">frontend/.env</code>, then restart the dev
          server.
        </p>
      </div>
    )
  }
  if (user) return <Navigate to="/workspaces" replace />

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'signin') await signIn(email, password)
      else await signUp(email, password)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setBusy(false)
    }
  }

  async function useDemoLogin() {
    setError(null)
    setBusy(true)
    try {
      await signIn(demo.email, demo.password)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Demo login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center">
      <div className="mx-auto grid w-full max-w-5xl gap-6 md:grid-cols-2">
      <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-cyan-50 to-indigo-50 p-6 dark:border-slate-800 dark:from-slate-900 dark:to-slate-950">
        <div className="mb-4 inline-flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-indigo-500 text-sm font-bold text-white">
            BC
          </span>
          <h1 className="text-xl font-semibold">
            <span className="text-cyan-700 dark:text-cyan-300">Brando</span>
            <span className="text-indigo-700 dark:text-indigo-300">chat</span>
          </h1>
        </div>
        <p className="text-sm leading-6 text-slate-700 dark:text-slate-300">
          Connect your WhatsApp numbers, private or business, and start automating conversations with templates, workflows, and AI-powered follow-ups.
        </p>
        <ul className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-400">
          <li>- Multi-number WhatsApp inbox</li>
          <li>- Templates and automation builder</li>
          <li>- Calendly + API integrations</li>
          <li>- Team assignment and activity logs</li>
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900/50">
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-white">{mode === 'signin' ? 'Sign in' : 'Create account'}</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Use your workspace credentials to continue.</p>
        <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
          <label className="block text-sm">
            <span className="text-slate-600 dark:text-slate-400">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-cyan-500/50 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-600 dark:text-slate-400">Password</span>
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none ring-cyan-500/50 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
          >
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
          {demo.enabled ? (
            <button
              type="button"
              disabled={busy}
              className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-4 py-2.5 text-sm font-medium text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
              onClick={useDemoLogin}
            >
              Use demo account
            </button>
          ) : null}
          <button
            type="button"
            className="text-center text-sm text-cyan-600 hover:underline dark:text-cyan-300"
            onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
          >
            {mode === 'signin' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
          </button>
        </form>
      </section>
      </div>
    </div>
  )
}
