import { createClient, processLock } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { env } from './env'

// The publishable key only grants what RLS allows; all authorisation is
// enforced in Postgres. Placeholder values keep the module importable when the
// app is not configured (the UI shows setup instructions instead).
export const supabase = createClient<Database>(
  env.supabaseUrl ?? 'http://localhost:54321',
  env.supabaseAnonKey ?? 'missing-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // The default cross-tab Web Locks lock can deadlock (notably in Safari
      // with several tabs open), leaving the app stuck on its splash screen.
      // A per-tab lock avoids that; the server tolerates the rare concurrent
      // refresh from two tabs (refresh-token reuse interval).
      lock: processLock,
    },
  },
)

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row']
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert']
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update']
export type Views<T extends keyof Database['public']['Views']> = Database['public']['Views'][T]['Row']
