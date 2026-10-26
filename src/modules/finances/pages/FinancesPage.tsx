import { endOfMonth, format, parseISO, subMonths } from 'date-fns'
import { Plus, Wallet } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { axisProps, BarList, ChartCard, ChartTooltip, gridProps } from '@/components/charts'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState, ErrorState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc'
import { monthStart, todayISO, toISODate } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { AccountDialog, TransactionDialog } from '../components/forms'
import { useAccounts, useBalances, useBudgets, useFinanceCategories, useGoals, useSnapshots, useTransactions } from '../hooks'
import { activeBudgets, balanceOn, goalProgress, monthlyFlows, groupOf, NET_WORTH_GROUPS, type NetWorthGroup, netWorth, spendingByCategory } from '../lib/calc'
import { AccountsTab } from './AccountsTab'
import { BudgetsTab } from './BudgetsTab'
import { GoalsTab } from './GoalsTab'
import { TransactionsTab } from './TransactionsTab'

const TABS = ['overview', 'transactions', 'accounts', 'budgets', 'goals'] as const
type Tab = (typeof TABS)[number]

export default function FinancesPage() {
  const [params, setParams] = useSearchParams()
  const tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'overview'
  const [adding, setAdding] = useState(false)

  return (
    <>
      <PageHeader
        title="Finances"
        description="Manually tracked. Both of you see the whole picture."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus /> Transaction
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setParams((p) => { p.set('tab', v); return p }, { replace: true })}>
        <TabsList className="max-w-full">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="budgets">Budgets</TabsTrigger>
          <TabsTrigger value="goals">Goals</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><Overview /></TabsContent>
        <TabsContent value="transactions"><TransactionsTab /></TabsContent>
        <TabsContent value="accounts"><AccountsTab /></TabsContent>
        <TabsContent value="budgets"><BudgetsTab /></TabsContent>
        <TabsContent value="goals"><GoalsTab /></TabsContent>
      </Tabs>
      <TransactionDialog open={adding} onOpenChange={setAdding} />
    </>
  )
}

function Overview() {
  const { members, household } = useHousehold()
  const accounts = useAccounts()
  const balances = useBalances()
  const transactions = useTransactions()
  const snapshots = useSnapshots()
  const categories = useFinanceCategories()
  const budgets = useBudgets()
  const goals = useGoals()
  const [addingAccount, setAddingAccount] = useState(false)
  const currency = household.default_currency
  const today = todayISO()

  const derived = useMemo(() => {
    if (!accounts.data || !balances.data || !transactions.data || !snapshots.data) return null
    const accountCurrency = new Map(accounts.data.map((a) => [a.id, a.currency]))
    const nw = netWorth(accounts.data, balances.data)
    const flows = monthlyFlows(transactions.data, accountCurrency, currency, 12, today)
    const month = monthStart(today)
    const spend = spendingByCategory(transactions.data, accountCurrency, currency, month, today)
    // Net worth history is calculated (month-end balances), never "recorded".
    const included = accounts.data.filter((a) => !a.archived_at && a.include_in_net_worth && a.currency === currency)
    const history = Array.from({ length: 12 }, (_, i) => {
      const date = i === 11 ? today : toISODate(endOfMonth(subMonths(parseISO(today), 11 - i)))
      let total = 0
      let any = false
      for (const a of included) {
        const b = balanceOn(a, snapshots.data!, transactions.data!, date)
        if (b !== null) { total += b; any = true }
      }
      return { date, label: i === 11 ? 'Now' : format(parseISO(date), 'MMM'), value: any ? total : null }
    })
    // Breakdown groups holding an estimated value (house, car): marked so they're never mistaken for a statement.
    const latestSource = new Map(snapshots.data.map((s) => [s.account_id, s.source]))
    const estimatedGroups = new Set(included.filter((a) => latestSource.get(a.id) === 'estimate').map((a) => groupOf(a.account_type)))
    return { nw, flows, spend, history, month, estimatedGroups }
  }, [accounts.data, balances.data, transactions.data, snapshots.data, currency, today])

  const error = accounts.error ?? balances.error ?? transactions.error ?? snapshots.error
  if (error) return <ErrorState error={error} onRetry={() => { accounts.refetch(); balances.refetch(); transactions.refetch() }} />
  if (!derived) return <div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}<Skeleton className="h-72 sm:col-span-3" /></div>
  if (!accounts.data!.length) {
    return (
      <Card>
        <EmptyState
          icon={Wallet}
          title="Add your first account"
          description="Start with your current accounts and savings. You can record balances and transactions manually."
          action={<Button onClick={() => setAddingAccount(true)}><Plus /> Add account</Button>}
        />
        <AccountDialog open={addingAccount} onOpenChange={setAddingAccount} />
      </Card>
    )
  }

  const primary = derived.nw.find((n) => n.currency === currency) ?? { currency, total: 0, assets: 0, liabilities: 0, byOwner: {}, byGroup: {} }
  const others = derived.nw.filter((n) => n.currency !== currency)
  const thisMonth = derived.flows.at(-1)!
  const catName = new Map((categories.data ?? []).map((c) => [c.id, c.name]))
  const spendRows = [...derived.spend.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ key: k, label: catName.get(k) ?? 'Uncategorised', values: { spend: v } }))
  const money = (v: number) => formatMoney(v, currency, { hidePence: true })
  const compact = (v: number) => formatMoney(v, currency, { compact: true })
  const monthBudgets = activeBudgets((budgets.data ?? []).filter((b) => b.currency === currency), derived.month)

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="col-span-2 p-4 lg:col-span-1">
          <p className="text-xs font-medium text-muted-foreground">Combined net worth</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight tabular">{money(primary.total)}</p>
          <p className="mt-1 text-xs text-muted-foreground tabular">
            {money(primary.assets)} assets · {money(-primary.liabilities)} owed
          </p>
          {others.length ? <p className="mt-1 text-xs text-muted-foreground">Plus {others.map((o) => formatMoney(o.total, o.currency)).join(', ')} (not converted)</p> : null}
          <Breakdown groups={primary.byGroup.all} money={money} estimated={derived.estimatedGroups} />
        </Card>
        {members.map((m) => (
          <Card key={m.id} className="p-4">
            <p className="text-xs font-medium text-muted-foreground">{m.display_name}'s accounts</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight tabular">{money(primary.byOwner[m.id] ?? 0)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">personal net worth</p>
            <Breakdown groups={primary.byGroup[m.id]} money={money} estimated={derived.estimatedGroups} />
          </Card>
        ))}
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Joint</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight tabular">{money(primary.byOwner.joint ?? 0)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">shared accounts</p>
          <Breakdown groups={primary.byGroup.joint} money={money} estimated={derived.estimatedGroups} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Income and spending"
          description={`Last 12 months · transfers excluded · ${currency}`}
          legend={[{ key: 'income', label: 'Income', color: 'var(--chart-1)' }, { key: 'spending', label: 'Spending', color: 'var(--chart-2)' }]}
          table={{ columns: ['Month', 'Income', 'Spending', 'Net'], rows: derived.flows.map((f) => [f.month, money(f.income), money(f.spending), money(f.net)]) }}
        >
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={derived.flows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={2}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
                <YAxis {...axisProps} width={52} tickFormatter={compact} />
                <Tooltip cursor={{ fill: 'var(--muted)', opacity: 0.6 }} content={<ChartTooltip formatValue={money} />} />
                <Bar dataKey="income" name="Income" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={14} />
                <Bar dataKey="spending" name="Spending" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard
          title="Net worth over time"
          description="Calculated at each month end from opening balances, transactions and recorded balances. Not a record of actual statements."
          table={{ columns: ['Month end', 'Net worth (calculated)'], rows: derived.history.map((h) => [h.date, h.value === null ? '—' : money(h.value)]) }}
        >
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={derived.history} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
                <YAxis {...axisProps} width={52} tickFormatter={compact} domain={['auto', 'auto']} />
                <Tooltip content={<ChartTooltip formatValue={money} />} />
                <Line dataKey="value" name="Net worth (calculated)" stroke="var(--chart-1)" strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4, stroke: 'var(--card)', strokeWidth: 2 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>This month</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <Row label="Income" value={money(thisMonth.income)} />
            <Row label="Spending" value={money(thisMonth.spending)} />
            <Row label="Net" value={formatMoney(thisMonth.net, currency, { hidePence: true, signed: true })} strong />
          </CardContent>
        </Card>
        <ChartCard title="Spending by category" description="This month" className="lg:col-span-2" table={{ columns: ['Category', 'Spent'], rows: spendRows.map((r) => [r.label, money(r.values.spend)]) }}>
          {spendRows.length ? (
            <BarList rows={spendRows.slice(0, 8)} series={[{ key: 'spend', label: 'Spent', color: 'var(--chart-2)' }]} formatValue={money} />
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">No spending recorded this month.</p>
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Budgets this month</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            {monthBudgets.length ? (
              monthBudgets.map((b) => {
                const spent = derived.spend.get(b.category_id) ?? 0
                const over = spent > b.amount_minor
                return (
                  <div key={b.id}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span>{catName.get(b.category_id)}</span>
                      <span className={over ? 'font-medium text-destructive tabular' : 'text-muted-foreground tabular'}>
                        {money(spent)} / {money(b.amount_minor)}
                      </span>
                    </div>
                    <Progress value={(spent / b.amount_minor) * 100} indicatorClassName={over ? 'bg-destructive' : undefined} />
                  </div>
                )
              })
            ) : (
              <p className="text-sm text-muted-foreground">No budgets set yet.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Savings goals</CardTitle></CardHeader>
          <CardContent className="grid gap-3">
            {goals.data?.length ? (
              goals.data.map((g) => {
                const { saved, pct } = goalProgress(g, balances.data!)
                return (
                  <div key={g.id}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span>{g.name}{g.reached_at ? ' 🎉' : ''}</span>
                      <span className="text-muted-foreground tabular">{formatMoney(saved, g.currency, { hidePence: true })} / {formatMoney(g.target_minor, g.currency, { hidePence: true })}</span>
                    </div>
                    <Progress value={pct} indicatorClassName={pct >= 100 ? 'bg-success' : undefined} />
                  </div>
                )
              })
            ) : (
              <p className="text-sm text-muted-foreground">No savings goals yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

/** What a net worth figure is made of, in NET_WORTH_GROUPS order; empty groups are left out. */
function Breakdown({ groups, money, estimated }: { groups?: Partial<Record<NetWorthGroup, number>>; money: (v: number) => string; estimated: ReadonlySet<NetWorthGroup> }) {
  const rows = NET_WORTH_GROUPS.filter((g) => groups?.[g.key])
  if (!rows.length) return null
  return (
    <ul className="mt-3 grid gap-1 border-t pt-3 text-xs">
      {rows.map((g) => (
        <li key={g.key} className="flex justify-between gap-2">
          <span className="text-muted-foreground">
            {g.label}
            {estimated.has(g.key) ? ' (est.)' : ''}
          </span>
          <span className={cn('tabular', groups![g.key]! < 0 && 'text-destructive')}>{money(groups![g.key]!)}</span>
        </li>
      ))}
    </ul>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? 'font-semibold tabular' : 'tabular'}>{value}</span>
    </div>
  )
}
