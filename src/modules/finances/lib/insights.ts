// The Finance view's two live cards: what each savings goal needs a month, and
// anything worrying in how the balances have moved from one update to the next.
// Pure; amounts are integer minor units. Worked out from the same balances as
// the Details page (valueOn, netWorthDates), so the two always agree.
import { format, parseISO } from 'date-fns'
import { daysBetween, type ISODate } from '@/lib/dates'
import { type AccountLike, groupOf, NET_WORTH_GROUPS, type NetWorthGroup, type SnapshotLike, type TxLike, valueOn } from './calc'
import { fundPot } from './pots'

/** Average days in a month, for "a month" amounts. */
export const MONTH_DAYS = 30.44
/** Changes smaller than this aren't worth a warning. */
export const NOISE = 250_00
/** Balances older than this make every trend old too. */
export const STALE_DAYS = 45

// Goals ------------------------------------------------------------------------------------

export type GoalInput = {
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
export type PotInput = { id: string; name: string; account_id: string | null }

export type GoalPlan = {
  id: string
  name: string
  /** The pot it's saved in, if any. */
  pot: string | null
  owner_id: string | null
  target: number
  saved: number
  left: number
  date: ISODate | null
  /** Needed a month to reach it by its date (rounded up to the pound); null without a future date or once reached. */
  perMonth: number | null
  status: 'reached' | 'on_track' | 'behind' | 'no_date' | 'past_date'
  /** Where a steady pace since the goal was set would be by now (only when behind). */
  expected: number | null
}

const upToPound = (minor: number) => Math.ceil(minor / 100) * 100

/**
 * Every live goal with what it has saved (its account, its manual amount, or
 * its share of its pot, filled in order) and what it needs a month. Dated
 * goals first, soonest first.
 */
export function goalPlans(goals: readonly GoalInput[], pots: readonly PotInput[], balances: ReadonlyMap<string, number>, today: ISODate): GoalPlan[] {
  const saved = new Map<string, number>()
  for (const g of goals) if (!g.pot_id) saved.set(g.id, g.account_id ? Math.max(0, balances.get(g.account_id) ?? 0) : g.manual_saved_minor)
  for (const pot of pots) {
    const items = goals.filter((g) => g.pot_id === pot.id).toSorted((a, b) => a.sort_order - b.sort_order)
    for (const item of fundPot(pot.account_id ? (balances.get(pot.account_id) ?? 0) : 0, items).items) saved.set(item.id, item.funded)
  }
  const potName = new Map(pots.map((p) => [p.id, p.name]))

  return goals
    .map((g): GoalPlan => {
      const have = Math.min(saved.get(g.id) ?? 0, g.target_minor)
      const left = g.target_minor - have
      const base = { id: g.id, name: g.name, pot: g.pot_id ? (potName.get(g.pot_id) ?? null) : null, owner_id: g.owner_id, target: g.target_minor, saved: have, left, date: g.target_date }
      if (!left) return { ...base, perMonth: null, status: 'reached', expected: null }
      if (!g.target_date) return { ...base, perMonth: null, status: 'no_date', expected: null }
      if (g.target_date <= today) return { ...base, perMonth: null, status: 'past_date', expected: null }
      const perMonth = upToPound(left / Math.max(1, daysBetween(today, g.target_date) / MONTH_DAYS))
      // A steady pace from when the goal was set: behind when more than a month's saving short of it.
      const start = g.created_at.slice(0, 10)
      const span = daysBetween(start, g.target_date)
      const expected = span > 0 ? Math.round((g.target_minor * Math.min(span, Math.max(0, daysBetween(start, today)))) / span) : 0
      const behind = expected - have > perMonth
      return { ...base, perMonth, status: behind ? 'behind' : 'on_track', expected: behind ? expected : null }
    })
    .toSorted((a, b) => (a.date && a.perMonth !== null ? a.date : '9999').localeCompare(b.date && b.perMonth !== null ? b.date : '9999') || a.name.localeCompare(b.name))
}

/** The accounts that hold goal money: goals' own accounts and their pots' accounts. */
export function goalAccounts(goals: readonly GoalInput[], pots: readonly PotInput[]): Set<string> {
  const ids = new Set<string>()
  for (const g of goals) if (!g.pot_id && g.account_id) ids.add(g.account_id)
  for (const p of pots) if (p.account_id && goals.some((g) => g.pot_id === p.id)) ids.add(p.account_id)
  return ids
}

// Trend ------------------------------------------------------------------------------------

export type Point = { date: ISODate; total: number; groups: Partial<Record<NetWorthGroup, number>>; goalMoney: number }

/** Net worth, each group and the goal accounts on every update date (dates before any balance are left out). */
export function trendPoints(
  accounts: readonly AccountLike[],
  snapshots: readonly SnapshotLike[],
  transactions: readonly TxLike[],
  dates: readonly ISODate[],
  goalAccountIds: ReadonlySet<string>,
): Point[] {
  const own = new Map(accounts.map((a) => [a.id, { snaps: snapshots.filter((s) => s.account_id === a.id), txs: transactions.filter((t) => t.account_id === a.id) }]))
  const out: Point[] = []
  for (const date of dates) {
    const p: Point = { date, total: 0, groups: {}, goalMoney: 0 }
    let any = false
    for (const a of accounts) {
      const v = valueOn(a, own.get(a.id)!.snaps, own.get(a.id)!.txs, date)
      if (v === null) continue
      any = true
      p.total += v
      const g = groupOf(a.account_type)
      p.groups[g] = (p.groups[g] ?? 0) + v
      if (goalAccountIds.has(a.id)) p.goalMoney += v
    }
    if (any) out.push(p)
  }
  return out
}

export type Concern = { key: string; severity: 'high' | 'medium'; title: string; detail: string }

const money = (minor: number) => `£${Math.round(Math.abs(minor) / 100).toLocaleString('en-GB')}`
const signed = (minor: number) => `${minor < 0 ? '−' : '+'}${money(minor)}`
const label = (date: ISODate) => format(parseISO(date), 'd MMM')
const groupLabel = (g: NetWorthGroup) => NET_WORTH_GROUPS.find((x) => x.key === g)!.label
/** Groups whose fall is worth a warning: money you hold, not a house or car being revalued. */
const WATCHED: NetWorthGroup[] = ['cash', 'savings', 'investments', 'pensions']
const DEBTS: NetWorthGroup[] = ['cards', 'loans']
const debtOf = (p: Point) => DEBTS.reduce((t, g) => t + (p.groups[g] ?? 0), 0)

/** The groups that moved most between two points, e.g. "Savings −£1,200, Credit cards −£300". */
function movers(now: Point, then: Point): string {
  return NET_WORTH_GROUPS.map((g) => ({ g: g.key, d: (now.groups[g.key] ?? 0) - (then.groups[g.key] ?? 0) }))
    .filter((c) => Math.abs(c.d) >= 100_00)
    .toSorted((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, 2)
    .map((c) => `${groupLabel(c.g)} ${signed(c.d)}`)
    .join(', ')
}

/** How much a series changed a month, on average, between two points. */
const perMonth = (from: Point, to: Point, value: (p: Point) => number) => {
  const months = daysBetween(from.date, to.date) / MONTH_DAYS
  return months > 0 ? (value(to) - value(from)) / months : 0
}

/**
 * Anything worrying in the last few updates, most serious first: net worth
 * falling or slowing down, money you hold shrinking update after update, card
 * and loan balances growing, goal accounts not keeping up with what the goals
 * need, and balances too old to trust.
 */
export function trendConcerns(points: readonly Point[], neededPerMonth: number, today: ISODate): Concern[] {
  const out: Concern[] = []
  const now = points.at(-1)
  if (!now) return out
  const prev = points.at(-2)

  const age = daysBetween(now.date, today)
  if (age > STALE_DAYS) {
    out.push({ key: 'stale', severity: 'medium', title: `Last update ${label(now.date)}`, detail: `${age} days ago, so these trends may be out of date.` })
  }

  if (prev) {
    const change = now.total - prev.total
    let streak = 0
    for (let i = points.length - 1; i > 0 && points[i].total < points[i - 1].total; i--) streak++
    if (change <= -NOISE) {
      const from = points[points.length - 1 - streak]
      out.push({
        key: 'fall',
        severity: streak >= 2 ? 'high' : 'medium',
        title: streak >= 2 ? `Net worth down ${streak} updates in a row` : `Net worth down ${money(change)} since ${label(prev.date)}`,
        detail: [streak >= 2 ? `${signed(now.total - from.total)} since ${label(from.date)}.` : '', movers(now, prev) ? `${movers(now, prev)}.` : '']
          .filter(Boolean)
          .join(' '),
      })
    } else if (change >= 0 && points.length >= 5) {
      // Still growing, but much more slowly than the months before.
      const before = perMonth(points.at(-5)!, prev, (p) => p.total)
      const latest = perMonth(prev, now, (p) => p.total)
      if (before >= NOISE && latest < before / 2) {
        out.push({
          key: 'slowing',
          severity: 'medium',
          title: `Growth slowed to ${money(latest)} a month`,
          detail: `Against ${money(before)} a month over the three updates before.${movers(now, prev) ? ` ${movers(now, prev)}.` : ''}`,
        })
      }
    }
  }

  // Money you hold falling three updates in a row.
  const last4 = points.slice(-4)
  if (last4.length === 4) {
    for (const g of WATCHED) {
      const v = last4.map((p) => p.groups[g] ?? 0)
      const falling = v.slice(1).every((x, i) => x < v[i])
      if (falling && v[0] - v[3] >= NOISE) {
        out.push({ key: `group:${g}`, severity: 'medium', title: `${groupLabel(g)} down 3 updates in a row`, detail: `${signed(v[3] - v[0])} since ${label(last4[0].date)}.` })
      }
    }
  }

  // Cards and loans owed growing two updates in a row.
  const last3 = points.slice(-3)
  if (last3.length === 3) {
    const owed = last3.map((p) => -debtOf(p))
    if (owed[1] > owed[0] && owed[2] > owed[1] && owed[2] - owed[0] >= NOISE) {
      out.push({ key: 'debt', severity: 'high', title: `Cards and loans up to ${money(owed[2])}`, detail: `Up ${money(owed[2] - owed[0])} since ${label(last3[0].date)}, two updates in a row.` })
    }
  }

  // Goal accounts not growing as fast as the goals need.
  if (neededPerMonth > 0 && points.length >= 2) {
    const from = points.at(-4) ?? points[0]
    const actual = perMonth(from, now, (p) => p.goalMoney)
    if (actual < neededPerMonth) {
      out.push({
        key: 'goals',
        severity: actual < neededPerMonth / 2 ? 'high' : 'medium',
        title: `Goals need ${money(neededPerMonth)} a month`,
        detail: `The goal accounts have ${actual < 0 ? `fallen ${money(actual)}` : `grown ${money(actual)}`} a month since ${label(from.date)}.`,
      })
    }
  }

  return out.toSorted((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1))
}

/** The last few changes in net worth, newest last, for the month-by-month list. */
export function recentChanges(points: readonly Point[], count = 6): { date: ISODate; change: number }[] {
  return points.slice(1).map((p, i) => ({ date: p.date, change: p.total - points[i].total })).slice(-count)
}
