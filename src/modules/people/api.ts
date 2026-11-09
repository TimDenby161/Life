import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, type Tables } from '@/lib/supabase'
import { unwrap } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'

export type PersonRow = Tables<'people'>
export type PersonFields = Pick<PersonRow, 'owner_id' | 'name' | 'birthday_month' | 'birthday_day' | 'see_every_weeks' | 'last_seen_on'>

// Shared within the household by RLS; owner_id null = joint friends.
export const peopleKeys = { all: ['people'] as const }

export const usePeople = () =>
  useQuery({ queryKey: peopleKeys.all, queryFn: async () => unwrap(await supabase.from('people').select('*').order('name')) })

function usePeopleMutation<TArgs>(fn: (householdId: string, args: TArgs) => Promise<unknown>) {
  const { household } = useHousehold()
  const qc = useQueryClient()
  return useMutation({ mutationFn: (args: TArgs) => fn(household.id, args), onSuccess: () => qc.invalidateQueries({ queryKey: peopleKeys.all }) })
}

/** Adds a person, or changes one when `id` is given. */
export const useSavePerson = () =>
  usePeopleMutation(async (h, { id, ...fields }: Partial<PersonFields> & { id?: string }) =>
    id
      ? unwrap(await supabase.from('people').update(fields).eq('id', id))
      : unwrap(await supabase.from('people').insert({ name: '', ...fields, household_id: h })),
  )

export const useDeletePerson = () => usePeopleMutation(async (_h, id: string) => unwrap(await supabase.from('people').delete().eq('id', id)))
