// Shared helpers for Edge Functions. Never log request bodies or upstream
// responses: they can contain private calendar or household information.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'

const allowed = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  // The JWT check is the security boundary; CORS just limits which sites can call us from a browser.
  const allow = allowed.length === 0 ? '*' : allowed.includes(origin) ? origin : allowed[0]
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

/**
 * A Supabase client acting as the calling user, so every query is subject to
 * RLS. Returns null when the request has no valid session.
 */
export async function userClient(req: Request): Promise<SupabaseClient | null> {
  const authorization = req.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return null
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.auth.getUser(authorization.slice('Bearer '.length))
  if (error || !data.user) return null
  return client
}

/** Tiny per-instance TTL cache (Edge Function instances are short-lived). */
export class TtlCache<T> {
  #store = new Map<string, { value: T; expires: number }>()
  constructor(private ttlMs: number) {}
  get(key: string): T | undefined {
    const hit = this.#store.get(key)
    if (!hit || hit.expires < Date.now()) return undefined
    return hit.value
  }
  set(key: string, value: T) {
    if (this.#store.size > 200) this.#store.clear()
    this.#store.set(key, { value, expires: Date.now() + this.ttlMs })
  }
}
