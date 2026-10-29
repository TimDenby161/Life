import { endOfMonth, format, parseISO, startOfISOWeek, subMonths } from 'date-fns'
import { ArrowRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { axisProps, ChartCard, ChartTooltip, gridProps, ShareBar, StatTile } from '@/components/charts'
import { PageHeader } from '@/components/PageHeader'
import { Segmented, Skeleton } from '@/components/ui/misc'
import { addDaysISO, todayISO, toISODate } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import { pct } from '@/lib/utils'
import { usePosts } from '@/modules/feed/hooks'
import { useAccountCurrency, useAccounts, useGoals, useBalances, useSnapshots, useTransactions } from '@/modules/finances/hooks'
import { balanceOn, goalProgress, monthlyFlows } from '@/modules/finances/lib/calc'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { usePersonSeries } from '@/modules/household/series'
import { useCompletionEvents, useStatsOccurrences, useTaskCategories, useTaskLists } from '@/modules/tasks/hooks'
import { ownerOf } from '@/modules/tasks/lib/owner'
import { computeTaskStats } from '@/modules/tasks/lib/stats'

type Period = '3m' | '12m'
type Scope = 'joint' | 'all'

export default function StatsPage() {
  const { members, household } = useHousehold()
  const series = usePersonSeries()
  const [period, setPeriod] = useState<Period>('3m')
  // Task figures default to joint tasks only (same ownership rule as the Tasks page).
  const [scope, setScope] = useState<Scope>('joint')
  const months = period === '3m' ? 3 : 12
  const today = todayISO()
  const from = toISODate(subMonths(parseISO(today), months))
  const currency = household.default_currency
  const money = (v: number) => formatMoney(v, currency, { hidePence: true })

  const events = useCompletionEvents()
  const occurrences = useStatsOccurrences(from)
  const categories = useTaskCategories()
  const lists = useTaskLists()
  const transactions = useTransactions()
  const accounts = useAccounts()
  const snapshots = useSnapshots()
  const balances = useBalances()
  const goals = useGoals()
  const posts = usePosts()
  const accountCurrency = useAccountCurrency()
  const memberIds = useMemo(() => members.map((m) => m.id), [members])

  const tasks = useMemo(() => {
    if (!events.data || !occurrences.data) return null
    const inScope = (task: { category_id: string | null; list_id: string | null }) =>
      scope === 'all' || ownerOf(task, categories.data ?? [], lists.data ?? []) === null
    return computeTaskStats(
      events.data.filter(inScope),
      occurrences.data.filter((o) => o.task && inScope(o.task)),
      memberIds,
      { from, to: today },
      today,
    )
  }, [events.data, occurrences.data, categories.data, lists.data, scope, memberIds, from, today])
  const trend = (tasks ? (period === '12m' ? tasks.monthly : tasks.weekly) : []).map((t) => ({ label: t.label, ...Object.fromEntries(series.map((s) => [s.key, t.byPerson[s.key] ?? 0])) }))

  const flows = useMemo(() => (transactions.data ? monthlyFlows(transactions.data, accountCurrency, currency, months, today) : null), [transactions.data, accountCurrency, currency, months, today])
  const avgSpend = flows?.length ? Math.round(flows.reduce((s, f) => s + f.spending, 0) / flows.length) : 0

  // Savings = savings + investment accounts (calculated month-end balances).
  const savingsTrend = useMemo(() => {
    if (!accounts.data || !snapshots.data || !transactions.data) return null
    const savings = accounts.data.filter((a) => !a.archived_at && a.currency === currency && ['savings', 'investment', 'pension'].includes(a.account_type))
    return Array.from({ length: months + 1 }, (_, i) => {
      const date = i === months ? today : toISODate(endOfMonth(subMonths(parseISO(today), months - i)))
      const joint = savings.filter((a) => a.ownership === 'joint').reduce((s, a) => s + (balanceOn(a, snapshots.data!, transactions.data!, date) ?? 0), 0)
      const all = savings.reduce((s, a) => s + (balanceOn(a, snapshots.data!, transactions.data!, date) ?? 0), 0)
      return { label: i === months ? 'Now' : format(parseISO(date), 'MMM'), joint, all }
    })
  }, [accounts.data, snapshots.data, transactions.data, currency, months, today])

  const messagesPerWeek = useMemo(() => {
    const weeks: { key: string; label: string; [k: string]: number | string }[] = []
    for (let d = toISODate(startOfISOWeek(parseISO(addDaysISO(today, -7 * 11)))); d <= today; d = addDaysISO(d, 7)) {
      weeks.push({ key: d, label: format(parseISO(d), 'd MMM'), ...Object.fromEntries(series.map((s) => [s.key, 0])) })
    }
    for (const p of posts.data ?? []) {
      const wk = toISODate(startOfISOWeek(new Date(p.created_at)))
      const row = weeks.find((w) => w.key === wk)
      if (row && p.author_id in row) row[p.author_id] = (row[p.author_id] as number) + 1
    }
    return weeks
  }, [posts.data, series, today])

  const ready = tasks && flows && savingsTrend
  return (
    <>
      <PageHeader
        title="Statistics"
        description="How the household is running, from what you've actually recorded."
        actions={
          <div className="flex flex-wrap gap-2">
            <Segmented aria-label="Which tasks" size="sm" value={scope} onChange={setScope} options={[{ value: 'joint', label: 'Joint tasks' }, { value: 'all', label: 'All tasks' }]} />
            <Segmented aria-label="Period" size="sm" value={period} onChange={setPeriod} options={[{ value: '3m', label: '3 months' }, { value: '12m', label: '12 months' }]} />
          </div>
        }
      />
      {!ready ? (
        <div className="grid gap-4 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-72" />)}</div>
      ) : (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Tasks completed" value={tasks.totalCompleted} sub={series.map((s) => `${s.label} ${tasks.completedShare[s.key] ?? 0}%`).join(' · ')} />
            <StatTile label="On time" value={tasks.onTimeRate === null ? '—' : `${tasks.onTimeRate}%`} sub="of dated tasks" />
            <StatTile label="Average monthly spending" value={money(avgSpend)} sub={`${currency}, transfers excluded`} />
            <StatTile label="Savings now" value={money(savingsTrend.at(-1)?.all ?? 0)} sub={`${money(savingsTrend.at(-1)?.joint ?? 0)} joint`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Tasks completed"
              description={period === '12m' ? 'Per month, by who did them' : 'Per week, by who did them'}
              legend={series}
              table={{ columns: ['Period', ...series.map((s) => s.label)], rows: trend.map((t) => [t.label, ...series.map((s) => (t as Record<string, number | string>)[s.key] as number)]) }}
              action={<Link to="/tasks/stats" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">Details <ArrowRight className="size-3" /></Link>}
            >
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trend} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={16} />
                    <YAxis {...axisProps} allowDecimals={false} width={40} />
                    <Tooltip cursor={{ fill: 'var(--muted)', opacity: 0.6 }} content={<ChartTooltip />} />
                    {series.map((s, i) => (
                      <Bar key={s.key} dataKey={s.key} name={s.label} stackId="p" fill={s.color} maxBarSize={24} stroke="var(--card)" strokeWidth={2} radius={i === series.length - 1 ? [4, 4, 0, 0] : 0} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            <ChartCard title="Who carries the load" description="Work assigned vs work actually done in this period">
              <div className="grid gap-5 pt-2">
                <ShareBar label="Assigned" segments={[...series.map((s) => ({ key: s.key, label: s.label, value: tasks.responsibility.assignedByPerson[s.key] ?? 0, color: s.color })), { key: 'none', label: 'Anyone', value: tasks.responsibility.unassigned, color: 'var(--chart-estimate)' }]} />
                <ShareBar label="Done" segments={series.map((s) => ({ key: s.key, label: s.label, value: tasks.completedByPerson[s.key] ?? 0, color: s.color }))} />
                <p className="text-xs text-muted-foreground">
                  {series.map((s) => `${s.label} covered ${tasks.responsibility.coveredForOther[s.key] ?? 0} of someone else's tasks`).join(' · ')}.{' '}
                  {tasks.overdue.total ? `${tasks.overdue.total} ${tasks.overdue.total === 1 ? 'task is' : 'tasks are'} overdue right now.` : 'Nothing overdue.'}
                </p>
              </div>
            </ChartCard>

            <ChartCard
              title="Household spending"
              description={`Per month · ${currency} · transfers excluded`}
              table={{ columns: ['Month', 'Spending', 'Income'], rows: flows.map((f) => [f.month, money(f.spending), money(f.income)]) }}
            >
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={flows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
                    <YAxis {...axisProps} width={52} tickFormatter={(v) => formatMoney(v, currency, { compact: true })} />
                    <Tooltip cursor={{ fill: 'var(--muted)', opacity: 0.6 }} content={<ChartTooltip formatValue={money} />} />
                    <Bar dataKey="spending" name="Spending" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={24} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            <ChartCard
              title="Savings & investments"
              description="Calculated month-end balances of savings, investment and pension accounts"
              legend={[{ key: 'all', label: 'All', color: 'var(--chart-3)', dashed: true }, { key: 'joint', label: 'Joint', color: 'var(--chart-1)', dashed: true }]}
              table={{ columns: ['Month end', 'All (calculated)', 'Joint (calculated)'], rows: savingsTrend.map((s) => [s.label, money(s.all), money(s.joint)]) }}
            >
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={savingsTrend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" />
                    <YAxis {...axisProps} width={52} tickFormatter={(v) => formatMoney(v, currency, { compact: true })} />
                    <Tooltip content={<ChartTooltip formatValue={money} />} />
                    <Line dataKey="all" name="All" stroke="var(--chart-3)" strokeWidth={2} strokeDasharray="5 4" dot={false} />
                    <Line dataKey="joint" name="Joint" stroke="var(--chart-1)" strokeWidth={2} strokeDasharray="5 4" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {goals.data?.length && balances.data ? (
                <ul className="mt-3 grid gap-1 text-xs text-muted-foreground">
                  {goals.data.map((g) => {
                    const p = goalProgress(g, balances.data!)
                    return <li key={g.id} className="flex justify-between"><span>{g.name}</span><span className="tabular">{p.pct}% of {formatMoney(g.target_minor, g.currency, { hidePence: true })}</span></li>
                  })}
                </ul>
              ) : null}
            </ChartCard>

            <ChartCard
              title="Messages"
              description="Posts to the feed per week (last 12 weeks)"
              legend={series}
              className="lg:col-span-2"
              table={{ columns: ['Week of', ...series.map((s) => s.label)], rows: messagesPerWeek.map((w) => [w.label as string, ...series.map((s) => w[s.key] as number)]) }}
            >
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={messagesPerWeek} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barGap={2}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={16} />
                    <YAxis {...axisProps} allowDecimals={false} width={40} />
                    <Tooltip cursor={{ fill: 'var(--muted)', opacity: 0.6 }} content={<ChartTooltip />} />
                    {series.map((s) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={12} />)}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>
          </div>
          <p className="text-xs text-muted-foreground">
            Completion share: {series.map((s) => `${s.label} ${pct(tasks.completedByPerson[s.key] ?? 0, tasks.totalCompleted)}%`).join(', ')}. Health data is not included here: it stays in the Health section under each person's sharing settings.
          </p>
        </div>
      )}
    </>
  )
}
