import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, type Tables } from '@/lib/supabase'
import { unwrap } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'

export type WantRow = Tables<'wants'>
export type WantFields = Pick<WantRow, 'owner_id' | 'name' | 'need_by' | 'note' | 'url'>

/** The "Shoppinglist" task: its checklist is the shopping list too. */
export type ShoppingTask = { id: string; title: string; subtasks: ListItem[] }
export type ListItem = { id: string; title: string; is_done: boolean; done_at: string | null; due_date: string | null; sort_order: number; created_at: string }

/** "Shoppinglist", "Shopping list", "shopping-list": the task whose checklist is the shopping list. */
export const SHOPPING_LIST_TASK = /^\s*shopping[\s-]*list\s*$/i

// Shared within the household by RLS; owner_id null = for both of you.
export const shoppingKeys = { all: ['shopping'] as const }

export const useWants = () =>
  useQuery({ queryKey: shoppingKeys.all, queryFn: async () => unwrap(await supabase.from('wants').select('*').order('created_at')) })

// Under the tasks key, so a checklist change on either phone (realtime refreshes ['tasks']) shows here too.
const listKey = ['tasks', 'shopping-list'] as const

/** Your open Shoppinglist task and its checklist, or null if there isn't one. */
export const useShoppingTask = () =>
  useQuery({
    queryKey: listKey,
    queryFn: async () => {
      const rows = unwrap(
        await supabase
          .from('tasks')
          .select('id, title, subtasks:task_subtasks(id, title, is_done, done_at, due_date, sort_order, created_at)')
          .ilike('title', '%shopping%list%')
          .eq('status', 'active')
          .is('archived_at', null)
          .is('ai_asks_task_id', null)
          .order('created_at'),
      )
      return (rows.find((t) => SHOPPING_LIST_TASK.test(t.title)) as ShoppingTask | undefined) ?? null
    },
  })

function useListMutation<TArgs>(fn: (householdId: string, args: TArgs) => Promise<unknown>) {
  const { household } = useHousehold()
  const qc = useQueryClient()
  return useMutation({ mutationFn: (args: TArgs) => fn(household.id, args), onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }) })
}

/** Adds a thing to the Shoppinglist task's checklist, at the end. */
export const useAddListItem = () =>
  useListMutation(async (h, { task, title, dueDate }: { task: ShoppingTask; title: string; dueDate: string | null }) =>
    unwrap(
      await supabase.from('task_subtasks').insert({
        household_id: h,
        task_id: task.id,
        title,
        due_date: dueDate,
        sort_order: Math.max(-1, ...task.subtasks.map((s) => s.sort_order)) + 1,
      }),
    ),
  )

/** Renames, re-dates or ticks a checklist item. */
export const useUpdateListItem = () =>
  useListMutation(async (_h, { id, ...patch }: { id: string; title?: string; due_date?: string | null; is_done?: boolean }) =>
    unwrap(await supabase.from('task_subtasks').update(patch).eq('id', id)),
  )

export const useDeleteListItem = () => useListMutation(async (_h, id: string) => unwrap(await supabase.from('task_subtasks').delete().eq('id', id)))

function useShoppingMutation<TArgs>(fn: (householdId: string, args: TArgs) => Promise<unknown>) {
  const { household } = useHousehold()
  const qc = useQueryClient()
  return useMutation({ mutationFn: (args: TArgs) => fn(household.id, args), onSuccess: () => qc.invalidateQueries({ queryKey: shoppingKeys.all }) })
}

/** Adds a thing, or changes one when `id` is given. */
export const useSaveWant = () =>
  useShoppingMutation(async (h, { id, ...fields }: Partial<WantFields> & { id?: string }) =>
    id
      ? unwrap(await supabase.from('wants').update(fields).eq('id', id))
      : unwrap(await supabase.from('wants').insert({ name: '', ...fields, household_id: h })),
  )

/** Ticks a thing off as bought, or puts it back on the list. */
export const useSetBought = () =>
  useShoppingMutation(async (_h, { id, bought }: { id: string; bought: boolean }) =>
    unwrap(await supabase.from('wants').update({ bought_at: bought ? new Date().toISOString() : null }).eq('id', id)),
  )

export const useDeleteWant = () => useShoppingMutation(async (_h, id: string) => unwrap(await supabase.from('wants').delete().eq('id', id)))
