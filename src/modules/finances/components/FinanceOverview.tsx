import { format, parseISO } from 'date-fns'
import { AlertTriangle, CheckCircle2, PiggyBank } from 'lucide-react'
import { useMemo } from 'react'
import { ErrorState, ListSkeleton } from '@/components/states'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/misc'
import { todayISO } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { useAccounts, useBalances, useGoals, usePots, useSnapshots, useTransactions } from '../hooks'
import { netWorthDates } from '../lib/calc'
import { type GoalPlan, goalAccounts, goalPlans, recentChanges, trendConcerns, trendPoints } from '../lib/insights'

const money = (v: number) => formatMoney(v, 'GBP', { hidePence: true })
const signed = (v: number) => `${v < 0 ? '−' : '+'}${money(Math.abs(v))}`

/**
 * The top of the Finance view: what each goal needs a month, and anything
 * worrying in how the balances have moved update to update. Live, from the
 * same balances as Details.
 */
export function FinanceOverview() {
  const { household, members, member } = useHousehold()
  const accounts = useAccounts()
  const balances = useBalances()
  const snapshots = useSnapshots()
  const transactions = useTransactions()
  const goals = useGoals()
  const pots = usePots()
  const today = todayISO()
  const queries = [accounts, balances, snapshots, transactions, goals, pots]

  const derived = useMemo(() => {
    if (!accounts.data || !balances.data || !snapshots.data || !transactions.data || !goals.data || !pots.data) return null
    const allGoals = [...goals.data, ...pots.data.items]
    const plans = goalPlans(allGoals, pots.data.pots, balances.data, today)
    const needed = plans.reduce((t, p) => t + (p.perMonth ?? 0), 0)
    // Split evenly only when every goal being paid into is a joint one.
    const allJoint = plans.every((p) => p.perMonth === null || !p.owner_id)
    const included = accounts.data.filter((a) => !a.archived_at && a.include_in_net_worth && a.currency === household.default_currency)
    const points = trendPoints(included, snapshots.data, transactions.data, netWorthDates(snapshots.data, today), goalAccounts(allGoals, pots.data.pots))
    return { plans, needed, allJoint, concerns: trendConcerns(points, needed, today), changes: recentChanges(points) }
  }, [accounts.data, balances.data, snapshots.data, transactions.data, goals.data, pots.data, household.default_currency, today])

  const failed = queries.find((q) => q.error)
  if (failed) return <ErrorState error={failed.error} onRetry={() => queries.forEach((q) => q.refetch())} />
  if (!derived) return <ListSkeleton rows={4} />
  const { plans, needed, allJoint, concerns, changes } = derived
  const both = members.length > 1 && allJoint

  return (
    <>
      <Card>
        <CardHeader className="p-3 pb-1 sm:p-3 sm:pb-1">
          <CardTitle>Saving a month</CardTitle>
          {needed ? (
            <span className="text-right leading-tight">
              <span className="block text-lg font-semibold tabular">{money(needed)}</span>
              {both ? <span className="block text-xs text-muted-foreground tabular">{money(Math.ceil(needed / 2 / 100) * 100)} each</span> : null}
            </span>
          ) : null}
        </CardHeader>
        <CardContent className="px-3 pb-2 pt-0 sm:px-3">
          {plans.length ? (
            <ul className="divide-y">
              {plans.map((p) => <GoalRow key={p.id} plan={p} owner={p.owner_id ? member(p.owner_id)?.display_name : undefined} />)}
            </ul>
          ) : (
            <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground"><PiggyBank className="size-4" /> No goals yet. Add them under Details, Goals.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-3 pb-1 sm:p-3 sm:pb-1"><CardTitle>Month to month</CardTitle></CardHeader>
        <CardContent className="grid gap-2 px-3 pb-3 pt-0 sm:px-3">
          {concerns.length ? (
            <ul className="grid gap-1.5">
              {concerns.map((c) => (
                <li key={c.key} className="flex gap-2 text-sm leading-snug">
                  <AlertTriangle className={cn('mt-0.5 size-3.5 shrink-0', c.severity === 'high' ? 'text-destructive' : 'text-warning')} aria-hidden />
                  <span className="min-w-0">
                    <span className="font-medium">{c.title}</span>
                    {c.detail ? <span className="text-muted-foreground"> {c.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-success" /> {changes.length ? 'Nothing worrying in the recent updates.' : 'Not enough updates yet to see a trend.'}
            </p>
          )}
          {changes.length ? (
            <div className="border-t pt-2">
              <ul className="grid grid-cols-3 gap-x-3 gap-y-0.5 text-xs">
                {changes.toReversed().slice(0, 6).map((c) => (
                  <li key={c.date} className="flex justify-between gap-1.5">
                    <span className="text-muted-foreground">{format(parseISO(c.date), 'd MMM')}</span>
                    <span className={cn('tabular', c.change < 0 && 'text-destructive')}>{signed(c.change)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-muted-foreground">Net worth change per balance update, calculated.</p>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </>
  )
}

/** £6,100 as "£6.1k", £20,000 as "£20k"; under £1,000 as it is. For the short line under each goal. */
function short(minor: number): string {
  const pounds = minor / 100
  if (Math.abs(pounds) < 1000) return money(minor)
  const k = Math.round(pounds / 100) / 10
  return `£${Number.isInteger(k) ? k : k.toFixed(1)}k`
}

/**
 * A goal on one line: name (and whose), when it's for and what it needs a month (or what's left), over a thin bar
 * of how much is saved. Amber when behind a steady pace or past its date.
 */
function GoalRow({ plan: p, owner }: { plan: GoalPlan; owner?: string }) {
  const by = p.date ? format(parseISO(p.date), 'MMM yy') : null
  const behind = p.status === 'behind'
  const late = p.status === 'past_date'
  const pct = p.target > 0 ? Math.round((p.saved / p.target) * 100) : 0
  const saved = `${short(p.saved)} of ${short(p.target)}`
  return (
    <li
      className="grid grid-cols-[minmax(0,1fr)] gap-1 py-1.5 text-sm"
      title={behind && p.expected !== null ? `${saved}. Behind: a steady pace would have ${money(p.expected)} by now` : saved}
    >
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{p.name}</span>
          {owner ? <span className="text-xs text-muted-foreground"> · {owner}</span> : null}
        </span>
        {by ? <span className={cn('shrink-0 text-xs text-muted-foreground', late && 'text-warning')}>{by}</span> : null}
        <span className="min-w-14 shrink-0 text-right tabular">
          {p.status === 'reached' ? (
            <span className="text-success">Done</span>
          ) : p.perMonth !== null ? (
            <span className={cn('font-semibold', behind && 'text-warning')}>{money(p.perMonth)}</span>
          ) : (
            <span className={cn('text-xs text-muted-foreground', late && 'text-warning')}>{short(p.left)} left</span>
          )}
        </span>
      </span>
      <Progress
        value={pct}
        className="h-1"
        indicatorClassName={p.status === 'reached' ? 'bg-success' : behind || late ? 'bg-warning' : undefined}
      />
    </li>
  )
}
