import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, type Tables } from '@/lib/supabase'
import { unwrap } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'

export type GoalRow = Tables<'life_goals'>
export type GoalFields = Pick<GoalRow, 'owner_id' | 'area' | 'goal'>

// Shared within the household by RLS; owner_id null = together. The morning routine plans each area's tasks from these.
export const goalKeys = { all: ['goals'] as const }

export const useGoals = () =>
  useQuery({ queryKey: goalKeys.all, queryFn: async () => unwrap(await supabase.from('life_goals').select('*').order('sort_order').order('created_at')) })

function useGoalMutation<TArgs>(fn: (householdId: string, args: TArgs) => Promise<unknown>) {
  const { household } = useHousehold()
  const qc = useQueryClient()
  return useMutation({ mutationFn: (args: TArgs) => fn(household.id, args), onSuccess: () => qc.invalidateQueries({ queryKey: goalKeys.all }) })
}

/** Adds a goal (at the end of its area), or changes one when `id` is given. */
export const useSaveGoal = () =>
  useGoalMutation(async (h, { id, sort_order, ...fields }: GoalFields & { id?: string; sort_order?: number }) =>
    id
      ? unwrap(await supabase.from('life_goals').update(fields).eq('id', id))
      : unwrap(await supabase.from('life_goals').insert({ ...fields, sort_order: sort_order ?? 0, household_id: h })),
  )

export const useDeleteGoal = () => useGoalMutation(async (_h, id: string) => unwrap(await supabase.from('life_goals').delete().eq('id', id)))
