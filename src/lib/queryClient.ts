import { MutationCache, QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getErrorMessage } from './errors'

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        retry: (count, error) => count < 2 && !(error as { code?: string })?.code,
        refetchOnWindowFocus: true,
      },
      mutations: {
        // Fail fast when offline instead of silently queueing: offline editing
        // with conflict resolution is intentionally not supported.
        networkMode: 'always',
      },
    },
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => {
        if (mutation.options.meta?.silent) return
        toast.error(getErrorMessage(error))
      },
    }),
  })
}

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: { silent?: boolean }
  }
}
