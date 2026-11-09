// Finance: the household's overall position. Net worth only: no bills
// or spending, by request. Pure.
//
//   fin:position:<key>  net worth at the latest update, change since the one
//                       before and over the year, what moved it, and per person
//   fin:stale:<date>    the latest sheet balances are getting old
//   fin:debt:<date>     card and loan balances rising update after update
//   fin:goal:<id>:<month>  a savings goal with a target date (the wedding, a
//                       honeymoon): saved so far, what's needed a month, and
//                       whether it's behind where a steady pace would be
//
// Net worth is worked out exactly as the Finances page does (finances/lib/calc.ts:
// valueOn, balanceOn, netWorthDates): active GBP accounts included in net worth;
// each at its latest recorded balance plus later transactions; a house or car
// between two values on the straight line between them. Transactions come in
// as account, date and amount only: never descriptions, categories or kinds.
// Approving only adds a task; nothing touches money.
import { addDays, daysBetween, type ISODate, nextWeekday } from './dates.ts'
import { formatPounds, type SuggestionDraft } from './types.ts'

export const STALE_DAYS = 45
/** A fall of this much since the last update is flagged. */
export const DROP_PCT = 3
export const MILESTONE_STEP = 50_000_00
/** Card and loan balances up this many updates in a row. */
export const DEBT_STREAK = 3
export const DEBT_MIN = 500_00
/** Group changes smaller than this aren't worth naming. */
const MOVER_MIN = 100_00

export type FinAccount = {
  id: string
  account_type: string
  ownership: string
  owner_id: string | null
  opening_balance_minor: number
  opening_date: ISODate
}
export type FinSnapshot = { account_id: string; as_of: ISODate; balance_minor: number; source: string; created_at: string }
export type FinTx = { account_id: string; occurred_on: ISODate; amount_minor: number; created_at: string }
export type FinanceInput = {
  today: ISODate
  /** Already filtered like the page: active, GBP, included in net worth. */
  accounts: FinAccount[]
  snapshots: FinSnapshot[]
  transactions: FinTx[]
  members: { id: string; name: string }[]
}

const GROUPS: [string, string[]][] = [
  ['current accounts', ['current', 'cash']],
  ['savings', ['savings']],
  ['investments', ['investment']],
  ['pensions', ['pension']],
  ['property', ['property']],
  ['vehicles', ['vehicle']],
  ['credit cards', ['credit_card']],
  ['mortgage', ['mortgage']],
  ['loans', ['loan']],
]
const groupOf = (type: string) => GROUPS.find(([, types]) => types.includes(type))?.[0] ?? 'other'
const VALUED = new Set(['property', 'vehicle'])
const DEBT = new Set(['credit_card', 'loan'])

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "14 Oct". */
export const dayMonth = (iso: ISODate) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`

/** Whole pounds: "£312,875", "−£2,000". */
export const pounds = (minor: number) => `${minor < 0 ? '−' : ''}${formatPounds(Math.round(Math.abs(minor) / 100) * 100)}`
/** "+£3,100" / "−£800". */
const signed = (minor: number) => `${minor < 0 ? '' : '+'}${pounds(minor)}`
const pct = (change: number, base: number) => Math.round((Math.abs(change) / Math.abs(base)) * 1000) / 10

/** Last day of the month `back` months before the date's month. */
export function monthEnd(date: ISODate, back: number): ISODate {
  const y = Number(date.slice(0, 4))
  const m = Number(date.slice(5, 7)) - back
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

/** balanceOn in finances/lib/calc.ts: latest recorded balance plus later transactions, else opening balance plus transactions. */
function recordedOn(account: FinAccount, own: FinSnapshot[], txs: FinTx[], date: ISODate): number | null {
  if (date < account.opening_date && !own.some((s) => s.as_of <= date)) return null
  let snap: FinSnapshot | undefined
  for (const s of own) if (s.as_of <= date && (!snap || s.as_of > snap.as_of)) snap = s
  let total = snap ? snap.balance_minor : account.opening_balance_minor
  for (const t of txs) {
    if (t.occurred_on > date) continue
    if (snap) {
      if (t.occurred_on > snap.as_of || (t.occurred_on === snap.as_of && t.created_at > snap.created_at)) total += t.amount_minor
    } else if (t.occurred_on >= account.opening_date) {
      total += t.amount_minor
    }
  }
  return total
}

/** valueOn in finances/lib/calc.ts. `own` and `txs` are this account's only. */
export function balanceOn(account: FinAccount, own: FinSnapshot[], txs: FinTx[], date: ISODate): number | null {
  if (VALUED.has(account.account_type)) {
    let before: FinSnapshot | undefined
    let after: FinSnapshot | undefined
    for (const s of own) {
      if (s.as_of <= date && (!before || s.as_of > before.as_of)) before = s
      if (s.as_of > date && (!after || s.as_of < after.as_of)) after = s
    }
    if (before && after && before.as_of !== date) {
      const span = daysBetween(before.as_of, after.as_of)
      const done = daysBetween(before.as_of, date)
      return Math.round(before.balance_minor + ((after.balance_minor - before.balance_minor) * done) / span)
    }
  }
  return recordedOn(account, own, txs, date)
}

export type Position = { date: ISODate; total: number; byGroup: Map<string, number>; byOwner: Map<string, number>; debt: number; counted: number }

export function positionOn(input: FinanceInput, date: ISODate): Position {
  const p: Position = { date, total: 0, byGroup: new Map(), byOwner: new Map(), debt: 0, counted: 0 }
  for (const a of input.accounts) {
    const b = balanceOn(
      a,
      input.snapshots.filter((s) => s.account_id === a.id),
      input.transactions.filter((t) => t.account_id === a.id),
      date,
    )
    if (b === null) continue
    p.counted++
    p.total += b
    const g = groupOf(a.account_type)
    p.byGroup.set(g, (p.byGroup.get(g) ?? 0) + b)
    const owner = a.ownership === 'joint' ? 'joint' : (a.owner_id ?? 'joint')
    p.byOwner.set(owner, (p.byOwner.get(owner) ?? 0) + b)
    if (DEBT.has(a.account_type)) p.debt += b
  }
  return p
}

/**
 * netWorthDates in finances/lib/calc.ts: with sheet balances, every sheet date
 * (each one is an update); without, the last 11 month ends plus today.
 */
export function updateDates(input: FinanceInput): { dates: ISODate[]; fromSheet: boolean } {
  const sheet = [...new Set(input.snapshots.filter((s) => s.source === 'sheet' && s.as_of <= input.today).map((s) => s.as_of))].sort()
  if (sheet.length) return { dates: sheet, fromSheet: true }
  const dates = Array.from({ length: 11 }, (_, i) => monthEnd(input.today, 11 - i))
  return { dates: dates.at(-1) === input.today ? dates : [...dates, input.today], fromSheet: false }
}

function movers(now: Position, then: Position): string {
  const changes = [...new Set([...now.byGroup.keys(), ...then.byGroup.keys()])]
    .map((g) => ({ g, d: (now.byGroup.get(g) ?? 0) - (then.byGroup.get(g) ?? 0) }))
    .filter((c) => Math.abs(c.d) >= MOVER_MIN)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, 2)
  if (!changes.length) return ''
  const list = changes.map((c) => `${c.g} ${signed(c.d)}`).join(', ')
  return `${list[0].toUpperCase()}${list.slice(1)}.`
}

export function analyseFinance(input: FinanceInput, enabled: string[]): SuggestionDraft[] {
  if (!enabled.length) return []
  const { dates, fromSheet } = updateDates(input)
  const positions = dates.map((d) => positionOn(input, d)).filter((p) => p.counted > 0)
  if (!positions.length || positions.at(-1)!.date !== dates.at(-1)) return []
  const out: Omit<SuggestionDraft, 'recipients'>[] = []
  const now = positions.at(-1)!
  const prev = positions.at(-2)
  const yearAgo = positions.findLast((p) => p.date <= addDays(now.date, -358))

  // Where things stand.
  const change = prev ? now.total - prev.total : null
  const fell = change !== null && prev!.total !== 0 && change < 0 && pct(change, prev!.total) >= DROP_PCT
  let streak = 0
  for (let i = positions.length - 1; i > 0 && positions[i].total < positions[i - 1].total; i--) streak++
  const crossed = prev && Math.floor(now.total / MILESTONE_STEP) > Math.floor(prev.total / MILESTONE_STEP) && now.total > 0
  const names = new Map(input.members.map((m) => [m.id, m.name]))
  const owners = [...now.byOwner.entries()]
    .sort(([a], [b]) => (a === 'joint' ? 1 : b === 'joint' ? -1 : 0))
    .map(([id, v]) => `${id === 'joint' ? 'joint' : (names.get(id) ?? 'Someone')} ${pounds(v)}`)
  const unit = fromSheet ? 'updates' : 'months'
  out.push({
    // A sheet update is a new position; without the sheet it's one per month, refreshed daily.
    dedupe_key: `fin:position:${fromSheet ? now.date : now.date.slice(0, 7)}`,
    kind: 'fin_position',
    severity: fell || streak >= 3 ? 2 : 1,
    title:
      change === null
        ? `Net worth ${pounds(now.total)}`
        : `Net worth ${pounds(now.total)}, ${change < 0 ? 'down' : 'up'} ${pounds(Math.abs(change))} since ${dayMonth(prev!.date)}`,
    reason: [
      crossed ? `Passed ${pounds(Math.floor(now.total / MILESTONE_STEP) * MILESTONE_STEP)}.` : '',
      prev ? movers(now, prev) : '',
      streak >= 3 ? `Down ${streak} ${unit} in a row.` : '',
      yearAgo && yearAgo.total !== 0
        ? `${now.total >= yearAgo.total ? 'Up' : 'Down'} ${pounds(Math.abs(now.total - yearAgo.total))} (${pct(now.total - yearAgo.total, yearAgo.total)}%) on a year ago.`
        : '',
      owners.length > 1 ? `${owners.join(', ')}.` : '',
      fromSheet ? `Balances as of ${dayMonth(now.date)}.` : '',
    ]
      .filter(Boolean)
      .join(' '),
    task_id: null,
    action: null,
  })

  // Old balances make everything above old too.
  const age = daysBetween(now.date, input.today)
  if (fromSheet && age > STALE_DAYS) {
    out.push({
      dedupe_key: `fin:stale:${now.date}`,
      kind: 'fin_stale',
      severity: 2,
      title: `Balances last updated ${dayMonth(now.date)}`,
      reason: `${age} days ago. Update the MonthReport sheet and sync it, or record balances on the Finances page.`,
      task_id: null,
      action: { type: 'create_task', title: 'Update the finance balances', list: 'joint', due_date: nextWeekday(input.today, 6) },
    })
  }

  // Cards and loans growing (more negative) update after update.
  const recent = positions.slice(-(DEBT_STREAK + 1))
  const rising = recent.length === DEBT_STREAK + 1 && recent.slice(1).every((p, i) => p.debt < recent[i].debt)
  if (rising && -now.debt >= DEBT_MIN) {
    out.push({
      dedupe_key: `fin:debt:${now.date}`,
      kind: 'fin_debt',
      severity: 2,
      title: `Cards and loans ${pounds(-now.debt)}, rising since ${dayMonth(recent[0].date)}`,
      reason: `Up ${pounds(recent[0].debt - now.debt)} over the last ${DEBT_STREAK} ${unit}.`,
      task_id: null,
      action: null,
    })
  }

  return out.map((s) => ({ ...s, recipients: enabled }))
}

// ---------------------------------------------------------------------------
// Savings goals with a target date.

export type SavingsGoal = {
  id: string
  name: string
  target_minor: number
  target_date: ISODate | null
  account_id: string | null
  manual_saved_minor: number
  pot_id: string | null
  sort_order: number
  ownership: string
  owner_id: string | null
  created_at: string
}
export type SavingsPot = { id: string; account_id: string | null }

/** Average days in a month, for "a month" amounts. */
const MONTH_DAYS = 30.44

/**
 * What each goal has saved: its account's balance, its manual amount, or its
 * share of a pot (the pot's account funds its items in order, each in full
 * before the next, as fundPot in finances/lib/pots.ts). Null when the money
 * sits in an account that isn't counted in net worth.
 */
export function savedSoFar(input: FinanceInput, goals: SavingsGoal[], pots: SavingsPot[]): Map<string, number | null> {
  const balance = (accountId: string | null) => {
    const a = accountId ? input.accounts.find((x) => x.id === accountId) : undefined
    if (!a) return null
    return balanceOn(a, input.snapshots.filter((s) => s.account_id === a.id), input.transactions.filter((t) => t.account_id === a.id), input.today)
  }
  const out = new Map<string, number | null>()
  for (const g of goals) if (!g.pot_id) out.set(g.id, g.account_id ? balance(g.account_id) : g.manual_saved_minor)
  for (const pot of pots) {
    const b = balance(pot.account_id)
    let left = b === null ? 0 : Math.max(0, b)
    for (const g of goals.filter((x) => x.pot_id === pot.id).sort((x, y) => x.sort_order - y.sort_order)) {
      const funded = Math.min(left, g.target_minor)
      left -= funded
      out.set(g.id, b === null ? null : funded)
    }
  }
  return out
}

export function analyseSavings(input: FinanceInput, goals: SavingsGoal[], pots: SavingsPot[], enabled: string[]): SuggestionDraft[] {
  if (!enabled.length) return []
  const saved = savedSoFar(input, goals, pots)
  const month = input.today.slice(0, 7)
  const out: SuggestionDraft[] = []
  for (const g of goals) {
    const have = saved.get(g.id)
    if (!g.target_date || have === null || have === undefined || g.target_date <= input.today || have >= g.target_minor) continue
    const recipients = g.ownership === 'personal' && g.owner_id ? enabled.filter((id) => id === g.owner_id) : enabled
    if (!recipients.length) continue
    const monthsLeft = Math.max(1, daysBetween(input.today, g.target_date) / MONTH_DAYS)
    const perMonth = Math.ceil((g.target_minor - have) / monthsLeft / 100) * 100
    // Where a steady pace from when the goal was set would be by now.
    const start = g.created_at.slice(0, 10)
    const span = daysBetween(start, g.target_date)
    const expected = span > 0 ? Math.round((g.target_minor * Math.max(0, daysBetween(start, input.today))) / span) : 0
    const behind = expected - have > perMonth
    out.push({
      dedupe_key: `fin:goal:${g.id}:${month}`,
      kind: 'savings_pace',
      severity: behind ? 2 : 1,
      title: `${g.name}: ${pounds(have)} of ${pounds(g.target_minor)}`,
      reason: [
        `${pounds(perMonth)} a month${recipients.length > 1 ? ` (${pounds(Math.ceil(perMonth / 2 / 100) * 100)} each)` : ''} reaches it by ${dayMonth(g.target_date)} ${g.target_date.slice(0, 4)}.`,
        behind ? `That’s behind a steady pace: about ${pounds(expected)} would be saved by now.` : '',
      ]
        .filter(Boolean)
        .join(' '),
      task_id: null,
      action: null,
      recipients,
    })
  }
  return out
}
