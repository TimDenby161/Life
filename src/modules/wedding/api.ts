import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, type Tables, type TablesInsert } from '@/lib/supabase'
import { unwrap } from '@/lib/utils'
import { financeKeys } from '@/modules/finances/api'
import { useHousehold } from '@/modules/household/HouseholdProvider'

export type WeddingSettings = Tables<'wedding_settings'>
export type BudgetItem = Tables<'wedding_budget_items'>
export type Guest = Tables<'wedding_guests'>
export type WeddingTask = Tables<'wedding_tasks'>
export type Supplier = Tables<'wedding_suppliers'>

export const weddingKeys = {
  all: ['wedding'] as const,
  settings: ['wedding', 'settings'] as const,
  budget: ['wedding', 'budget'] as const,
  guests: ['wedding', 'guests'] as const,
  tasks: ['wedding', 'tasks'] as const,
  suppliers: ['wedding', 'suppliers'] as const,
}

const fetchers = {
  settings: async () => unwrap(await supabase.from('wedding_settings').select('*').maybeSingle()) as WeddingSettings | null,
  budget: async () => unwrap(await supabase.from('wedding_budget_items').select('*').order('category').order('sort_order').order('created_at')),
  guests: async () => unwrap(await supabase.from('wedding_guests').select('*').order('party', { nullsFirst: false }).order('name')),
  tasks: async () => unwrap(await supabase.from('wedding_tasks').select('*').order('done_at', { nullsFirst: true }).order('due_date', { nullsFirst: false }).order('created_at')),
  suppliers: async () => unwrap(await supabase.from('wedding_suppliers').select('*').order('role').order('name')),
}

export const useWeddingSettings = () => useQuery({ queryKey: weddingKeys.settings, queryFn: fetchers.settings })
export const useBudgetItems = () => useQuery({ queryKey: weddingKeys.budget, queryFn: fetchers.budget })
export const useGuests = () => useQuery({ queryKey: weddingKeys.guests, queryFn: fetchers.guests })
export const useWeddingTasks = () => useQuery({ queryKey: weddingKeys.tasks, queryFn: fetchers.tasks })
export const useSuppliers = () => useQuery({ queryKey: weddingKeys.suppliers, queryFn: fetchers.suppliers })

/** Wedding mutations refresh the module; budget changes also move the pot target, so finances refresh too. */
function useWeddingMutation<TArgs>(fn: (householdId: string, args: TArgs) => Promise<unknown>) {
  const { household } = useHousehold()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: TArgs) => fn(household.id, args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: weddingKeys.all })
      qc.invalidateQueries({ queryKey: financeKeys.all })
    },
  })
}

type Row<T extends 'wedding_budget_items' | 'wedding_guests' | 'wedding_tasks' | 'wedding_suppliers'> = Omit<TablesInsert<T>, 'household_id'> & { id?: string }

// Insert when there's no id, else update; household_id is only ever sent on insert (it isn't updatable).
async function saveBudgetItem(h: string, { id, ...fields }: Row<'wedding_budget_items'>) {
  if (id) unwrap(await supabase.from('wedding_budget_items').update(fields).eq('id', id))
  else unwrap(await supabase.from('wedding_budget_items').insert({ ...fields, household_id: h }))
}
async function saveGuest(h: string, { id, ...fields }: Row<'wedding_guests'>) {
  if (id) unwrap(await supabase.from('wedding_guests').update(fields).eq('id', id))
  else unwrap(await supabase.from('wedding_guests').insert({ ...fields, household_id: h }))
}
async function saveTask(h: string, { id, ...fields }: Row<'wedding_tasks'>) {
  if (id) unwrap(await supabase.from('wedding_tasks').update(fields).eq('id', id))
  else unwrap(await supabase.from('wedding_tasks').insert({ ...fields, household_id: h }))
}
async function saveSupplier(h: string, { id, ...fields }: Row<'wedding_suppliers'>) {
  if (id) unwrap(await supabase.from('wedding_suppliers').update(fields).eq('id', id))
  else unwrap(await supabase.from('wedding_suppliers').insert({ ...fields, household_id: h }))
}

export const useSaveWeddingSettings = () =>
  useWeddingMutation(async (h, input: { wedding_date?: string | null; pot_goal_id?: string | null }) => {
    const existing = unwrap(await supabase.from('wedding_settings').select('household_id').maybeSingle())
    if (existing) unwrap(await supabase.from('wedding_settings').update(input).eq('household_id', h))
    else unwrap(await supabase.from('wedding_settings').insert({ ...input, household_id: h }))
  })

export const useSaveBudgetItem = () => useWeddingMutation(saveBudgetItem)
/** Adds the typical-costs starter lines in one insert, in the given order. */
export const useAddBudgetItems = () =>
  useWeddingMutation(async (h, lines: { category: string; name: string; budget_minor: number; notes: string | null }[]) =>
    unwrap(await supabase.from('wedding_budget_items').insert(lines.map((l, i) => ({ ...l, sort_order: i, household_id: h })))),
  )
export const useDeleteBudgetItem = () => useWeddingMutation(async (_h, id: string) => unwrap(await supabase.from('wedding_budget_items').delete().eq('id', id)))
export const useSaveGuest = () => useWeddingMutation(saveGuest)
export const useDeleteGuest = () => useWeddingMutation(async (_h, id: string) => unwrap(await supabase.from('wedding_guests').delete().eq('id', id)))
export const useSaveWeddingTask = () => useWeddingMutation(saveTask)
/** Adds several tasks in one insert; the checklist orders them by due date. */
export const useAddWeddingTasks = () =>
  useWeddingMutation(async (h, tasks: { title: string; due_date: string | null }[]) =>
    unwrap(await supabase.from('wedding_tasks').insert(tasks.map((t) => ({ ...t, household_id: h })))),
  )
export const useDeleteWeddingTask = () => useWeddingMutation(async (_h, id: string) => unwrap(await supabase.from('wedding_tasks').delete().eq('id', id)))
export const useSaveSupplier = () => useWeddingMutation(saveSupplier)
export const useDeleteSupplier = () => useWeddingMutation(async (_h, id: string) => unwrap(await supabase.from('wedding_suppliers').delete().eq('id', id)))
