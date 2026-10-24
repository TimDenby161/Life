import { supabase } from '@/lib/supabase'
import type { FeedSource, ProviderResult } from './types'

export async function fetchViaEdge(source: FeedSource): Promise<ProviderResult> {
  const { data, error } = await supabase.functions.invoke<ProviderResult>('external-feed', { body: { sourceId: source.id } })
  if (error) {
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null)
    if (body?.status) return body as ProviderResult
    return { status: 'error', message: 'The feed service could not be reached.' }
  }
  return data ?? { status: 'error', message: 'Empty response' }
}
