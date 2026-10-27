import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, type Tables, type TablesInsert } from '@/lib/supabase'
import { unwrap } from '@/lib/utils'
import { financeKeys } from '@/modules/finances/api'
import { taskKeys } from '@/modules/tasks/api'
import { useHousehold } from '@/modules/household/HouseholdProvider'

export type WeddingSettings = Tables<'wedding_settings'>
export type BudgetItem = Tables<'wedding_budget_items'>
export type Guest = Tables<'wedding_guests'>
export type Supplier = Tables<'wedding_suppliers'>

export const weddingKeys = {
  all: ['wedding'] as const,
  settings: ['wedding', 'settings'] as const,
  budget: ['wedding', 'budget'] as const,
  guests: ['wedding', 'guests'] as const,
  suppliers: ['wedding', 'suppliers'] as const,
}

const fetchers = {
  settings: async () => unwrap(await supabase.from('wedding_settings').select('*').maybeSingle()) as WeddingSettings | null,
  budget: async () => unwrap(await supabase.from('wedding_budget_items').select('*').order('category').order('sort_order').order('created_at')),
  guests: async () => unwrap(await supabase.from('wedding_guests').select('*').order('party', { nullsFirst: false }).order('name')),
  suppliers: async () => unwrap(await supabase.from('wedding_suppliers').select('*').order('role').order('name')),
}

export const useWeddingSettings = () => useQuery({ queryKey: weddingKeys.settings, queryFn: fetchers.settings })
export const useBudgetItems = () => useQuery({ queryKey: weddingKeys.budget, queryFn: fetchers.budget })
export const useGuests = () => useQuery({ queryKey: weddingKeys.guests, queryFn: fetchers.guests })
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

type Row<T extends 'wedding_budget_items' | 'wedding_guests' | 'wedding_suppliers'> = Omit<TablesInsert<T>, 'household_id'> & { id?: string }

// Insert when there's no id, else update; household_id is only ever sent on insert (it isn't updatable).
async function saveBudgetItem(h: string, { id, ...fields }: Row<'wedding_budget_items'>) {
  if (id) unwrap(await supabase.from('wedding_budget_items').update(fields).eq('id', id))
  else unwrap(await supabase.from('wedding_budget_items').insert({ ...fields, household_id: h }))
}
async function saveGuest(h: string, { id, ...fields }: Row<'wedding_guests'>) {
  if (id) unwrap(await supabase.from('wedding_guests').update(fields).eq('id', id))
  else unwrap(await supabase.from('wedding_guests').insert({ ...fields, household_id: h }))
}
async function saveSupplier(h: string, { id, ...fields }: Row<'wedding_suppliers'>) {
  if (id) unwrap(await supabase.from('wedding_suppliers').update(fields).eq('id', id))
  else unwrap(await supabase.from('wedding_suppliers').insert({ ...fields, household_id: h }))
}

export const useSaveWeddingSettings = () =>
  useWeddingMutation(async (h, input: { wedding_date?: string | null; pot_goal_id?: string | null; task_category_id?: string | null }) => {
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
export const useSaveSupplier = () => useWeddingMutation(saveSupplier)
export const useDeleteSupplier = () => useWeddingMutation(async (_h, id: string) => unwrap(await supabase.from('wedding_suppliers').delete().eq('id', id)))

// -----------------------------------------------------------------------------
// Checklist: ordinary tasks in the Joint list with the wedding's task category,
// so they're on the Tasks page too. Keyed under ['tasks'] so task changes
// (here, on the Tasks page or from realtime) refresh it.
// -----------------------------------------------------------------------------
const checklistKey = [...taskKeys.all, 'wedding-checklist'] as const

export type ChecklistTask = Awaited<ReturnType<typeof fetchChecklist>>[number]

async function fetchChecklist(categoryId: string) {
  const rows = unwrap(
    await supabase
      .from('tasks')
      .select('id, title, due_date, assignee_id, status, completed_at, created_at, occurrences:task_occurrences(id, status, sequence)')
      .eq('category_id', categoryId)
      .is('archived_at', null)
      .order('status')
      .order('due_date', { nullsFirst: false })
      .order('created_at'),
  )
  return rows.map(({ occurrences, ...t }) => ({
    ...t,
    done: t.status === 'completed',
    openOccurrenceId: occurrences.find((o) => o.status === 'open')?.id ?? null,
    doneOccurrenceId: occurrences.filter((o) => o.status === 'done').toSorted((a, b) => b.sequence - a.sequence)[0]?.id ?? null,
  }))
}

export const useWeddingChecklist = (categoryId: string | null | undefined) =>
  useQuery({ queryKey: [...checklistKey, categoryId ?? null], queryFn: () => (categoryId ? fetchChecklist(categoryId) : Promise.resolve([])) })

function useChecklistMutation<TArgs>(fn: (householdId: string, args: TArgs) => Promise<unknown>) {
  const { household } = useHousehold()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: TArgs) => fn(household.id, args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: taskKeys.all })
      qc.invalidateQueries({ queryKey: weddingKeys.all })
    },
  })
}

/** The wedding's task category, creating "Wedding" (or adopting an existing one) the first time. */
async function ensureWeddingCategory(h: string): Promise<string> {
  const settings = unwrap(await supabase.from('wedding_settings').select('task_category_id').maybeSingle())
  if (settings?.task_category_id) return settings.task_category_id
  const existing = unwrap(await supabase.from('task_categories').select('id').eq('name', 'Wedding').limit(1))
  const id = existing[0]?.id ?? unwrap(await supabase.from('task_categories').insert({ household_id: h, name: 'Wedding', color: 'rose' }).select('id').single()).id
  if (settings) unwrap(await supabase.from('wedding_settings').update({ task_category_id: id }).eq('household_id', h))
  else unwrap(await supabase.from('wedding_settings').insert({ household_id: h, task_category_id: id }))
  return id
}

export const useAddChecklistTasks = () =>
  useChecklistMutation(async (h, tasks: { title: string; due_date: string | null }[]) => {
    const categoryId = await ensureWeddingCategory(h)
    const joint = unwrap(await supabase.from('task_lists').select('id').eq('kind', 'joint').single())
    unwrap(await supabase.from('tasks').insert(tasks.map((t) => ({ ...t, household_id: h, list_id: joint.id, category_id: categoryId }))))
  })

export const useUpdateChecklistTask = () =>
  useChecklistMutation(async (_h, a: { id: string; patch: { due_date?: string | null; assignee_id?: string | null } }) =>
    unwrap(await supabase.from('tasks').update(a.patch).eq('id', a.id)),
  )

/** Ticking goes through the task completion RPCs, like the Tasks page. */
export const useToggleChecklistTask = () =>
  useChecklistMutation(async (_h, t: ChecklistTask) => {
    if (!t.done && t.openOccurrenceId) unwrap(await supabase.rpc('complete_task_occurrence', { p_occurrence_id: t.openOccurrenceId }))
    else if (t.done && t.doneOccurrenceId) unwrap(await supabase.rpc('reopen_task_occurrence', { p_occurrence_id: t.doneOccurrenceId }))
  })

export const useDeleteChecklistTask = () =>
  useChecklistMutation(async (_h, id: string) => unwrap(await supabase.from('tasks').delete().eq('id', id)))
