// Public, build-time configuration. Nothing here is secret.
export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string | undefined,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
}

export const isConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey)
