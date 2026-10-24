import { addMonths, endOfMonth, format, parseISO } from 'date-fns'
import { ChevronLeft, ChevronRight, PiggyBank, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Progress } from '@/components/ui/misc'
import { monthStart, todayISO, toISODate } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import type { Budget } from '../api'
import { BudgetDialog } from '../components/forms'
import { useAccountCurrency, useBudgets, useFinanceCategories, useTransactions } from '../hooks'
import { activeBudgets, spendingByCategory } from '../lib/calc'

export function BudgetsTab() {
  const { household } = useHousehold()
  const currency = household.default_currency
  const [month, setMonth] = useState(monthStart(todayISO()))
  const budgets = useBudgets()
  const transactions = useTransactions()
  const categories = useFinanceCategories().data ?? []
  const accountCurrency = useAccountCurrency()
  const [editing, setEditing] = useState<Budget | undefined>()
  const [adding, setAdding] = useState(false)

  const monthEnd = toISODate(endOfMonth(parseISO(month)))
  const spend = useMemo(
    () => spendingByCategory(transactions.data ?? [], accountCurrency, currency, month, monthEnd),
    [transactions.data, accountCurrency, currency, month, monthEnd],
  )
  const active = activeBudgets((budgets.data ?? []).filter((b) => b.currency === currency), month)
  const catName = new Map(categories.map((c) => [c.id, c.name]))
  const totalBudget = active.reduce((s, b) => s + b.amount_minor, 0)
  const totalSpent = active.reduce((s, b) => s + (spend.get(b.category_id) ?? 0), 0)
  const unbudgeted = [...spend.entries()].filter(([k, v]) => v > 0 && !active.some((b) => b.category_id === k))
  const money = (v: number) => formatMoney(v, currency, { hidePence: true })
  const shift = (n: number) => setMonth(toISODate(addMonths(parseISO(month), n)))

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft /></Button>
          <p className="min-w-32 text-center font-medium">{format(parseISO(month), 'MMMM yyyy')}</p>
          <Button variant="ghost" size="icon-sm" aria-label="Next month" onClick={() => shift(1)}><ChevronRight /></Button>
        </div>
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}><Plus /> Add budget</Button>
      </div>

      {budgets.isPending || transactions.isPending ? (
        <ListSkeleton rows={4} />
      ) : budgets.error ? (
        <ErrorState error={budgets.error} onRetry={() => budgets.refetch()} />
      ) : !active.length ? (
        <Card><EmptyState icon={PiggyBank} title="No budgets for this month" description="Set a monthly amount per spending category to compare against what you actually spend." /></Card>
      ) : (
        <Card className="p-4 sm:p-5">
          <div className="mb-4">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="font-medium">Total</span>
              <span className="text-sm tabular">
                <span className={totalSpent > totalBudget ? 'font-semibold text-destructive' : 'font-semibold'}>{money(totalSpent)}</span>
                <span className="text-muted-foreground"> of {money(totalBudget)}</span>
              </span>
            </div>
            <Progress value={(totalSpent / Math.max(1, totalBudget)) * 100} className="h-2.5" indicatorClassName={totalSpent > totalBudget ? 'bg-destructive' : undefined} />
          </div>
          <ul className="grid gap-4">
            {active.map((b) => {
              const spent = spend.get(b.category_id) ?? 0
              const left = b.amount_minor - spent
              return (
                <li key={b.id}>
                  <button type="button" className="w-full text-left" onClick={() => setEditing(b)}>
                    <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                      <span>{catName.get(b.category_id) ?? 'Category'}</span>
                      <span className="tabular text-muted-foreground">
                        {money(spent)} / {money(b.amount_minor)} ·{' '}
                        <span className={left < 0 ? 'font-medium text-destructive' : 'text-success'}>{left < 0 ? `${money(-left)} over` : `${money(left)} left`}</span>
                      </span>
                    </div>
                    <Progress value={(spent / b.amount_minor) * 100} indicatorClassName={left < 0 ? 'bg-destructive' : undefined} />
                  </button>
                </li>
              )
            })}
          </ul>
          {unbudgeted.length ? (
            <div className="mt-5 border-t pt-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Spending without a budget</p>
              <ul className="grid gap-1 text-sm">
                {unbudgeted.map(([k, v]) => (
                  <li key={k} className="flex justify-between"><span className="text-muted-foreground">{catName.get(k) ?? 'Uncategorised'}</span><span className="tabular">{money(v)}</span></li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      )}
      <BudgetDialog key={editing?.id ?? 'new'} open={adding || Boolean(editing)} initial={editing} month={month} onOpenChange={(o) => { if (!o) { setAdding(false); setEditing(undefined) } }} />
      {active.length ? <p className="text-xs text-muted-foreground">Tap a budget to change or remove it. Changes apply from the chosen starting month.</p> : null}
    </div>
  )
}
