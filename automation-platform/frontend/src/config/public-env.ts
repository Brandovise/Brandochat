/**
 * Browser-safe Vite environment accessors.
 * Never import server secrets here.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
}

export function getSupabaseBrowserConfig(): { url: string; anonKey: string } {
  return {
    url: import.meta.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321',
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key',
  }
}

export function getDemoAuthConfig(): {
  /** Show “Use demo account” and related demo-only UI */
  enabled: boolean
  /** Prefill email/password so Sign in works in one click when demo creds are baked in */
  prefillLoginFields: boolean
  email: string
  password: string
} {
  const modeOn = String(import.meta.env.VITE_DEMO_MODE || '').toLowerCase() === 'true'
  const prefillOptIn =
    String(import.meta.env.VITE_DEMO_PREFILL || '').toLowerCase() === 'true'
  const explicitEmail = String(import.meta.env.VITE_DEMO_EMAIL ?? '').trim()
  const explicitPassword = String(import.meta.env.VITE_DEMO_PASSWORD ?? '').trim()
  const explicitCreds = explicitEmail !== '' && explicitPassword !== ''

  const email = explicitEmail || 'demo@brandochat.local'
  const password = explicitPassword || 'DemoPass123!'

  return {
    enabled: modeOn,
    /** Prefill when demo mode, both explicit vars, or VITE_DEMO_PREFILL=true (uses email/password or built-in defaults) */
    prefillLoginFields: modeOn || explicitCreds || prefillOptIn,
    email,
    password,
  }
}
