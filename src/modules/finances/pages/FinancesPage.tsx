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
import { accountsForSelection, type ChartSelection, groupOf, NET_WORTH_GROUPS, type NetWorthGroup, netWorth, netWorthDates, netWorthHistory, selectionKey, sheetPartHistory } from '../lib/calc'
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
  const [selected, setSelected] = useState<ChartSelection>(COMBINED)
  const currency = household.default_currency
  const today = todayISO()

  const derived = useMemo(() => {
    if (!accounts.data || !balances.data || !transactions.data || !snapshots.data) return null
    const nw = netWorth(accounts.data, balances.data)
    // From the first sheet snapshot (when recording began), one point per snapshot date plus today.
    const included = accounts.data.filter((a) => !a.archived_at && a.include_in_net_worth && a.currency === currency)
    const fromSheet = snapshots.data.some((s) => s.source === 'sheet')
    const dates = netWorthDates(snapshots.data, today)
    // Breakdown groups holding an estimated value (house, car): marked so they're never mistaken for a statement.
    const latest = new Map(snapshots.data.map((s) => [s.account_id, s])) // ordered by date: last wins
    const estimatedGroups = new Set(included.filter((a) => latest.get(a.id)?.source === 'estimate').map((a) => groupOf(a.account_type)))
    // Accounts made of several sheet rows: the rows of their latest sheet balance, largest first.
    const sheetParts = new Map<string, SheetPart[]>()
    for (const [accountId, s] of latest) {
      if (s.source === 'sheet' && Array.isArray(s.breakdown) && s.breakdown.length > 1) {
        sheetParts.set(accountId, (s.breakdown as SheetPart[]).toSorted((a, b) => b.balance_minor - a.balance_minor))
      }
    }
    return { nw, included, dates, fromSheet, estimatedGroups, sheetParts }
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
  const ownerName = (owner: string) => (owner === 'all' ? 'Combined' : owner === 'joint' ? 'Joint' : members.find((m) => m.id === owner)?.display_name ?? '')
  // The accounts behind a breakdown line, for the same currency and accounts the totals use.
  const accountsIn: GroupAccounts = (owner, group) =>
    accountsForSelection(derived.included, { kind: 'group', owner, group })
      .map((a) => {
        const owner = a.ownership === 'joint' ? 'joint' : (a.owner_id ?? 'joint')
        return { id: a.id, name: a.name, owner, ownerName: ownerName(owner), balance: balances.data!.get(a.id) ?? 0, parts: derived.sheetParts.get(a.id) ?? [] }
      })
      .filter((a) => a.balance !== 0)
      .sort((x, y) => y.balance - x.balance)

  // The chart follows whatever was last clicked in the boxes above.
  const accountName = (id: string) => accounts.data!.find((a) => a.id === id)?.name ?? ''
  const selectionTitle =
    selected.kind === 'owner' ? (selected.owner === 'all' ? 'Net worth' : `${ownerName(selected.owner)} net worth`)
    : selected.kind === 'group' ? `${ownerName(selected.owner)} · ${NET_WORTH_GROUPS.find((g) => g.key === selected.group)!.label}`
    : selected.kind === 'equity' ? 'Home equity'
    : selected.kind === 'account' ? accountName(selected.accountId)
    : `${selected.label} (in ${accountName(selected.accountId)})`
  const series = (
    selected.kind === 'part'
      ? sheetPartHistory(snapshots.data!, selected.accountId, selected.label, derived.dates)
      : netWorthHistory(accountsForSelection(derived.included, selected), snapshots.data!, transactions.data!, derived.dates)
  ).map((p) => ({ ...p, label: p.date === today ? 'Now' : format(parseISO(p.date), derived.fromSheet ? 'd MMM' : 'MMM') }))
  const pick: Pick<BreakdownProps, 'selectedKey' | 'onSelect'> = { selectedKey: selectionKey(selected), onSelect: setSelected }
  const isCombined = selected.kind === 'owner' && selected.owner === 'all'

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="col-span-2 p-4 lg:col-span-1">
          <BoxHeading owner="all" title="Combined" total={money(primary.total)} large {...pick} />
          {others.length ? <p className="mt-1 text-xs text-muted-foreground">Plus {others.map((o) => formatMoney(o.total, o.currency)).join(', ')} (not converted)</p> : null}
          <CombinedBreakdown groups={primary.byGroup.all} owner="all" accountsIn={accountsIn} money={money} estimated={derived.estimatedGroups} {...pick} />
        </Card>
        {members.map((m) => (
          <Card key={m.id} className="p-4">
            <BoxHeading owner={m.id} title={`${m.display_name}'s accounts`} total={money(primary.byOwner[m.id] ?? 0)} sub="personal net worth" {...pick} />
            <Breakdown groups={primary.byGroup[m.id]} owner={m.id} accountsIn={accountsIn} money={money} estimated={derived.estimatedGroups} {...pick} />
          </Card>
        ))}
        <Card className="p-4">
          <BoxHeading owner="joint" title="Joint" total={money(primary.byOwner.joint ?? 0)} sub="shared accounts" {...pick} />
          <Breakdown groups={primary.byGroup.joint} owner="joint" accountsIn={accountsIn} money={money} estimated={derived.estimatedGroups} {...pick} />
        </Card>
      </div>

      <div className="grid gap-4">
        <ChartCard
          title={`${selectionTitle} over time`}
          description={
            derived.fromSheet
              ? 'From your first sheet snapshot: the value on each snapshot date, plus today. Click anything above to chart it.'
              : 'Calculated at each month end from opening balances, transactions and recorded balances. Not a record of actual statements.'
          }
          action={isCombined ? undefined : <Button variant="ghost" size="sm" onClick={() => setSelected(COMBINED)}>Show combined</Button>}
          table={{ columns: ['Date', selectionTitle], rows: series.map((h) => [h.date, h.value === null ? '—' : money(h.value)]) }}
        >
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
                <YAxis {...axisProps} width={52} tickFormatter={compact} domain={['auto', 'auto']} />
                <Tooltip content={<ChartTooltip formatValue={money} />} />
                <Line dataKey="value" name={selectionTitle} stroke="var(--chart-1)" strokeWidth={2} strokeDasharray={derived.fromSheet ? undefined : '5 4'} dot={derived.fromSheet ? { r: 3.5, fill: 'var(--chart-1)', stroke: 'var(--card)', strokeWidth: 2 } : false} activeDot={{ r: 4, stroke: 'var(--card)', strokeWidth: 2 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>
    </div>
  )
}

const COMBINED: ChartSelection = { kind: 'owner', owner: 'all' }

type SheetPart = { label: string; balance_minor: number }
type GroupAccount = { id: string; name: string; owner: string; ownerName: string; balance: number; parts: SheetPart[] }
type GroupAccounts = (owner: string, group: NetWorthGroup) => GroupAccount[]
type BreakdownProps = {
  groups?: Partial<Record<NetWorthGroup, number>>
  /** 'all' for Combined, else 'joint' or a member id. */
  owner: string
  accountsIn: GroupAccounts
  money: (v: number) => string
  estimated: ReadonlySet<NetWorthGroup>
  /** The chart's current selection, and how to change it. */
  selectedKey: string
  onSelect: (s: ChartSelection) => void
}

/** A clickable row that charts `selection`; highlighted while it is the chart's selection. */
function Pickable({ selection, selectedKey, onSelect, className, children }: Pick<BreakdownProps, 'selectedKey' | 'onSelect'> & { selection: ChartSelection; className?: string; children: React.ReactNode }) {
  const active = selectionKey(selection) === selectedKey
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onSelect(selection)}
      className={cn('-mx-1 flex w-[calc(100%+0.5rem)] items-center justify-between gap-2 rounded px-1 text-left hover:bg-muted/60', active && 'bg-accent text-accent-foreground hover:bg-accent', className)}
    >
      {children}
    </button>
  )
}

function BoxHeading({ owner, title, total, sub, large, ...pick }: Pick<BreakdownProps, 'selectedKey' | 'onSelect'> & { owner: string; title: string; total: string; sub?: string; large?: boolean }) {
  return (
    <Pickable selection={{ kind: 'owner', owner }} {...pick} className="-mx-2 -my-1 w-[calc(100%+1rem)] flex-col items-start gap-0 px-2 py-1">
      <span className="text-xs font-medium text-muted-foreground">{title}</span>
      <span className={cn('mt-1 font-semibold tracking-tight tabular', large ? 'text-3xl' : 'text-2xl')}>{total}</span>
      {sub ? <span className="mt-0.5 text-xs text-muted-foreground">{sub}</span> : null}
    </Pickable>
  )
}

/** One breakdown line: clicking charts it and lists the accounts behind it (each also clickable), largest first. */
function GroupLine({ group, value, owner, accountsIn, money, estimated, ...pick }: Omit<BreakdownProps, 'groups'> & { group: NetWorthGroup; value: number }) {
  const [open, setOpen] = useState(false)
  const label = `${NET_WORTH_GROUPS.find((g) => g.key === group)!.label}${estimated.has(group) ? ' (est.)' : ''}`
  const accounts = open ? accountsIn(owner, group) : []
  const owners = owner === 'all' ? [...new Set(accounts.map((a) => a.owner))] : []
  return (
    <li>
      <Pickable selection={{ kind: 'group', owner, group }} selectedKey={pick.selectedKey} onSelect={(s) => { pick.onSelect(s); setOpen((o) => !o) }}>
        <span className="flex items-center gap-1 text-muted-foreground">
          <ChevronRight aria-hidden className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} />
          {label}
        </span>
        <span className={cn('tabular', value < 0 && 'text-destructive')}>{money(value)}</span>
      </Pickable>
      {open ? (
        <ul className="mb-1 ml-4 mt-0.5 grid gap-0.5 border-l pl-2">
          {owners.length > 1
            ? // Combined, with accounts from more than one person: a row per person, their accounts under it if several (or split into sheet rows).
              owners.map((o) => {
                const theirs = accounts.filter((a) => a.owner === o)
                const total = theirs.reduce((t, a) => t + a.balance, 0)
                return (
                  <li key={o}>
                    <Pickable selection={{ kind: 'group', owner: o, group }} {...pick}>
                      <span className="truncate text-muted-foreground">{theirs[0].ownerName}</span>
                      <span className={cn('tabular', total < 0 && 'text-destructive')}>{money(total)}</span>
                    </Pickable>
                    {theirs.length > 1 || theirs[0].parts.length ? <AccountRows accounts={theirs} money={money} {...pick} className="ml-3 border-l pl-2" /> : null}
                  </li>
                )
              })
            : <AccountRows accounts={accounts} money={money} {...pick} />}
        </ul>
      ) : null}
    </li>
  )
}

/** Accounts in a breakdown line (each clickable), and the sheet rows behind combined ones. */
function AccountRows({ accounts, money, className, ...pick }: Pick<BreakdownProps, 'money' | 'selectedKey' | 'onSelect'> & { accounts: GroupAccount[]; className?: string }) {
  const rows = accounts.map((a) => (
    <li key={a.id}>
      <Pickable selection={{ kind: 'account', accountId: a.id }} {...pick}>
        <span className="truncate text-muted-foreground">{a.name}</span>
        <span className={cn('tabular', a.balance < 0 && 'text-destructive')}>{money(a.balance)}</span>
      </Pickable>
      {a.parts.length ? (
        <ul className="ml-3 grid gap-0.5 border-l pl-2">
          {a.parts.map((p) => (
            <li key={p.label}>
              <Pickable selection={{ kind: 'part', accountId: a.id, label: p.label }} {...pick} className="text-muted-foreground/80">
                <span className="truncate">{p.label}</span>
                <span className="tabular">{money(p.balance_minor)}</span>
              </Pickable>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  ))
  return className ? <ul className={cn('grid gap-0.5', className)}>{rows}</ul> : <>{rows}</>
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
          <li>
            <Pickable selection={{ kind: 'equity' }} selectedKey={props.selectedKey} onSelect={props.onSelect} className="font-medium">
              <span className="pl-4">Equity{props.estimated.has('property') ? ' (est.)' : ''}</span>
              <span className={cn('tabular', equity < 0 && 'text-destructive')}>{props.money(equity)}</span>
            </Pickable>
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

