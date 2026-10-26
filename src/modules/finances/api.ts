import { supabase, type Tables, type TablesInsert, type TablesUpdate } from '@/lib/supabase'
import { fetchAllPages, unwrap } from '@/lib/utils'
import type { SheetSyncResult, SyncRow } from '../../../supabase/functions/finance-sheet-sync/types.ts'
import type { AccountSuggestion, LinkPlan } from './lib/sheetLink'

export type { SheetSyncResult, SyncRow }

export type Account = Tables<'financial_accounts'>
export type FinanceCategory = Tables<'finance_categories'>
export type Transaction = Tables<'financial_transactions'>
export type BalanceSnapshot = Tables<'account_balance_history'>
export type Budget = Tables<'budgets'>
export type SavingsGoal = Tables<'savings_goals'>
export type SheetSource = Tables<'finance_sheet_sources'>

export const ACCOUNT_TYPES = [
  { value: 'current', label: 'Current account' },
  { value: 'savings', label: 'Savings' },
  { value: 'credit_card', label: 'Credit card' },
  { value: 'loan', label: 'Loan' },
  { value: 'mortgage', label: 'Mortgage' },
  { value: 'investment', label: 'Investments' },
  { value: 'pension', label: 'Pension' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' },
] as const

export const LIABILITY_TYPES = new Set(['credit_card', 'loan', 'mortgage'])

export const financeKeys = {
  all: ['finances'] as const,
  accounts: ['finances', 'accounts'] as const,
  balances: ['finances', 'balances'] as const,
  categories: ['finances', 'categories'] as const,
  transactions: ['finances', 'transactions'] as const,
  snapshots: ['finances', 'snapshots'] as const,
  budgets: ['finances', 'budgets'] as const,
  goals: ['finances', 'goals'] as const,
  sheetSource: ['finances', 'sheet-source'] as const,
  sheetLinks: ['finances', 'sheet-links'] as const,
}

export async function fetchAccounts() {
  return unwrap(await supabase.from('financial_accounts').select('*').order('sort_order').order('name'))
}

export async function fetchBalances() {
  const rows = unwrap(await supabase.from('financial_account_balances').select('*'))
  return new Map(rows.map((r) => [r.account_id!, r.balance_minor ?? 0]))
}

export async function fetchFinanceCategories() {
  return unwrap(await supabase.from('finance_categories').select('*').order('name'))
}

/** All transactions (household scale: thousands, not millions). */
export async function fetchTransactions() {
  return fetchAllPages<Transaction>((from, to) =>
    supabase.from('financial_transactions').select('*').order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).range(from, to),
  )
}

export async function fetchSnapshots() {
  return unwrap(await supabase.from('account_balance_history').select('*').order('as_of'))
}

export async function fetchBudgets() {
  return unwrap(await supabase.from('budgets').select('*').order('starts_month'))
}

export async function fetchGoals() {
  return unwrap(await supabase.from('savings_goals').select('*').is('archived_at', null).order('created_at'))
}

type WithoutHousehold<T> = Omit<T, 'household_id'>

export async function createAccount(householdId: string, input: WithoutHousehold<TablesInsert<'financial_accounts'>>) {
  return unwrap(await supabase.from('financial_accounts').insert({ ...input, household_id: householdId }).select('*').single())
}
export async function updateAccount(id: string, patch: TablesUpdate<'financial_accounts'>) {
  unwrap(await supabase.from('financial_accounts').update(patch).eq('id', id))
}
export async function deleteAccount(id: string) {
  unwrap(await supabase.from('financial_accounts').delete().eq('id', id))
}

export async function createTransaction(householdId: string, input: WithoutHousehold<TablesInsert<'financial_transactions'>>) {
  unwrap(await supabase.from('financial_transactions').insert({ ...input, household_id: householdId }))
}
export async function updateTransaction(id: string, patch: TablesUpdate<'financial_transactions'>) {
  unwrap(await supabase.from('financial_transactions').update(patch).eq('id', id))
}
export async function deleteTransaction(tx: Pick<Transaction, 'id' | 'transfer_id'>) {
  // Deleting one leg of a transfer deletes both (they only exist as a pair).
  const q = supabase.from('financial_transactions').delete()
  unwrap(await (tx.transfer_id ? q.eq('transfer_id', tx.transfer_id) : q.eq('id', tx.id)))
}

export async function createTransfer(args: {
  fromAccountId: string
  toAccountId: string
  amountMinor: number
  toAmountMinor?: number
  occurredOn: string
  description: string
  notes?: string
}) {
  return unwrap(
    await supabase.rpc('create_transfer', {
      p_from_account_id: args.fromAccountId,
      p_to_account_id: args.toAccountId,
      p_amount_minor: args.amountMinor,
      p_to_amount_minor: args.toAmountMinor,
      p_occurred_on: args.occurredOn,
      p_description: args.description,
      p_notes: args.notes,
    }),
  )
}

export async function recordBalance(householdId: string, accountId: string, asOf: string, balanceMinor: number, note?: string) {
  unwrap(
    await supabase
      .from('account_balance_history')
      .upsert({ household_id: householdId, account_id: accountId, as_of: asOf, balance_minor: balanceMinor, note: note || null }, { onConflict: 'account_id,as_of' }),
  )
}
export async function deleteSnapshot(id: string) {
  unwrap(await supabase.from('account_balance_history').delete().eq('id', id))
}

export async function saveBudget(householdId: string, input: { id?: string; category_id: string; amount_minor: number; starts_month: string; ends_month?: string | null }) {
  if (input.id) {
    unwrap(await supabase.from('budgets').update({ amount_minor: input.amount_minor, starts_month: input.starts_month, ends_month: input.ends_month ?? null }).eq('id', input.id))
  } else {
    unwrap(await supabase.from('budgets').insert({ household_id: householdId, category_id: input.category_id, amount_minor: input.amount_minor, starts_month: input.starts_month, ends_month: input.ends_month ?? null }))
  }
}
export async function deleteBudget(id: string) {
  unwrap(await supabase.from('budgets').delete().eq('id', id))
}

export async function saveGoal(householdId: string, input: WithoutHousehold<TablesInsert<'savings_goals'>> & { id?: string }) {
  const { id, ...rest } = input
  if (id) unwrap(await supabase.from('savings_goals').update(rest).eq('id', id))
  else unwrap(await supabase.from('savings_goals').insert({ ...rest, household_id: householdId }))
}
export async function archiveGoal(id: string) {
  unwrap(await supabase.from('savings_goals').update({ archived_at: new Date().toISOString() }).eq('id', id))
}

export async function createFinanceCategory(householdId: string, name: string, kind: 'income' | 'expense') {
  return unwrap(await supabase.from('finance_categories').insert({ household_id: householdId, name, kind }).select('*').single())
}

// -----------------------------------------------------------------------------
// Google Sheet sync (finance-sheet-sync Edge Function; credentials stay server-side).
// -----------------------------------------------------------------------------
/** Accepts a full Google Sheets link or a bare spreadsheet ID. */
export function spreadsheetIdFrom(input: string): string | null {
  const id = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(input)?.[1] ?? input.trim()
  return /^[A-Za-z0-9_-]{20,100}$/.test(id) ? id : null
}

export async function fetchSheetSource() {
  return unwrap(await supabase.from('finance_sheet_sources').select('*').maybeSingle()) as SheetSource | null
}

// Insert then update (not upsert): household_id is deliberately not an updatable column.
export async function saveSheetSource(householdId: string, input: { id?: string; spreadsheet_id: string; sheet_name: string }) {
  const { id, ...fields } = input
  if (id) unwrap(await supabase.from('finance_sheet_sources').update(fields).eq('id', id))
  else unwrap(await supabase.from('finance_sheet_sources').insert({ household_id: householdId, ...fields }))
}
export async function deleteSheetSource(id: string) {
  unwrap(await supabase.from('finance_sheet_sources').delete().eq('id', id))
}

export async function syncSheet(): Promise<SheetSyncResult> {
  const { data, error } = await supabase.functions.invoke<SheetSyncResult>('finance-sheet-sync', { body: {} })
  if (error) {
    // Non-2xx responses still carry our JSON body.
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null)
    if (body?.status) return body as SheetSyncResult
    return { status: 'error', message: 'The sheet sync service could not be reached.' }
  }
  return data ?? { status: 'error', message: 'Empty response' }
}

export async function fetchSheetLinks() {
  return unwrap(await supabase.from('finance_sheet_links').select('row_key, account_id'))
}

/**
 * Saves the link dialog: creates the new accounts, replaces every listed row's
 * link in one call, archives accounts left without rows (their last balance
 * would otherwise keep counting), and remembers which rows were skipped.
 * Returns the number of accounts archived.
 */
export async function applySheetLinks(
  householdId: string,
  args: { sourceId: string; rowKeys: string[]; plan: LinkPlan; newAccounts: Record<string, AccountSuggestion>; openingDate: string },
) {
  const created = new Map<string, string>()
  for (const key of args.plan.creates) {
    const account = await createAccount(householdId, { ...args.newAccounts[key], opening_date: args.openingDate, opening_balance_minor: 0 })
    created.set(key, account.id)
  }
  const links = args.rowKeys.map((row_key) => {
    const t = args.plan.targets.get(row_key)
    return { row_key, account_id: !t ? null : 'accountId' in t ? t.accountId : created.get(t.newFrom)! }
  })
  unwrap(await supabase.rpc('replace_sheet_links', { p_household_id: householdId, p_links: links }))
  if (args.plan.orphaned.length) {
    unwrap(await supabase.from('financial_accounts').update({ archived_at: new Date().toISOString() }).in('id', args.plan.orphaned))
  }
  const skipped = links.filter((l) => !l.account_id).map((l) => l.row_key)
  unwrap(await supabase.from('finance_sheet_sources').update({ skipped_row_keys: skipped }).eq('id', args.sourceId))
  return args.plan.orphaned.length
}
