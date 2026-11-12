import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, type Tables } from '@/lib/supabase'
import { unwrap } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'

export type WantRow = Tables<'wants'>
export type WantFields = Pick<WantRow, 'owner_id' | 'name' | 'need_by' | 'note' | 'url'>

// Shared within the household by RLS; owner_id null = for both of you.
export const shoppingKeys = { all: ['shopping'] as const }

export const useWants = () =>
  useQuery({ queryKey: shoppingKeys.all, queryFn: async () => unwrap(await supabase.from('wants').select('*').order('created_at')) })

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
