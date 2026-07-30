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
