import { differenceInCalendarMonths, parseISO } from 'date-fns'
import { Archive, Pencil, Plus, Target } from 'lucide-react'
import { useState } from 'react'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge, Progress } from '@/components/ui/misc'
import { formatDay } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import type { SavingsGoal } from '../api'
import { GoalDialog } from '../components/forms'
import { useAccounts, useArchiveGoal, useBalances, useGoals } from '../hooks'
import { goalProgress } from '../lib/calc'

export function GoalsTab() {
  const { member } = useHousehold()
  const goals = useGoals()
  const balances = useBalances()
  const accounts = useAccounts().data ?? []
  const archive = useArchiveGoal()
  const [editing, setEditing] = useState<SavingsGoal | undefined>()
  const [adding, setAdding] = useState(false)

  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}><Plus /> New goal</Button>
      </div>
      {goals.isPending || balances.isPending ? (
        <ListSkeleton rows={3} />
      ) : goals.error ? (
        <ErrorState error={goals.error} onRetry={() => goals.refetch()} />
      ) : !goals.data.length ? (
        <Card><EmptyState icon={Target} title="No savings goals" description="Set a target and link a savings account to track progress automatically." /></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {goals.data.map((g) => {
            const { saved, pct } = goalProgress(g, balances.data!)
            const remaining = Math.max(0, g.target_minor - saved)
            const monthsLeft = g.target_date ? Math.max(1, differenceInCalendarMonths(parseISO(g.target_date), new Date())) : null
            const account = accounts.find((a) => a.id === g.account_id)
            return (
              <Card key={g.id} className="p-4 sm:p-5">
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{g.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {g.ownership === 'joint' ? 'Joint' : member(g.owner_id)?.display_name}
                      {account ? ` · tracks ${account.name}` : ' · manual'}
                      {g.target_date ? ` · by ${formatDay(g.target_date)}` : ''}
                    </p>
                  </div>
                  {g.reached_at ? <Badge tone="success">Reached</Badge> : null}
                </div>
                <p className="text-2xl font-semibold tabular">
                  {formatMoney(saved, g.currency, { hidePence: true })}
                  <span className="text-sm font-normal text-muted-foreground"> of {formatMoney(g.target_minor, g.currency, { hidePence: true })}</span>
                </p>
                <Progress value={pct} className="mt-2 h-2.5" indicatorClassName={pct >= 100 ? 'bg-success' : undefined} />
                <p className="mt-2 text-xs text-muted-foreground">
                  {pct}%{remaining > 0 ? ` · ${formatMoney(remaining, g.currency, { hidePence: true })} to go` : ''}
                  {remaining > 0 && monthsLeft ? ` · about ${formatMoney(Math.ceil(remaining / monthsLeft), g.currency, { hidePence: true })}/month to hit the date (estimate)` : ''}
                </p>
                <div className="mt-3 flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(g)}><Pencil /> Edit</Button>
                  <Button variant="ghost" size="sm" onClick={() => archive.mutate(g.id)}><Archive /> Archive</Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}
      <GoalDialog key={editing?.id ?? 'new'} open={adding || Boolean(editing)} initial={editing} onOpenChange={(o) => { if (!o) { setAdding(false); setEditing(undefined) } }} />
    </div>
  )
}
