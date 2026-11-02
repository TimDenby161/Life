import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, type Tables, type TablesInsert } from '@/lib/supabase'
import { unwrap } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'

export type Holding = Tables<'investment_holdings'>
export type InvestmentSettings = Tables<'investment_settings'>

export const investmentKeys = {
  all: ['investments'] as const,
  holdings: ['investments', 'holdings'] as const,
  settings: ['investments', 'settings'] as const,
}

export const useHoldings = () =>
  useQuery({
    queryKey: investmentKeys.holdings,
    queryFn: async () => unwrap(await supabase.from('investment_holdings').select('*').order('value_minor', { ascending: false })),
  })
export const useInvestmentSettings = () =>
  useQuery({ queryKey: investmentKeys.settings, queryFn: async () => unwrap(await supabase.from('investment_settings').select('*')) })

function useInvestmentMutation<TArgs>(fn: (householdId: string, args: TArgs) => Promise<unknown>) {
  const { household } = useHousehold()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: TArgs) => fn(household.id, args),
    onSuccess: () => qc.invalidateQueries({ queryKey: investmentKeys.all }),
  })
}

type HoldingInput = Omit<TablesInsert<'investment_holdings'>, 'household_id' | 'user_id'> & { id?: string }

export const useSaveHolding = () =>
  useInvestmentMutation(async (h, { id, ...fields }: HoldingInput) => {
    if (id) unwrap(await supabase.from('investment_holdings').update(fields).eq('id', id))
    else unwrap(await supabase.from('investment_holdings').insert({ ...fields, household_id: h }))
  })
export const useDeleteHolding = () =>
  useInvestmentMutation(async (_h, id: string) => unwrap(await supabase.from('investment_holdings').delete().eq('id', id)))

/** Settings are one row per person; the row is created on first save. */
export const useSaveInvestmentSettings = () =>
  useInvestmentMutation(async (h, input: { userId: string; monthly_minor: number; wedding_minor: number | null; values_as_of: string | null }) => {
    const { userId, ...fields } = input
    const existing = unwrap(await supabase.from('investment_settings').select('user_id').eq('user_id', userId).maybeSingle())
    if (existing) unwrap(await supabase.from('investment_settings').update(fields).eq('user_id', userId))
    else unwrap(await supabase.from('investment_settings').insert({ ...fields, household_id: h }))
  })
