// Task statistics, computed from stored history only.
//
// Counting rules (documented in docs/ARCHITECTURE.md):
// * The unit of work is an occurrence. An occurrence counts as completed when
//   its most recent history event is "completed"; complete -> reopen ->
//   complete therefore counts once, and a recurring task counts once per week
//   it was done (never double-counted).
// * Credit goes to completed_by (who did it), which can differ from the
//   assignee (who was responsible). Both views are reported separately.
// * Skipped occurrences are neither completed nor overdue.
import { differenceInMinutes, format, parseISO, startOfISOWeek, startOfMonth } from 'date-fns'
import { addDaysISO, daysBetween, type ISODate, toISODate } from '@/lib/dates'
import { pct } from '@/lib/utils'

export type StatsEvent = {
  id: string
  occurrence_id: string
  task_id: string
  event_type: string
  completed_by: string | null
  occurred_at: string
  recorded_at: string
  task_title: string
  category_id: string | null
  category_name: string | null
  assignee_id: string | null
  due_date: string | null
  is_recurring: boolean
  occurrence_created_at: string | null
}

export type StatsOccurrenceInput = {
  id: string
  task_id: string
  due_date: string | null
  status: string
  assignee_id: string | null
  created_at: string
  task: { title: string; category_id: string | null; recurrence: unknown; archived_at: string | null } | null
}

export type StatsFilters = {
  from: ISODate
  to: ISODate
  personId?: string | null
  categoryId?: string | null
  taskId?: string | null
}

export type Completion = {
  occurrenceId: string
  taskId: string
  title: string
  personId: string
  assigneeId: string | null
  categoryId: string | null
  categoryName: string | null
  isRecurring: boolean
  day: ISODate
  completedAt: string
  dueDate: ISODate | null
  occurrenceCreatedAt: string | null
}

/** Reduce the append-only log to the current state of each occurrence. */
export function effectiveCompletions(events: readonly StatsEvent[]): Completion[] {
  const latest = new Map<string, StatsEvent>()
  for (const e of events) {
    const prev = latest.get(e.occurrence_id)
    if (!prev || e.recorded_at >= prev.recorded_at) latest.set(e.occurrence_id, e)
  }
  const out: Completion[] = []
  for (const e of latest.values()) {
    if (e.event_type !== 'completed' || !e.completed_by) continue
    out.push({
      occurrenceId: e.occurrence_id,
      taskId: e.task_id,
      title: e.task_title,
      personId: e.completed_by,
      assigneeId: e.assignee_id,
      categoryId: e.category_id,
      categoryName: e.category_name,
      isRecurring: e.is_recurring,
      day: toISODate(parseISO(e.occurred_at)),
      completedAt: e.occurred_at,
      dueDate: e.due_date,
      occurrenceCreatedAt: e.occurrence_created_at,
    })
  }
  return out.sort((a, b) => a.completedAt.localeCompare(b.completedAt))
}

export type PersonCount = Record<string, number>

export type TaskStats = {
  totalCompleted: number
  completedByPerson: PersonCount
  completedShare: PersonCount
  onTimeRate: number | null
  avgHoursToComplete: number | null
  avgHoursByPerson: Record<string, number | null>
  byCategory: { key: string; name: string; total: number; byPerson: PersonCount }[]
  byRecurringTask: {
    taskId: string
    title: string
    total: number
    byPerson: PersonCount
    lastCompletedAt: string
    lastCompletedBy: string
  }[]
  weekly: { key: string; label: string; total: number; byPerson: PersonCount }[]
  monthly: { key: string; label: string; total: number; byPerson: PersonCount }[]
  overdue: { total: number; byAssignee: PersonCount }
  responsibility: {
    assignedByPerson: PersonCount
    unassigned: number
    completedOwn: PersonCount
    coveredForOther: PersonCount
  }
  streaks: Record<string, { current: number; longest: number }>
}

function inc(map: PersonCount, key: string, by = 1) {
  map[key] = (map[key] ?? 0) + by
}

function matches(c: Completion, f: StatsFilters) {
  return (
    c.day >= f.from &&
    c.day <= f.to &&
    (!f.personId || c.personId === f.personId) &&
    (!f.categoryId || c.categoryId === f.categoryId) &&
    (!f.taskId || c.taskId === f.taskId)
  )
}

export function streaksFor(days: Iterable<ISODate>, today: ISODate): { current: number; longest: number } {
  const sorted = [...new Set(days)].sort()
  let longest = 0
  let run = 0
  let prev: ISODate | null = null
  for (const d of sorted) {
    run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1
    longest = Math.max(longest, run)
    prev = d
  }
  // A streak is still "current" if the last active day was today or yesterday.
  const last = sorted.at(-1)
  const current = last && daysBetween(last, today) <= 1 ? run : 0
  return { current, longest }
}

export function computeTaskStats(
  events: readonly StatsEvent[],
  occurrences: readonly StatsOccurrenceInput[],
  memberIds: readonly string[],
  filters: StatsFilters,
  today: ISODate,
): TaskStats {
  const all = effectiveCompletions(events)
  const completions = all.filter((c) => matches(c, filters))

  const completedByPerson: PersonCount = Object.fromEntries(memberIds.map((id) => [id, 0]))
  for (const c of completions) inc(completedByPerson, c.personId)
  const total = completions.length
  const completedShare = Object.fromEntries(Object.entries(completedByPerson).map(([k, v]) => [k, pct(v, total)]))

  const dated = completions.filter((c) => c.dueDate)
  const onTime = dated.filter((c) => c.day <= c.dueDate!).length
  const onTimeRate = dated.length ? pct(onTime, dated.length) : null

  // Time to complete is meaningful for one-off tasks (recurring occurrences are
  // created ahead of time, so their age says nothing about effort).
  const durations = (subset: Completion[]) => {
    const hours = subset
      .filter((c) => !c.isRecurring && c.occurrenceCreatedAt)
      .map((c) => differenceInMinutes(parseISO(c.completedAt), parseISO(c.occurrenceCreatedAt!)) / 60)
      .filter((h) => h >= 0)
    return hours.length ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10 : null
  }
  const avgHoursByPerson = Object.fromEntries(
    memberIds.map((id) => [id, durations(completions.filter((c) => c.personId === id))]),
  )

  const categories = new Map<string, TaskStats['byCategory'][number]>()
  for (const c of completions) {
    const key = c.categoryId ?? 'none'
    const row = categories.get(key) ?? { key, name: c.categoryName ?? 'Uncategorised', total: 0, byPerson: {} }
    row.total++
    inc(row.byPerson, c.personId)
    categories.set(key, row)
  }

  const recurring = new Map<string, TaskStats['byRecurringTask'][number]>()
  for (const c of completions) {
    if (!c.isRecurring) continue
    const row = recurring.get(c.taskId) ?? {
      taskId: c.taskId,
      title: c.title,
      total: 0,
      byPerson: {},
      lastCompletedAt: c.completedAt,
      lastCompletedBy: c.personId,
    }
    row.total++
    inc(row.byPerson, c.personId)
    if (c.completedAt >= row.lastCompletedAt) {
      row.lastCompletedAt = c.completedAt
      row.lastCompletedBy = c.personId
      row.title = c.title
    }
    recurring.set(c.taskId, row)
  }

  // Trend buckets cover the whole range, including empty weeks/months.
  const weekly: TaskStats['weekly'] = []
  const weekIndex = new Map<string, number>()
  for (let d = toISODate(startOfISOWeek(parseISO(filters.from))); d <= filters.to; d = addDaysISO(d, 7)) {
    weekIndex.set(d, weekly.length)
    weekly.push({ key: d, label: format(parseISO(d), 'd MMM'), total: 0, byPerson: {} })
  }
  const monthly: TaskStats['monthly'] = []
  const monthIndex = new Map<string, number>()
  for (let m = startOfMonth(parseISO(filters.from)); toISODate(m) <= filters.to; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
    const key = toISODate(m).slice(0, 7)
    monthIndex.set(key, monthly.length)
    monthly.push({ key, label: format(m, 'MMM yy'), total: 0, byPerson: {} })
  }
  for (const c of completions) {
    const w = weekly[weekIndex.get(toISODate(startOfISOWeek(parseISO(c.day))))!]
    if (w) {
      w.total++
      inc(w.byPerson, c.personId)
    }
    const m = monthly[monthIndex.get(c.day.slice(0, 7))!]
    if (m) {
      m.total++
      inc(m.byPerson, c.personId)
    }
  }

  // Responsibility: who was assigned work due in the range vs who did it.
  const relevant = occurrences.filter(
    (o) =>
      o.task &&
      !o.task.archived_at &&
      o.status !== 'skipped' &&
      (!filters.categoryId || o.task.category_id === filters.categoryId) &&
      (!filters.taskId || o.task_id === filters.taskId),
  )
  const assignedByPerson: PersonCount = Object.fromEntries(memberIds.map((id) => [id, 0]))
  let unassigned = 0
  for (const o of relevant) {
    const day = o.due_date ?? toISODate(parseISO(o.created_at))
    if (day < filters.from || day > filters.to) continue
    if (o.assignee_id) inc(assignedByPerson, o.assignee_id)
    else unassigned++
  }
  const completedOwn: PersonCount = {}
  const coveredForOther: PersonCount = {}
  for (const c of completions) {
    if (!c.assigneeId) continue
    if (c.assigneeId === c.personId) inc(completedOwn, c.personId)
    else inc(coveredForOther, c.personId)
  }

  const overdueByAssignee: PersonCount = {}
  let overdueTotal = 0
  for (const o of relevant) {
    if (o.status !== 'open' || !o.due_date || o.due_date >= today) continue
    if (filters.personId && o.assignee_id !== filters.personId) continue
    overdueTotal++
    inc(overdueByAssignee, o.assignee_id ?? 'unassigned')
  }

  // Streaks span all history (not just the selected range) but respect the
  // category/task filters.
  const streakBase = all.filter(
    (c) => (!filters.categoryId || c.categoryId === filters.categoryId) && (!filters.taskId || c.taskId === filters.taskId),
  )
  const streaks = Object.fromEntries(
    memberIds.map((id) => [id, streaksFor(streakBase.filter((c) => c.personId === id).map((c) => c.day), today)]),
  )

  return {
    totalCompleted: total,
    completedByPerson,
    completedShare,
    onTimeRate,
    avgHoursToComplete: durations(completions),
    avgHoursByPerson,
    byCategory: [...categories.values()].sort((a, b) => b.total - a.total),
    byRecurringTask: [...recurring.values()].sort((a, b) => b.total - a.total),
    weekly,
    monthly,
    overdue: { total: overdueTotal, byAssignee: overdueByAssignee },
    responsibility: { assignedByPerson, unassigned, completedOwn, coveredForOther },
    streaks,
  }
}
