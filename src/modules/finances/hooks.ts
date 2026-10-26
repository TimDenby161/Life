import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import * as api from './api'
import { financeKeys } from './api'

export const useAccounts = () => useQuery({ queryKey: financeKeys.accounts, queryFn: api.fetchAccounts })
export const useBalances = () => useQuery({ queryKey: financeKeys.balances, queryFn: api.fetchBalances })
export const useFinanceCategories = () => useQuery({ queryKey: financeKeys.categories, queryFn: api.fetchFinanceCategories, staleTime: 5 * 60_000 })
export const useTransactions = () => useQuery({ queryKey: financeKeys.transactions, queryFn: api.fetchTransactions })
export const useSnapshots = () => useQuery({ queryKey: financeKeys.snapshots, queryFn: api.fetchSnapshots })
export const useBudgets = () => useQuery({ queryKey: financeKeys.budgets, queryFn: api.fetchBudgets })
export const useGoals = () => useQuery({ queryKey: financeKeys.goals, queryFn: api.fetchGoals })
export const useSheetSource = () => useQuery({ queryKey: financeKeys.sheetSource, queryFn: api.fetchSheetSource })
export const useSheetLinks = () => useQuery({ queryKey: financeKeys.sheetLinks, queryFn: api.fetchSheetLinks })

export function useAccountCurrency() {
  const accounts = useAccounts().data
  return useMemo(() => new Map((accounts ?? []).map((a) => [a.id, a.currency])), [accounts])
}

/** Every finance mutation invalidates the whole module: balances depend on everything. */
function useFinanceMutation<TArgs, TResult>(fn: (householdId: string, args: TArgs) => Promise<TResult>) {
  const { household } = useHousehold()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: TArgs) => fn(household.id, args),
    onSuccess: () => qc.invalidateQueries({ queryKey: financeKeys.all }),
  })
}

export const useCreateAccount = () => useFinanceMutation((h, input: Parameters<typeof api.createAccount>[1]) => api.createAccount(h, input))
export const useUpdateAccount = () => useFinanceMutation((_h, a: { id: string; patch: Parameters<typeof api.updateAccount>[1] }) => api.updateAccount(a.id, a.patch))
export const useDeleteAccount = () => useFinanceMutation((_h, id: string) => api.deleteAccount(id))
export const useCreateTransaction = () => useFinanceMutation((h, input: Parameters<typeof api.createTransaction>[1]) => api.createTransaction(h, input))
export const useUpdateTransaction = () => useFinanceMutation((_h, a: { id: string; patch: Parameters<typeof api.updateTransaction>[1] }) => api.updateTransaction(a.id, a.patch))
export const useDeleteTransaction = () => useFinanceMutation((_h, tx: Parameters<typeof api.deleteTransaction>[0]) => api.deleteTransaction(tx))
export const useCreateTransfer = () => useFinanceMutation((_h, args: Parameters<typeof api.createTransfer>[0]) => api.createTransfer(args))
export const useRecordBalance = () =>
  useFinanceMutation((h, a: { accountId: string; asOf: string; balanceMinor: number; note?: string }) => api.recordBalance(h, a.accountId, a.asOf, a.balanceMinor, a.note))
export const useDeleteSnapshot = () => useFinanceMutation((_h, id: string) => api.deleteSnapshot(id))
export const useSaveBudget = () => useFinanceMutation((h, input: Parameters<typeof api.saveBudget>[1]) => api.saveBudget(h, input))
export const useDeleteBudget = () => useFinanceMutation((_h, id: string) => api.deleteBudget(id))
export const useSaveGoal = () => useFinanceMutation((h, input: Parameters<typeof api.saveGoal>[1]) => api.saveGoal(h, input))
export const useArchiveGoal = () => useFinanceMutation((_h, id: string) => api.archiveGoal(id))
export const useSaveSheetSource = () => useFinanceMutation((h, input: Parameters<typeof api.saveSheetSource>[1]) => api.saveSheetSource(h, input))
export const useDeleteSheetSource = () => useFinanceMutation((_h, id: string) => api.deleteSheetSource(id))
/** Runs a sync; the result (rows to link) lives on the mutation, never in a refetching query. */
export const useSyncSheet = () => useFinanceMutation(() => api.syncSheet())
export const useApplySheetLinks = () =>
  useFinanceMutation(async (h, args: Parameters<typeof api.applySheetLinks>[1]) => {
    const archived = await api.applySheetLinks(h, args)
    return { archived, result: await api.syncSheet() }
  })
