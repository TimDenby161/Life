import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { subDays } from 'date-fns'
import { toast } from 'sonner'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import * as api from './api'
import { taskKeys } from './api'

export function useTaskLists() {
  return useQuery({ queryKey: taskKeys.lists, queryFn: api.fetchTaskLists, staleTime: 5 * 60_000 })
}

export function useTaskCategories() {
  return useQuery({ queryKey: taskKeys.categories, queryFn: api.fetchTaskCategories, staleTime: 5 * 60_000 })
}

export function useTaskRooms() {
  return useQuery({ queryKey: taskKeys.rooms, queryFn: api.fetchTaskRooms, staleTime: 5 * 60_000 })
}

export function useCreateRoom() {
  const { household } = useHousehold()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ name, sortOrder }: { name: string; sortOrder: number }) => api.createRoom(household.id, name, sortOrder),
    onSuccess: () => qc.invalidateQueries({ queryKey: taskKeys.rooms }),
  })
}

export function useOpenOccurrences() {
  return useQuery({ queryKey: taskKeys.open, queryFn: api.fetchOpenOccurrences })
}

export function useRecentlyDone(days = 14) {
  return useQuery({
    queryKey: [...taskKeys.done, days],
    queryFn: () => api.fetchRecentlyDone(subDays(new Date(), days).toISOString()),
  })
}

export function useTaskDetail(taskId: string | null) {
  return useQuery({
    queryKey: taskKeys.detail(taskId ?? ''),
    queryFn: () => api.fetchTaskDetail(taskId!),
    enabled: Boolean(taskId),
  })
}

export function useCompletionEvents() {
  return useQuery({ queryKey: taskKeys.events, queryFn: api.fetchCompletionEvents })
}

export function useStatsOccurrences(from: string) {
  return useQuery({ queryKey: [...taskKeys.statsOccurrences, from], queryFn: () => api.fetchStatsOccurrences(from) })
}

export function useJobs() {
  return useQuery({ queryKey: taskKeys.jobs, queryFn: api.fetchJobs })
}

function useInvalidateTasks() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: taskKeys.all })
}

export function useCreateTask() {
  const { household } = useHousehold()
  const invalidate = useInvalidateTasks()
  return useMutation({
    mutationFn: (input: api.TaskInput) => api.createTask(household.id, input),
    onSuccess: invalidate,
  })
}

export function useUpdateTask() {
  const invalidate = useInvalidateTasks()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof api.updateTask>[1] }) => api.updateTask(id, patch),
    onSuccess: invalidate,
  })
}

export function useDeleteTask() {
  const invalidate = useInvalidateTasks()
  return useMutation({ mutationFn: api.deleteTask, onSuccess: invalidate })
}

/** Completes with an optimistic update so ticking a task feels instant. */
export function useCompleteOccurrence() {
  const qc = useQueryClient()
  const reopen = useReopenOccurrence()
  return useMutation({
    mutationFn: api.completeOccurrence,
    onMutate: async ({ occurrenceId }) => {
      await qc.cancelQueries({ queryKey: taskKeys.open })
      const previous = qc.getQueryData<api.OccurrenceWithTask[]>(taskKeys.open)
      qc.setQueryData<api.OccurrenceWithTask[]>(taskKeys.open, (old) => old?.filter((o) => o.id !== occurrenceId))
      return { previous }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(taskKeys.open, ctx.previous)
    },
    onSuccess: (occ) => {
      toast.success('Done', {
        action: { label: 'Undo', onClick: () => reopen.mutate(occ.id) },
      })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: taskKeys.all }),
  })
}

export function useSkipOccurrence() {
  const invalidate = useInvalidateTasks()
  return useMutation({ mutationFn: api.skipOccurrence, onSuccess: invalidate })
}

export function useReopenOccurrence() {
  const invalidate = useInvalidateTasks()
  return useMutation({ mutationFn: api.reopenOccurrence, onSuccess: invalidate })
}

export function useMoveOccurrence() {
  const invalidate = useInvalidateTasks()
  return useMutation({
    mutationFn: ({ id, dueDate }: { id: string; dueDate: string }) => api.moveOccurrence(id, dueDate),
    onSuccess: invalidate,
  })
}

export function useSubtaskMutations(taskId: string) {
  const { household } = useHousehold()
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: taskKeys.all })
  return {
    add: useMutation({
      mutationFn: ({ title, sortOrder }: { title: string; sortOrder: number }) =>
        api.addSubtask(household.id, taskId, title, sortOrder),
      onSuccess: invalidate,
    }),
    toggle: useMutation({
      mutationFn: ({ id, isDone }: { id: string; isDone: boolean }) => api.setSubtaskDone(id, isDone),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: api.deleteSubtask, onSuccess: invalidate }),
  }
}

export function useCommentMutations(taskId: string) {
  const { household } = useHousehold()
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: taskKeys.detail(taskId) })
  return {
    add: useMutation({ mutationFn: (body: string) => api.addComment(household.id, taskId, body), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: api.deleteComment, onSuccess: invalidate }),
  }
}

export function useCreateCategory() {
  const { household } = useHousehold()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ name, color }: { name: string; color: string }) => api.createCategory(household.id, name, color),
    onSuccess: () => qc.invalidateQueries({ queryKey: taskKeys.categories }),
  })
}

export function useDeleteCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.deleteCategory,
    // Its tasks lose the category.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

export function useDeleteRoom() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.deleteRoom,
    // Its jobs lose the room.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}

export function useSetCategoryOwner() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ownerId }: { id: string; ownerId: string | null }) => api.setCategoryOwner(id, ownerId),
    // Tasks in the category may have been reassigned too.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}
