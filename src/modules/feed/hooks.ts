import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/modules/auth/AuthProvider'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import * as api from './api'
import { feedKeys } from './api'
import { feedProviders } from './providers/registry'
import type { FeedSource } from './providers/types'

export const usePosts = () => useQuery({ queryKey: feedKeys.posts, queryFn: () => api.fetchPosts() })
export const useFeedEvents = (limit = 60) => useQuery({ queryKey: feedKeys.events(limit), queryFn: () => api.fetchEvents(limit) })
export const useFeedSources = () => useQuery({ queryKey: feedKeys.sources, queryFn: api.fetchSources })

export function useMyReads() {
  const { session } = useAuth()
  const userId = session?.user.id
  return useQuery({ queryKey: feedKeys.reads, queryFn: () => api.fetchMyReads(userId!), enabled: Boolean(userId) })
}

/** Posts written by someone else that I haven't opened the feed to see yet. */
export function useUnreadPostCount(): number {
  const { session } = useAuth()
  const posts = usePosts().data
  const reads = useMyReads().data
  if (!posts || !reads || !session) return 0
  return posts.filter((p) => p.author_id !== session.user.id && !reads.has(p.id)).length
}

export function useExternalSource(source: FeedSource) {
  return useQuery({
    queryKey: [...feedKeys.external(source.id), source.updated_at],
    queryFn: () => feedProviders[source.provider].fetch(source),
    staleTime: 10 * 60_000,
    retry: 1,
  })
}

function useFeedMutation<TArgs>(fn: (householdId: string, args: TArgs) => Promise<void>, silent = false) {
  const { household } = useHousehold()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: TArgs) => fn(household.id, args),
    onSuccess: () => qc.invalidateQueries({ queryKey: feedKeys.all }),
    meta: { silent },
  })
}

export const useCreatePost = () => useFeedMutation((h, body: string) => api.createPost(h, body))
export const useUpdatePost = () => useFeedMutation((_h, a: { id: string; patch: Parameters<typeof api.updatePost>[1] }) => api.updatePost(a.id, a.patch))
export const useDeletePost = () => useFeedMutation((_h, id: string) => api.deletePost(id))
export const useAddComment = () => useFeedMutation((h, a: { postId: string; body: string }) => api.addComment(h, a.postId, a.body))
export const useDeleteComment = () => useFeedMutation((_h, id: string) => api.deleteComment(id))
export const useMarkRead = () => useFeedMutation((h, ids: string[]) => api.markRead(h, ids), true)
export const useSaveSource = () => useFeedMutation((h, input: Parameters<typeof api.saveSource>[1]) => api.saveSource(h, input))
export const useDeleteSource = () => useFeedMutation((_h, id: string) => api.deleteSource(id))
