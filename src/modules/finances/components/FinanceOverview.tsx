import { format, parseISO } from 'date-fns'
import { PiggyBank } from 'lucide-react'
import { useMemo } from 'react'
import { ErrorState, ListSkeleton } from '@/components/states'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/misc'
import { todayISO } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { useBalances, useGoals, usePots } from '../hooks'
import { type GoalPlan, goalPlans } from '../lib/insights'

const money = (v: number) => formatMoney(v, 'GBP', { hidePence: true })

/** The Finance view: what each goal needs a month. Live, from the same balances as Details. */
export function FinanceOverview() {
  const { members, member } = useHousehold()
  const balances = useBalances()
  const goals = useGoals()
  const pots = usePots()
  const today = todayISO()
  const queries = [balances, goals, pots]

  const derived = useMemo(() => {
    if (!balances.data || !goals.data || !pots.data) return null
    const allGoals = [...goals.data, ...pots.data.items]
    const plans = goalPlans(allGoals, pots.data.pots, balances.data, today)
    const needed = plans.reduce((t, p) => t + (p.perMonth ?? 0), 0)
    // Split evenly only when every goal being paid into is a joint one.
    const allJoint = plans.every((p) => p.perMonth === null || !p.owner_id)
    return { plans, needed, allJoint }
  }, [balances.data, goals.data, pots.data, today])

  const failed = queries.find((q) => q.error)
  if (failed) return <ErrorState error={failed.error} onRetry={() => queries.forEach((q) => q.refetch())} />
  if (!derived) return <ListSkeleton rows={4} />
  const { plans, needed, allJoint } = derived
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
 * A goal on one line: name (and whose), when it's for and what it needs a month (or what's left); under it a thin
 * bar of how much is saved, with what's in the pot now and the total needed. Amber when behind a steady pace or past its date.
 */
function GoalRow({ plan: p, owner }: { plan: GoalPlan; owner?: string }) {
  const by = p.date ? format(parseISO(p.date), 'MMM yy') : null
  const behind = p.status === 'behind'
  const late = p.status === 'past_date'
  const pct = p.target > 0 ? Math.round((p.saved / p.target) * 100) : 0
  const saved = `${money(p.saved)} of ${money(p.target)}`
  return (
    <li
      className="grid grid-cols-[minmax(0,1fr)] gap-0.5 py-1 text-sm"
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
      <span className="flex items-center gap-2">
        <Progress
          value={pct}
          className="h-1 flex-1"
          indicatorClassName={p.status === 'reached' ? 'bg-success' : behind || late ? 'bg-warning' : undefined}
        />
        <span className="shrink-0 text-xs text-muted-foreground tabular">
          <span className="text-foreground">{money(p.saved)}</span> / {money(p.target)}
        </span>
      </span>
    </li>
  )
}
