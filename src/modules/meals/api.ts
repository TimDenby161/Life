import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, type Tables } from '@/lib/supabase'
import { unwrap } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { type Slot, type SlotPlan, weekDates } from '../../../supabase/functions/_shared/meals.ts'

export type MealRow = Tables<'meals'>
export type ShoppingItemRow = Tables<'shopping_items'>
export type RecipeRow = Tables<'recipes'>

// Shared within the household by RLS. person_id null = a meal for both of you.
export const mealsKeys = {
  all: ['meals'] as const,
  week: (weekStart: string) => ['meals', 'week', weekStart] as const,
  names: ['meals', 'names'] as const,
  items: (weekStart: string) => ['meals', 'items', weekStart] as const,
  run: (weekStart: string) => ['meals', 'run', weekStart] as const,
  recipes: ['meals', 'recipes'] as const,
}

export const useWeekMeals = (weekStart: string) =>
  useQuery({
    queryKey: mealsKeys.week(weekStart),
    queryFn: async () => {
      const days = weekDates(weekStart)
      return unwrap(await supabase.from('meals').select('*').gte('day', days[0]).lte('day', days[6]))
    },
  })

/** Meals typed before, newest first, to suggest while typing. */
export const useMealNames = () =>
  useQuery({
    queryKey: mealsKeys.names,
    queryFn: async () => {
      const rows = unwrap(await supabase.from('meals').select('name').order('created_at', { ascending: false }).limit(300))
      const seen = new Map<string, string>()
      for (const r of rows) if (!seen.has(r.name.toLowerCase())) seen.set(r.name.toLowerCase(), r.name)
      return [...seen.values()]
    },
    staleTime: 5 * 60_000,
  })

export const useShoppingItems = (weekStart: string) =>
  useQuery({
    queryKey: mealsKeys.items(weekStart),
    queryFn: async () =>
      unwrap(await supabase.from('shopping_items').select('*').eq('week_start', weekStart).order('position').order('created_at')),
  })

/** The meals the week's list was last built from (null when no list has been made). */
export const useListMealsKey = (weekStart: string) =>
  useQuery({
    queryKey: mealsKeys.run(weekStart),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shopping_list_runs')
        .select('meals_key')
        .eq('week_start', weekStart)
        .eq('kind', 'list')
        .eq('ok', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data?.meals_key ?? null
    },
  })

/** Every recipe the household has; one per meal name, so a meal planned again already has its recipe. */
export const useRecipes = () =>
  useQuery({ queryKey: mealsKeys.recipes, queryFn: async () => unwrap(await supabase.from('recipes').select('*').order('name')) })

function useMealsMutation<TArgs>(fn: (householdId: string, args: TArgs) => Promise<unknown>) {
  const { household } = useHousehold()
  const qc = useQueryClient()
  return useMutation({ mutationFn: (args: TArgs) => fn(household.id, args), onSuccess: () => qc.invalidateQueries({ queryKey: mealsKeys.all }) })
}

/** Sets the meal in a slot; an empty name clears it. `id` is the row already there, if any. */
export const useSaveMeal = () =>
  useMealsMutation(async (h, m: { id?: string; day: string; slot: Slot; person_id: string | null; name: string }) => {
    const name = m.name.replace(/\s+/g, ' ').trim()
    if (!name) return m.id ? unwrap(await supabase.from('meals').delete().eq('id', m.id)) : null
    return m.id
      ? unwrap(await supabase.from('meals').update({ name }).eq('id', m.id))
      : unwrap(await supabase.from('meals').insert({ household_id: h, day: m.day, slot: m.slot, person_id: m.person_id, name }))
  })

/** One meal each: the shared meal (if there is one) becomes each person's own. */
export const useSplitSlot = () =>
  useMealsMutation(async (h, { plan, people }: { plan: SlotPlan; people: string[] }) => {
    if (!plan.shared) return
    const rows = people.map((person_id) => ({ household_id: h, day: plan.day, slot: plan.slot, person_id, name: plan.shared!.name }))
    unwrap(await supabase.from('meals').insert(rows))
    unwrap(await supabase.from('meals').delete().eq('id', plan.shared.id))
  })

/** Back to one meal for both: keeps `keep`'s meal (yours, when you both had one). */
export const useMergeSlot = () =>
  useMealsMutation(async (h, { plan, keep }: { plan: SlotPlan; keep: string }) => {
    const name = (plan.personal.find((r) => r.person_id === keep) ?? plan.personal[0])?.name
    if (plan.shared) unwrap(await supabase.from('meals').delete().eq('id', plan.shared.id))
    if (plan.personal.length) unwrap(await supabase.from('meals').delete().in('id', plan.personal.map((r) => r.id)))
    if (name) unwrap(await supabase.from('meals').insert({ household_id: h, day: plan.day, slot: plan.slot, person_id: null, name }))
  })

/** Ticks straight away, then saves; puts the tick back if the save fails. */
export function useToggleItem(weekStart: string) {
  const qc = useQueryClient()
  const key = mealsKeys.items(weekStart)
  return useMutation({
    mutationFn: async ({ id, checked }: { id: string; checked: boolean }) => unwrap(await supabase.from('shopping_items').update({ checked }).eq('id', id)),
    onMutate: async ({ id, checked }) => {
      await qc.cancelQueries({ queryKey: key })
      const before = qc.getQueryData<ShoppingItemRow[]>(key)
      qc.setQueryData<ShoppingItemRow[]>(key, (rows) => rows?.map((r) => (r.id === id ? { ...r, checked } : r)))
      return { before }
    },
    onError: (_e, _v, ctx) => qc.setQueryData(key, ctx?.before),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })
}

export const useAddItem = () =>
  useMealsMutation(async (h, { weekStart, name }: { weekStart: string; name: string }) =>
    unwrap(await supabase.from('shopping_items').insert({ household_id: h, week_start: weekStart, name: name.replace(/\s+/g, ' ').trim() })),
  )

export const useDeleteItem = () => useMealsMutation(async (_h, id: string) => unwrap(await supabase.from('shopping_items').delete().eq('id', id)))

export type MakeListResult =
  | { status: 'ok'; count: number }
  | { status: 'not_configured' | 'no_meals' | 'over_budget' | 'error'; message: string }

/** Asks the shopping-list Edge Function to write the week's list; the API key never reaches the browser. */
export function useMakeShoppingList() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (weekStart: string): Promise<MakeListResult> => {
      const { data, error } = await supabase.functions.invoke<MakeListResult>('shopping-list', { body: { weekStart } })
      if (error) {
        // Non-2xx responses still carry our JSON body.
        const body = await (error as { context?: Response }).context?.json?.().catch(() => null)
        if (body?.status) return body as MakeListResult
        return { status: 'error', message: 'The shopping list service could not be reached.' }
      }
      return data ?? { status: 'error', message: 'Empty response' }
    },
    // A failed call can still have been recorded, so refresh either way.
    onSettled: () => qc.invalidateQueries({ queryKey: mealsKeys.all }),
  })
}

export type WriteRecipesResult =
  | { status: 'ok'; written: number; remaining: number }
  | { status: 'not_configured' | 'no_meals' | 'over_budget' | 'error'; message: string }

/**
 * Asks the same function for recipes for the week's meals that have none, and
 * with `fresh` (from Plan meals) rewrites those on the planned days too. It
 * writes a few per call, so this keeps asking until none are left or a call
 * makes no progress; recipes appear on the page as each batch lands.
 */
export function useWriteRecipes() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ weekStart, fresh }: { weekStart: string; fresh?: { from: string; days: number; since: string } }): Promise<WriteRecipesResult> => {
      let written = 0
      for (let call = 0; call < 8; call++) {
        const { data, error } = await supabase.functions.invoke<WriteRecipesResult>('shopping-list', { body: { weekStart, mode: 'recipes', fresh } })
        let result: WriteRecipesResult = data ?? { status: 'error', message: 'Empty response' }
        if (error) {
          const body = await (error as { context?: Response }).context?.json?.().catch(() => null)
          result = body?.status ? (body as WriteRecipesResult) : { status: 'error', message: 'The recipe service could not be reached.' }
        }
        if (result.status !== 'ok') return result
        written += result.written
        await qc.invalidateQueries({ queryKey: mealsKeys.recipes })
        if (!result.remaining || !result.written) return { status: 'ok', written, remaining: result.remaining }
      }
      return { status: 'ok', written, remaining: 1 }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: mealsKeys.all }),
  })
}

// Planning: who is in for each meal, what you want for it, and what you have in ---------

export type PantryRow = Tables<'meal_pantry'>
export type AvailabilityRow = Tables<'meal_availability'>
export type SlotNoteRow = Tables<'meal_slot_notes'>
export type PlanSlot = 'lunch' | 'dinner'

const planKeys = {
  pantry: ['meals', 'pantry'] as const,
  days: (from: string, to: string) => ['meals', 'plan', from, to] as const,
}

/** Ingredients you already have, shared: the plan, new recipes and the shopping list use them. */
export const usePantry = () =>
  useQuery({ queryKey: planKeys.pantry, queryFn: async () => unwrap(await supabase.from('meal_pantry').select('*').order('created_at')) })

/** Availability and notes for the days from `from` to `to`. No availability row = in. */
export const usePlanDays = (from: string, to: string) =>
  useQuery({
    queryKey: planKeys.days(from, to),
    queryFn: async () => {
      const [availability, notes] = await Promise.all([
        supabase.from('meal_availability').select('*').gte('day', from).lte('day', to),
        supabase.from('meal_slot_notes').select('*').gte('day', from).lte('day', to),
      ])
      return { availability: unwrap(availability), notes: unwrap(notes) }
    },
    // Adding a day keeps the days already shown on screen while the new one loads.
    placeholderData: keepPreviousData,
  })

export const useAddPantry = () =>
  useMealsMutation(async (h, name: string) => unwrap(await supabase.from('meal_pantry').insert({ household_id: h, name: name.replace(/\s+/g, ' ').trim() })))

export const useDeletePantry = () => useMealsMutation(async (_h, id: string) => unwrap(await supabase.from('meal_pantry').delete().eq('id', id)))

/** In or out for a meal. `exists` = there is a row already (from the calendar or set before). */
export const useSetAvailable = () =>
  useMealsMutation(async (h, a: { day: string; slot: PlanSlot; person_id: string; available: boolean; exists: boolean }) =>
    a.exists
      ? unwrap(
          await supabase
            .from('meal_availability')
            .update({ available: a.available })
            .eq('household_id', h)
            .eq('day', a.day)
            .eq('slot', a.slot)
            .eq('person_id', a.person_id),
        )
      : unwrap(await supabase.from('meal_availability').insert({ household_id: h, day: a.day, slot: a.slot, person_id: a.person_id, available: a.available })),
  )

/** What you want for a meal; empty clears it. */
export const useSaveSlotNote = () =>
  useMealsMutation(async (h, n: { day: string; slot: PlanSlot; note: string; exists: boolean }) => {
    const note = n.note.replace(/\s+/g, ' ').trim()
    const row = () => supabase.from('meal_slot_notes')
    if (!note) return n.exists ? unwrap(await row().delete().eq('household_id', h).eq('day', n.day).eq('slot', n.slot)) : null
    return n.exists
      ? unwrap(await row().update({ note }).eq('household_id', h).eq('day', n.day).eq('slot', n.slot))
      : unwrap(await row().insert({ household_id: h, day: n.day, slot: n.slot, note }))
  })

export type PlanMealsResult =
  | { status: 'ok'; placed: number; weeks: string[]; at: string }
  | { status: 'not_configured' | 'over_budget' | 'error'; message: string }

/** Asks Claude to fill the empty lunches and dinners over `days` days from the plan; `from` is today. */
export function usePlanMeals() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ from, days }: { from: string; days: number }): Promise<PlanMealsResult> => {
      const { data, error } = await supabase.functions.invoke<PlanMealsResult>('shopping-list', { body: { mode: 'plan', from, days } })
      if (error) {
        const body = await (error as { context?: Response }).context?.json?.().catch(() => null)
        if (body?.status) return body as PlanMealsResult
        return { status: 'error', message: 'The meal planner could not be reached.' }
      }
      return data ?? { status: 'error', message: 'Empty response' }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: mealsKeys.all }),
  })
}
