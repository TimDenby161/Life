// Pure finance calculations. All amounts are integer minor units.
//
// * Balance at date D mirrors public.account_balance_on: the latest recorded
//   balance on/before D plus later transactions, else the opening balance
//   plus all transactions from the opening date.
// * Transfers (kind = 'transfer') and adjustments never count as income or
//   spending.
// * Spending is the negated sum of expense transactions, so refunds (positive
//   expense amounts) reduce it.
import { endOfMonth, format, parseISO, subMonths } from 'date-fns'
import { type ISODate, toISODate } from '@/lib/dates'

export type AccountLike = {
  id: string
  name: string
  currency: string
  ownership: string
  owner_id: string | null
  opening_balance_minor: number
  opening_date: string
  is_liability: boolean | null
  include_in_net_worth: boolean
  archived_at: string | null
  account_type: string
}

export type TxLike = {
  id: string
  account_id: string
  occurred_on: string
  amount_minor: number
  kind: string
  category_id: string | null
  created_at: string
}

export type SnapshotLike = { account_id: string; as_of: string; balance_minor: number; created_at: string }

export type BalancePoint = { date: ISODate; balance: number; recorded: boolean }

export function balanceOn(
  account: AccountLike,
  snapshots: readonly SnapshotLike[],
  transactions: readonly TxLike[],
  date: ISODate,
): number | null {
  if (date < account.opening_date && !snapshots.some((s) => s.account_id === account.id && s.as_of <= date)) return null
  let snap: SnapshotLike | undefined
  for (const s of snapshots) {
    if (s.account_id === account.id && s.as_of <= date && (!snap || s.as_of > snap.as_of)) snap = s
  }
  let total = snap ? snap.balance_minor : account.opening_balance_minor
  for (const t of transactions) {
    if (t.account_id !== account.id || t.occurred_on > date) continue
    if (snap) {
      if (t.occurred_on > snap.as_of || (t.occurred_on === snap.as_of && t.created_at > snap.created_at)) total += t.amount_minor
    } else if (t.occurred_on >= account.opening_date) {
      total += t.amount_minor
    }
  }
  return total
}

/** Month-end balances for the last `months` months plus today, flagged recorded/calculated. */
export function balanceSeries(
  account: AccountLike,
  snapshots: readonly SnapshotLike[],
  transactions: readonly TxLike[],
  months: number,
  today: ISODate,
): BalancePoint[] {
  const points: BalancePoint[] = []
  const own = snapshots.filter((s) => s.account_id === account.id)
  for (let i = months - 1; i >= 1; i--) {
    const date = toISODate(endOfMonth(subMonths(parseISO(today), i)))
    const balance = balanceOn(account, own, transactions, date)
    if (balance !== null) points.push({ date, balance, recorded: own.some((s) => s.as_of === date) })
  }
  const now = balanceOn(account, own, transactions, today)
  if (now !== null) points.push({ date: today, balance: now, recorded: own.some((s) => s.as_of === today) })
  // Recorded values between month ends are real data points too.
  for (const s of own) {
    if (!points.some((p) => p.date === s.as_of) && s.as_of >= (points[0]?.date ?? today) && s.as_of <= today) {
      points.push({ date: s.as_of, balance: s.balance_minor, recorded: true })
    }
  }
  return points.sort((a, b) => a.date.localeCompare(b.date))
}

/** Net worth breakdown rows, in display order: what you have, then what you owe. */
export const NET_WORTH_GROUPS = [
  { key: 'cash', label: 'Current accounts & cash', types: ['current', 'cash'] },
  { key: 'savings', label: 'Savings', types: ['savings'] },
  { key: 'investments', label: 'Investments', types: ['investment'] },
  { key: 'pensions', label: 'Pensions', types: ['pension'] },
  { key: 'property', label: 'Property', types: ['property'] },
  { key: 'vehicles', label: 'Vehicles', types: ['vehicle'] },
  { key: 'other', label: 'Other', types: ['other'] },
  { key: 'cards', label: 'Credit cards', types: ['credit_card'] },
  { key: 'mortgage', label: 'Mortgage', types: ['mortgage'] },
  { key: 'loans', label: 'Loans', types: ['loan'] },
] as const

export type NetWorthGroup = (typeof NET_WORTH_GROUPS)[number]['key']

export const groupOf = (type: string): NetWorthGroup => NET_WORTH_GROUPS.find((g) => (g.types as readonly string[]).includes(type))?.key ?? 'other'

export type NetWorth = {
  currency: string
  total: number
  assets: number
  liabilities: number
  byOwner: Record<string, number> // 'joint' | userId
  /** Totals per breakdown group, overall ('all') and per owner ('joint' | userId). */
  byGroup: Record<string, Partial<Record<NetWorthGroup, number>>>
}

/** Net worth per currency (no FX conversion is attempted). */
export function netWorth(
  accounts: readonly AccountLike[],
  balances: ReadonlyMap<string, number>,
): NetWorth[] {
  const out = new Map<string, NetWorth>()
  for (const a of accounts) {
    if (a.archived_at || !a.include_in_net_worth) continue
    const b = balances.get(a.id) ?? 0
    const nw = out.get(a.currency) ?? { currency: a.currency, total: 0, assets: 0, liabilities: 0, byOwner: {}, byGroup: {} }
    nw.total += b
    if (b >= 0) nw.assets += b
    else nw.liabilities += b
    const owner = a.ownership === 'joint' ? 'joint' : (a.owner_id ?? 'joint')
    nw.byOwner[owner] = (nw.byOwner[owner] ?? 0) + b
    const group = groupOf(a.account_type)
    for (const key of ['all', owner]) {
      const g = (nw.byGroup[key] ??= {})
      g[group] = (g[group] ?? 0) + b
    }
    out.set(a.currency, nw)
  }
  return [...out.values()].sort((x, y) => (x.currency === 'GBP' ? -1 : y.currency === 'GBP' ? 1 : x.currency.localeCompare(y.currency)))
}

export type MonthFlow = { month: string; label: string; income: number; spending: number; net: number }

/** Income and spending per calendar month, in one currency. */
export function monthlyFlows(
  transactions: readonly TxLike[],
  accountCurrency: ReadonlyMap<string, string>,
  currency: string,
  months: number,
  today: ISODate,
): MonthFlow[] {
  const rows: MonthFlow[] = []
  const index = new Map<string, MonthFlow>()
  for (let i = months - 1; i >= 0; i--) {
    const d = subMonths(parseISO(today), i)
    const key = format(d, 'yyyy-MM')
    const row = { month: key, label: format(d, 'MMM'), income: 0, spending: 0, net: 0 }
    rows.push(row)
    index.set(key, row)
  }
  for (const t of transactions) {
    if (accountCurrency.get(t.account_id) !== currency) continue
    const row = index.get(t.occurred_on.slice(0, 7))
    if (!row) continue
    if (t.kind === 'income') row.income += t.amount_minor
    else if (t.kind === 'expense') row.spending -= t.amount_minor
  }
  for (const r of rows) r.net = r.income - r.spending
  return rows
}

/** Spending per category for transactions in [from, to]. */
export function spendingByCategory(
  transactions: readonly TxLike[],
  accountCurrency: ReadonlyMap<string, string>,
  currency: string,
  from: ISODate,
  to: ISODate,
): Map<string, number> {
  const out = new Map<string, number>()
  for (const t of transactions) {
    if (t.kind !== 'expense' || t.occurred_on < from || t.occurred_on > to) continue
    if (accountCurrency.get(t.account_id) !== currency) continue
    const key = t.category_id ?? 'none'
    out.set(key, (out.get(key) ?? 0) - t.amount_minor)
  }
  return out
}

export type BudgetLike = { id: string; category_id: string; amount_minor: number; currency: string; starts_month: string; ends_month: string | null }

/** The budget row in force for each category in a given month ("YYYY-MM-01"). */
export function activeBudgets<T extends BudgetLike>(budgets: readonly T[], month: ISODate): T[] {
  const best = new Map<string, T>()
  for (const b of budgets) {
    if (b.starts_month > month || (b.ends_month && b.ends_month < month)) continue
    const cur = best.get(b.category_id)
    if (!cur || b.starts_month > cur.starts_month) best.set(b.category_id, b)
  }
  return [...best.values()]
}

export type GoalLike = { target_minor: number; account_id: string | null; manual_saved_minor: number }

export function goalProgress(goal: GoalLike, balances: ReadonlyMap<string, number>): { saved: number; pct: number } {
  const saved = goal.account_id ? Math.max(0, balances.get(goal.account_id) ?? 0) : goal.manual_saved_minor
  return { saved, pct: Math.min(100, Math.round((saved / goal.target_minor) * 100)) }
}

export type NetWorthPoint = { date: ISODate; value: number | null }

/**
 * Dates for the net worth chart. With sheet snapshots: every snapshot date
 * from the first one, plus today, so the chart starts when recording began.
 * Without: the last 12 month ends, plus today.
 */
export function netWorthDates(snapshots: readonly { as_of: string; source: string }[], today: ISODate): ISODate[] {
  const sheet = [...new Set(snapshots.filter((s) => s.source === 'sheet' && s.as_of <= today).map((s) => s.as_of))].sort()
  const dates = sheet.length ? sheet : Array.from({ length: 11 }, (_, i) => toISODate(endOfMonth(subMonths(parseISO(today), 11 - i))))
  return dates.at(-1) === today ? dates : [...dates, today]
}

/** Net worth on each date: the sum of every included account's balance then (null before any account has one). */
export function netWorthHistory(
  accounts: readonly AccountLike[],
  snapshots: readonly SnapshotLike[],
  transactions: readonly TxLike[],
  dates: readonly ISODate[],
): NetWorthPoint[] {
  return dates.map((date) => {
    let total = 0
    let any = false
    for (const a of accounts) {
      const b = balanceOn(a, snapshots, transactions, date)
      if (b !== null) {
        total += b
        any = true
      }
    }
    return { date, value: any ? total : null }
  })
}
