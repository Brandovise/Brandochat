import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { Button } from '../shared/ui/button'
import { FormError } from '../shared/ui/form-error'
import { FormField } from '../shared/ui/form-field'
import { PageHeader } from '../shared/ui/page-header'
import { TextInput } from '../shared/ui/text-input'

type ProfileRow = {
  id: string
  display_name: string | null
  avatar_url: string | null
}

type WorkspaceRow = {
  id: string
  name: string
  slug: string | null
}

export default function AccountSettings() {
  const { signOut, user } = useAuth()
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([])
  const [displayName, setDisplayName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!user) return
    void Promise.all([
      supabase.from('profiles').select('id, display_name, avatar_url').eq('id', user.id).maybeSingle(),
      supabase.from('workspaces').select('id, name, slug').order('created_at', { ascending: false }),
    ]).then(([profileResult, workspaceResult]) => {
      if (profileResult.error) setError(profileResult.error.message)
      const nextProfile = (profileResult.data as ProfileRow | null) ?? null
      setDisplayName(nextProfile?.display_name ?? '')
      setAvatarUrl(nextProfile?.avatar_url ?? '')
      if (workspaceResult.error) setError(workspaceResult.error.message)
      else setWorkspaces((workspaceResult.data as WorkspaceRow[]) ?? [])
    })
  }, [user])

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault()
    if (!user) return
    setError(null)
    setSaved(false)
    const payload = {
      id: user.id,
      display_name: displayName.trim() || null,
      avatar_url: avatarUrl.trim() || null,
    }
    const { data, error: saveErr } = await supabase
      .from('profiles')
      .upsert(payload)
      .select('id, display_name, avatar_url')
      .single()
    if (saveErr) {
      setError(saveErr.message)
      return
    }
    const nextProfile = data as ProfileRow
    setDisplayName(nextProfile.display_name ?? '')
    setAvatarUrl(nextProfile.avatar_url ?? '')
    setSaved(true)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageHeader title="Account settings" description="Manage your user profile and switch between the workspaces you belong to." />
        <Button type="button" variant="secondary" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
      <FormError message={error} />
      {saved ? <p className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-700 dark:text-cyan-300">Profile saved.</p> : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/50">
        <form onSubmit={saveProfile} className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Profile</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{user?.email}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Display name">
              <TextInput value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Your name" />
            </FormField>
            <FormField label="Avatar URL">
              <TextInput value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} placeholder="https://..." />
            </FormField>
          </div>
          <Button type="submit">Save profile</Button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/50">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Your workspaces</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {workspaces.map((workspace) => (
            <Link
              key={workspace.id}
              to={`/w/${workspace.id}/chats`}
              className="rounded-xl border border-slate-200 bg-slate-50 p-4 transition hover:border-cyan-500/50 dark:border-slate-800 dark:bg-slate-950/60"
            >
              <p className="font-medium text-slate-900 dark:text-white">{workspace.name}</p>
              <p className="mt-1 font-mono text-xs text-slate-500">{workspace.slug ?? workspace.id}</p>
            </Link>
          ))}
          {workspaces.length === 0 ? <p className="text-sm text-slate-500">No workspaces yet.</p> : null}
        </div>
      </section>
    </div>
  )
}
