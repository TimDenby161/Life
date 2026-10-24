import { supabase, type Tables } from '@/lib/supabase'
import { unwrap } from '@/lib/utils'

export type FeedPost = Tables<'feed_posts'> & { comments: Tables<'feed_comments'>[] }
export type FeedEvent = Tables<'feed_events'>

export const feedKeys = {
  all: ['feed'] as const,
  posts: ['feed', 'posts'] as const,
  reads: ['feed', 'reads'] as const,
  events: (limit: number) => ['feed', 'events', limit] as const,
  sources: ['feed', 'sources'] as const,
  external: (id: string) => ['feed', 'external', id] as const,
}

export async function fetchPosts(limit = 100): Promise<FeedPost[]> {
  return unwrap(
    await supabase
      .from('feed_posts')
      .select('*, comments:feed_comments(*)')
      .order('created_at', { ascending: false })
      .order('created_at', { referencedTable: 'feed_comments', ascending: true })
      .limit(limit),
  )
}

export async function fetchMyReads(userId: string) {
  const rows = unwrap(await supabase.from('feed_reads').select('post_id').eq('user_id', userId))
  return new Set(rows.map((r) => r.post_id))
}

export async function fetchEvents(limit: number) {
  return unwrap(await supabase.from('feed_events').select('*').order('created_at', { ascending: false }).limit(limit))
}

export async function fetchSources() {
  return unwrap(await supabase.from('feed_sources').select('*').order('sort_order').order('created_at'))
}

export async function createPost(householdId: string, body: string) {
  unwrap(await supabase.from('feed_posts').insert({ household_id: householdId, body }))
}
export async function updatePost(id: string, patch: { body?: string; pinned_at?: string | null }) {
  unwrap(await supabase.from('feed_posts').update(patch).eq('id', id))
}
export async function deletePost(id: string) {
  unwrap(await supabase.from('feed_posts').delete().eq('id', id))
}
export async function addComment(householdId: string, postId: string, body: string) {
  unwrap(await supabase.from('feed_comments').insert({ household_id: householdId, post_id: postId, body }))
}
export async function deleteComment(id: string) {
  unwrap(await supabase.from('feed_comments').delete().eq('id', id))
}
export async function markRead(householdId: string, postIds: string[]) {
  if (!postIds.length) return
  unwrap(
    await supabase
      .from('feed_reads')
      .upsert(postIds.map((post_id) => ({ household_id: householdId, post_id })), { onConflict: 'post_id,user_id', ignoreDuplicates: true }),
  )
}

export async function saveSource(householdId: string, input: { id?: string; provider: string; name: string; config: Record<string, unknown>; enabled: boolean }) {
  const { id, ...rest } = input
  const payload = { ...rest, config: rest.config as Tables<'feed_sources'>['config'] }
  if (id) unwrap(await supabase.from('feed_sources').update({ name: payload.name, config: payload.config, enabled: payload.enabled }).eq('id', id))
  else unwrap(await supabase.from('feed_sources').insert({ ...payload, household_id: householdId }))
}
export async function deleteSource(id: string) {
  unwrap(await supabase.from('feed_sources').delete().eq('id', id))
}
