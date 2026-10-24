import { ArrowLeft, BarChart3, Flame } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Avatar } from '@/components/Avatar'
import { axisProps, BarList, ChartCard, ChartTooltip, gridProps, ShareBar, StatTile } from '@/components/charts'
import { PageHeader } from '@/components/PageHeader'
import { RangePicker, type RangePreset, rangeFromPreset } from '@/components/RangePicker'
import { EmptyState, ErrorState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/misc'
import { formatDateTime, todayISO } from '@/lib/dates'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { usePersonSeries } from '@/modules/household/series'
import { useCompletionEvents, useStatsOccurrences, useTaskCategories } from '../hooks'
import { computeTaskStats } from '../lib/stats'

function formatHours(h: number | null) {
  if (h === null) return '—'
  if (h < 1) return `${Math.round(h * 60)} min`
  if (h < 48) return `${Math.round(h)} h`
  return `${Math.round(h / 24)} days`
}

export default function TaskStatsPage() {
  const { members, member } = useHousehold()
  const series = usePersonSeries()
  const [preset, setPreset] = useState<RangePreset>('3m')
  const [range, setRange] = useState(() => rangeFromPreset('3m'))
  const [personId, setPersonId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [taskId, setTaskId] = useState('')

  const events = useCompletionEvents()
  const occurrences = useStatsOccurrences(range.from)
  const categories = useTaskCategories()

  const memberIds = useMemo(() => members.map((m) => m.id), [members])
  const stats = useMemo(() => {
    if (!events.data || !occurrences.data) return null
    return computeTaskStats(
      events.data,
      occurrences.data,
      memberIds,
      { ...range, personId: personId || null, categoryId: categoryId || null, taskId: taskId || null },
      todayISO(),
    )
  }, [events.data, occurrences.data, memberIds, range, personId, categoryId, taskId])

  const recurringTasks = useMemo(() => {
    const map = new Map<string, string>()
    for (const e of events.data ?? []) if (e.is_recurring) map.set(e.task_id, e.task_title)
    return [...map].sort((a, b) => a[1].localeCompare(b[1]))
  }, [events.data])

  const error = events.error ?? occurrences.error
  const visibleSeries = personId ? series.filter((s) => s.key === personId) : series
  const useMonthly = stats ? stats.weekly.length > 16 : false
  const trend = stats ? (useMonthly ? stats.monthly : stats.weekly) : []
  const trendData = trend.map((t) => ({ label: t.label, ...Object.fromEntries(series.map((s) => [s.key, t.byPerson[s.key] ?? 0])) }))

  return (
    <>
      <PageHeader
        title="Task statistics"
        description="Who did what, calculated from the completion history."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/tasks">
              <ArrowLeft /> Tasks
            </Link>
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <RangePicker preset={preset} range={range} onChange={(p, r) => { setPreset(p); setRange(r) }} />
        <NativeSelect aria-label="Person" className="h-8 w-auto rounded-full text-sm" value={personId} onChange={(e) => setPersonId(e.target.value)}>
          <option value="">Everyone</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.display_name}</option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Category" className="h-8 w-auto rounded-full text-sm" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">All categories</option>
          {(categories.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </NativeSelect>
        <NativeSelect aria-label="Task" className="h-8 w-auto max-w-48 rounded-full text-sm" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
          <option value="">All tasks</option>
          {recurringTasks.map(([id, title]) => (
            <option key={id} value={id}>{title}</option>
          ))}
        </NativeSelect>
      </div>

      {error ? (
        <ErrorState error={error} onRetry={() => { events.refetch(); occurrences.refetch() }} />
      ) : !stats ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}
          <Skeleton className="h-72 sm:col-span-2 lg:col-span-4" />
        </div>
      ) : stats.totalCompleted === 0 && stats.overdue.total === 0 ? (
        <Card>
          <EmptyState icon={BarChart3} title="No completed tasks in this period" description="Statistics appear as soon as tasks are ticked off." />
        </Card>
      ) : (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Completed" value={stats.totalCompleted} sub={`${preset === 'custom' ? 'in range' : 'this period'}`} />
            {visibleSeries.map((s) => (
              <StatTile key={s.key} label={s.label} value={stats.completedByPerson[s.key] ?? 0} sub={`${stats.completedShare[s.key] ?? 0}% of completions`} />
            ))}
            <StatTile label="On time" value={stats.onTimeRate === null ? '—' : `${stats.onTimeRate}%`} sub="of tasks with a due date" />
            <StatTile label="Overdue now" value={stats.overdue.total} tone={stats.overdue.total ? 'danger' : undefined} sub="open and past due" />
            <StatTile label="Avg. time to complete" value={formatHours(stats.avgHoursToComplete)} sub="one-off tasks" />
          </div>

          <ChartCard
            title={useMonthly ? 'Monthly completions' : 'Weekly completions'}
            description="Completed occurrences, by who did them"
            legend={visibleSeries}
            table={{ columns: [useMonthly ? 'Month' : 'Week of', ...visibleSeries.map((s) => s.label)], rows: trendData.map((d) => [d.label, ...visibleSeries.map((s) => (d as Record<string, number | string>)[s.key] as number)]) }}
          >
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendData} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={16} />
                  <YAxis {...axisProps} allowDecimals={false} width={40} />
                  <Tooltip cursor={{ fill: 'var(--muted)', opacity: 0.6 }} content={<ChartTooltip />} />
                  {visibleSeries.map((s, i) => (
                    <Bar
                      key={s.key}
                      dataKey={s.key}
                      name={s.label}
                      stackId="people"
                      fill={s.color}
                      maxBarSize={24}
                      stroke="var(--card)"
                      strokeWidth={visibleSeries.length > 1 ? 2 : 0}
                      radius={i === visibleSeries.length - 1 ? [4, 4, 0, 0] : 0}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Responsibility vs. work done</CardTitle>
                  <p className="mt-0.5 text-xs text-muted-foreground">Assigned = work due in this period. Done = completions credited.</p>
                </div>
              </CardHeader>
              <CardContent className="grid gap-5">
                <ShareBar
                  label="Assigned"
                  segments={[
                    ...series.map((s) => ({ key: s.key, label: s.label, value: stats.responsibility.assignedByPerson[s.key] ?? 0, color: s.color })),
                    { key: 'none', label: 'Anyone', value: stats.responsibility.unassigned, color: 'var(--chart-estimate)' },
                  ]}
                />
                <ShareBar
                  label="Done"
                  segments={series.map((s) => ({ key: s.key, label: s.label, value: stats.completedByPerson[s.key] ?? 0, color: s.color }))}
                />
                <ul className="grid gap-1 text-sm">
                  {series.map((s) => (
                    <li key={s.key} className="flex justify-between gap-2 text-muted-foreground">
                      <span>{s.label} covered for someone else</span>
                      <span className="font-medium text-foreground tabular">{stats.responsibility.coveredForOther[s.key] ?? 0}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <ChartCard
              title="By category"
              legend={visibleSeries}
              table={{ columns: ['Category', ...visibleSeries.map((s) => s.label), 'Total'], rows: stats.byCategory.map((c) => [c.name, ...visibleSeries.map((s) => c.byPerson[s.key] ?? 0), c.total]) }}
            >
              {stats.byCategory.length ? (
                <BarList rows={stats.byCategory.map((c) => ({ key: c.key, label: c.name, values: c.byPerson }))} series={visibleSeries} />
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">No completions yet.</p>
              )}
            </ChartCard>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recurring tasks</CardTitle>
            </CardHeader>
            <CardContent>
              {stats.byRecurringTask.length ? (
                <div className="-mx-1 overflow-x-auto">
                  <table className="w-full text-sm tabular">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-1 py-1.5 font-medium">Task</th>
                        {visibleSeries.map((s) => (
                          <th key={s.key} className="px-1 py-1.5 text-right font-medium">{s.label}</th>
                        ))}
                        <th className="px-1 py-1.5 text-right font-medium">Total</th>
                        <th className="hidden px-1 py-1.5 text-right font-medium sm:table-cell">Last done</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.byRecurringTask.map((t) => {
                        const last = member(t.lastCompletedBy)
                        return (
                          <tr key={t.taskId} className="border-t">
                            <td className="max-w-48 truncate px-1 py-2">{t.title}</td>
                            {visibleSeries.map((s) => (
                              <td key={s.key} className="px-1 py-2 text-right">{t.byPerson[s.key] ?? 0}</td>
                            ))}
                            <td className="px-1 py-2 text-right font-medium">{t.total}</td>
                            <td className="hidden px-1 py-2 text-right text-muted-foreground sm:table-cell">
                              <span className="inline-flex items-center gap-1.5">
                                <Avatar name={last?.display_name} color={last?.avatar_color} size="xs" />
                                {formatDateTime(t.lastCompletedAt)}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">No recurring tasks completed in this period.</p>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {members.map((m) => (
              <Card key={m.id} className="col-span-2 flex items-center gap-4 p-4">
                <div className="grid size-11 place-items-center rounded-full bg-orange-500/12 text-orange-600 dark:text-orange-400">
                  <Flame className="size-5" />
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{m.display_name}'s streak</p>
                  <p className="text-xl font-semibold tabular">
                    {stats.streaks[m.id]?.current ?? 0} {stats.streaks[m.id]?.current === 1 ? 'day' : 'days'}
                  </p>
                  <p className="text-xs text-muted-foreground">Longest: {stats.streaks[m.id]?.longest ?? 0} days in a row</p>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
