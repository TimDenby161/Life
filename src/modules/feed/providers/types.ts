import type { Tables } from '@/lib/supabase'

export type FeedSource = Tables<'feed_sources'>

export type ExternalItem = {
  id: string
  kind: 'article' | 'fixture' | 'result'
  title: string
  url: string | null
  publishedAt: string | null
  summary: string | null
  meta?: Record<string, string | number | null>
}

export type ProviderResult =
  | { status: 'ok'; items: ExternalItem[]; fetchedAt: string; attribution: string; isMock?: boolean }
  | { status: 'not_configured' | 'error'; message: string }

export type ConfigField = { key: string; label: string; placeholder?: string; hint?: string; type?: 'text' | 'number' | 'url' }

/**
 * A source of external information shown in the feed. Providers that need
 * credentials run server-side (Edge Function); the browser never sees keys.
 * To add one: implement this, register it, and (if server-side) add a branch
 * to supabase/functions/external-feed.
 */
export interface FeedProvider {
  id: FeedSource['provider']
  label: string
  description: string
  configFields: ConfigField[]
  fetch(source: FeedSource): Promise<ProviderResult>
}
