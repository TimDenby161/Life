import { format, parseISO } from 'date-fns'
import { AlertTriangle, CheckCircle2, PiggyBank } from 'lucide-react'
import { useMemo } from 'react'
import { ErrorState, ListSkeleton } from '@/components/states'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/misc'
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
        <CardHeader>
          <CardTitle>Saving a month</CardTitle>
          {needed ? (
            <span className="text-right">
              <span className="block text-lg font-semibold tabular">{money(needed)}</span>
              {both ? <span className="block text-xs text-muted-foreground tabular">{money(Math.ceil(needed / 2 / 100) * 100)} each</span> : null}
            </span>
          ) : null}
        </CardHeader>
        <CardContent>
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
        <CardHeader><CardTitle>Month to month</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          {concerns.length ? (
            <ul className="grid gap-3">
              {concerns.map((c) => (
                <li key={c.key} className="flex gap-2.5 text-sm">
                  <AlertTriangle className={cn('mt-0.5 size-4 shrink-0', c.severity === 'high' ? 'text-destructive' : 'text-warning')} aria-hidden />
                  <span className="min-w-0">
                    <span className="block font-medium">{c.title}</span>
                    {c.detail ? <span className="block text-muted-foreground">{c.detail}</span> : null}
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
            <ul className="grid grid-cols-2 gap-x-6 gap-y-1 border-t pt-3 text-sm sm:grid-cols-3">
              {changes.toReversed().map((c) => (
                <li key={c.date} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{format(parseISO(c.date), 'd MMM')}</span>
                  <span className={cn('tabular', c.change < 0 && 'text-destructive')}>{signed(c.change)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {changes.length ? <p className="text-xs text-muted-foreground">Net worth change at each balance update, worked out from the recorded balances.</p> : null}
        </CardContent>
      </Card>
    </>
  )
}

function GoalRow({ plan: p, owner }: { plan: GoalPlan; owner?: string }) {
  const by = p.date ? format(parseISO(p.date), 'MMM yyyy') : null
  return (
    <li className="flex items-start gap-3 py-2.5 text-sm">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{p.name}</span>
          {p.status === 'behind' ? <Badge tone="warning">Behind</Badge> : null}
        </span>
        <span className="block text-xs text-muted-foreground tabular">
          {[`${money(p.saved)} of ${money(p.target)}`, by ? `by ${by}` : null, owner, p.pot].filter(Boolean).join(' · ')}
        </span>
        {p.status === 'behind' && p.expected !== null ? (
          <span className="block text-xs text-warning">A steady pace would have {money(p.expected)} by now.</span>
        ) : null}
      </span>
      <span className="shrink-0 text-right tabular">
        {p.status === 'reached' ? (
          <span className="text-success">Done</span>
        ) : p.perMonth !== null ? (
          <span className="font-semibold">{money(p.perMonth)}<span className="font-normal text-muted-foreground">/mo</span></span>
        ) : (
          <span className="text-muted-foreground">{money(p.left)} to go{p.status === 'past_date' ? ', date passed' : ''}</span>
        )}
      </span>
    </li>
  )
}
