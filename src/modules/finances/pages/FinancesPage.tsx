import { format, parseISO } from 'date-fns'
import { ChevronRight, Plus, Wallet } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { axisProps, ChartCard, ChartTooltip, gridProps } from '@/components/charts'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState, ErrorState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc'
import { todayISO } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { AccountDialog, TransactionDialog } from '../components/forms'
import { useAccounts, useBalances, useSnapshots, useTransactions } from '../hooks'
import { groupOf, NET_WORTH_GROUPS, type NetWorthGroup, netWorth, netWorthDates, netWorthHistory } from '../lib/calc'
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
  const [addingAccount, setAddingAccount] = useState(false)
  const currency = household.default_currency
  const today = todayISO()

  const derived = useMemo(() => {
    if (!accounts.data || !balances.data || !transactions.data || !snapshots.data) return null
    const nw = netWorth(accounts.data, balances.data)
    // From the first sheet snapshot (when recording began), one point per snapshot date plus today.
    const included = accounts.data.filter((a) => !a.archived_at && a.include_in_net_worth && a.currency === currency)
    const fromSheet = snapshots.data.some((s) => s.source === 'sheet')
    const history = netWorthHistory(included, snapshots.data, transactions.data, netWorthDates(snapshots.data, today)).map((p) => ({
      ...p,
      label: p.date === today ? 'Now' : format(parseISO(p.date), fromSheet ? 'd MMM' : 'MMM'),
    }))
    // Breakdown groups holding an estimated value (house, car): marked so they're never mistaken for a statement.
    const latestSource = new Map(snapshots.data.map((s) => [s.account_id, s.source]))
    const estimatedGroups = new Set(included.filter((a) => latestSource.get(a.id) === 'estimate').map((a) => groupOf(a.account_type)))
    return { nw, history, fromSheet, estimatedGroups }
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
  const money = (v: number) => formatMoney(v, currency, { hidePence: true })
  const compact = (v: number) => formatMoney(v, currency, { compact: true })
  // The accounts behind a breakdown line, for the same currency and accounts the totals use.
  const accountsIn: GroupAccounts = (owner, group) =>
    accounts.data!
      .filter((a) => !a.archived_at && a.include_in_net_worth && a.currency === currency && groupOf(a.account_type) === group)
      .filter((a) => owner === 'all' || (a.ownership === 'joint' ? 'joint' : a.owner_id) === owner)
      .map((a) => ({ id: a.id, name: a.name, balance: balances.data!.get(a.id) ?? 0 }))
      .filter((a) => a.balance !== 0)
      .sort((x, y) => y.balance - x.balance)

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="col-span-2 p-4 lg:col-span-1">
          <p className="text-xs font-medium text-muted-foreground">Combined</p>
          <p className="mt-1 text-3xl font-semibold tracking-tight tabular">{money(primary.total)}</p>
          {others.length ? <p className="mt-1 text-xs text-muted-foreground">Plus {others.map((o) => formatMoney(o.total, o.currency)).join(', ')} (not converted)</p> : null}
          <CombinedBreakdown groups={primary.byGroup.all} owner="all" accountsIn={accountsIn} money={money} estimated={derived.estimatedGroups} />
        </Card>
        {members.map((m) => (
          <Card key={m.id} className="p-4">
            <p className="text-xs font-medium text-muted-foreground">{m.display_name}'s accounts</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight tabular">{money(primary.byOwner[m.id] ?? 0)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">personal net worth</p>
            <Breakdown groups={primary.byGroup[m.id]} owner={m.id} accountsIn={accountsIn} money={money} estimated={derived.estimatedGroups} />
          </Card>
        ))}
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground">Joint</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight tabular">{money(primary.byOwner.joint ?? 0)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">shared accounts</p>
          <Breakdown groups={primary.byGroup.joint} owner="joint" accountsIn={accountsIn} money={money} estimated={derived.estimatedGroups} />
        </Card>
      </div>

      <div className="grid gap-4">
        <ChartCard
          title="Net worth over time"
          description={
            derived.fromSheet
              ? 'From your first sheet snapshot: the total on each snapshot date, plus today. Includes estimated values for the house and car.'
              : 'Calculated at each month end from opening balances, transactions and recorded balances. Not a record of actual statements.'
          }
          table={{ columns: ['Date', 'Net worth'], rows: derived.history.map((h) => [h.date, h.value === null ? '—' : money(h.value)]) }}
        >
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={derived.history} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
                <YAxis {...axisProps} width={52} tickFormatter={compact} domain={['auto', 'auto']} />
                <Tooltip content={<ChartTooltip formatValue={money} />} />
                <Line dataKey="value" name="Net worth" stroke="var(--chart-1)" strokeWidth={2} strokeDasharray={derived.fromSheet ? undefined : '5 4'} dot={derived.fromSheet ? { r: 3.5, fill: 'var(--chart-1)', stroke: 'var(--card)', strokeWidth: 2 } : false} activeDot={{ r: 4, stroke: 'var(--card)', strokeWidth: 2 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>
    </div>
  )
}

type GroupAccounts = (owner: string, group: NetWorthGroup) => { id: string; name: string; balance: number }[]
type BreakdownProps = {
  groups?: Partial<Record<NetWorthGroup, number>>
  /** 'all' for Combined, else 'joint' or a member id. */
  owner: string
  accountsIn: GroupAccounts
  money: (v: number) => string
  estimated: ReadonlySet<NetWorthGroup>
}

/** One breakdown line; clicking it lists the accounts behind it, largest first. */
function GroupLine({ group, value, owner, accountsIn, money, estimated }: Omit<BreakdownProps, 'groups'> & { group: NetWorthGroup; value: number }) {
  const [open, setOpen] = useState(false)
  const label = `${NET_WORTH_GROUPS.find((g) => g.key === group)!.label}${estimated.has(group) ? ' (est.)' : ''}`
  const accounts = open ? accountsIn(owner, group) : []
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="-mx-1 flex w-[calc(100%+0.5rem)] items-center justify-between gap-2 rounded px-1 text-left hover:bg-muted/60"
      >
        <span className="flex items-center gap-1 text-muted-foreground">
          <ChevronRight className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} />
          {label}
        </span>
        <span className={cn('tabular', value < 0 && 'text-destructive')}>{money(value)}</span>
      </button>
      {open ? (
        <ul className="mb-1 ml-4 mt-0.5 grid gap-0.5 border-l pl-2">
          {accounts.map((a) => (
            <li key={a.id} className="flex justify-between gap-2">
              <span className="truncate text-muted-foreground">{a.name}</span>
              <span className={cn('tabular', a.balance < 0 && 'text-destructive')}>{money(a.balance)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

/** What a net worth figure is made of, largest first; empty groups are left out. */
function Breakdown({ groups, ...props }: BreakdownProps) {
  const rows = NET_WORTH_GROUPS.filter((g) => groups?.[g.key]).sort((a, b) => groups![b.key]! - groups![a.key]!)
  if (!rows.length) return null
  return (
    <ul className="mt-3 grid gap-1 border-t pt-3 text-xs">
      {rows.map((g) => <GroupLine key={g.key} group={g.key} value={groups![g.key]!} {...props} />)}
    </ul>
  )
}

/**
 * The Combined box: the home first (property, mortgage, and the equity between
 * them), then every other group from largest to smallest.
 */
function CombinedBreakdown({ groups = {}, ...props }: BreakdownProps) {
  const home = groups.property || groups.mortgage
  const equity = (groups.property ?? 0) + (groups.mortgage ?? 0)
  const rest = NET_WORTH_GROUPS.filter((g) => g.key !== 'property' && g.key !== 'mortgage' && groups[g.key])
    .map((g) => ({ key: g.key, value: groups[g.key]! }))
    .sort((a, b) => b.value - a.value)
  return (
    <>
      {home ? (
        <ul className="mt-3 grid gap-1 border-t pt-3 text-xs">
          {groups.property ? <GroupLine group="property" value={groups.property} {...props} /> : null}
          {groups.mortgage ? <GroupLine group="mortgage" value={groups.mortgage} {...props} /> : null}
          <li className="flex justify-between gap-2 font-medium">
            <span className="pl-4">Equity{props.estimated.has('property') ? ' (est.)' : ''}</span>
            <span className={cn('tabular', equity < 0 && 'text-destructive')}>{props.money(equity)}</span>
          </li>
        </ul>
      ) : null}
      {rest.length ? (
        <ul className="mt-3 grid gap-1 border-t pt-3 text-xs">
          {rest.map((r) => <GroupLine key={r.key} group={r.key} value={r.value} {...props} />)}
        </ul>
      ) : null}
    </>
  )
}

