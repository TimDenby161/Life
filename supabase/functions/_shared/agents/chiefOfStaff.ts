// Chief of Staff: one short briefing per person, built from the task data and
// the Task Manager's fresh results rather than its own analysis. Pure.
//
// It doesn't rank tasks: Home's Top jobs does that live, by the hour. The
// briefing is what needs memory or a wider view: what changed since yesterday,
// deadlines and busy stretches ahead, and the suggestions that matter most.
import { dayLoad, loadText, MAX_EVENTS_LISTED, packedDays } from './calendar.ts'
import { addDays, daysBetween, type ISODate, isoWeekKey, shortDay } from './dates.ts'
import { cycleDays, effectiveCompletions, ownerOf, type PlanItem, type TaskManagerResult, type WorkloadSummary } from './taskManager.ts'
import type { BriefingDraft, Member, OpenTask, SuggestionDraft, TaskContext } from './types.ts'

export const DEADLINE_DAYS = 14
export const MAX_DEADLINES = 5
export const BUSY_WINDOW_DAYS = 3
export const BUSY_MIN_ITEMS = 3
export const MAX_LISTED = 5
export const MAX_SUGGESTIONS = 3

export type BriefingContent = {
  date: ISODate
  headline: string
  dueToday: number
  /** One-off tasks past their date. */
  overdue: number
  /** Repeating jobs a whole cycle or more late (one day late is normal for a job). */
  behind: number
  together: number
  deadlines: { task_id: string; title: string; deadline: ISODate }[]
  busy: { from: ISODate; to: ISODate; titles: string[] }[]
  clashes: { date: ISODate; time: string; titles: string[] }[]
  partnerDone: { name: string; count: number; titles: string[] } | null
  added: { task_id: string; title: string; by: string }[]
  suggestions: { key: string; title: string; severity: number }[]
  plan?: PlanItem[]
  workload?: WorkloadSummary | null
  /** Today's calendar (time null = all day), when a calendar is connected. */
  calendar?: { time: string | null; title: string }[]
  /** Timed events today. */
  eventsToday?: number
  /** Packed days in the six days after today. */
  packed?: { date: ISODate; load: string; titles: string[] }[]
  /** Today's most important jobs as Claude picked them, in order (only when AI priorities are on and it answered). */
  top?: { task_id: string; title: string; why: string }[]
}

const isEveryDay = (t: OpenTask) => t.recurrence?.freq === 'daily' && (t.recurrence.interval ?? 1) === 1

/** Theirs plus joint, leaving out anything waiting on another open task. */
function inView(ctx: TaskContext, member: Member): OpenTask[] {
  const open = new Set(ctx.open.map((t) => t.task_id))
  return ctx.open.filter((t) => {
    const owner = ownerOf(t, ctx.categories, ctx.lists)
    return (owner === null || owner === member.id) && !(t.waiting_on_task_id && open.has(t.waiting_on_task_id))
  })
}

/** The date something has to happen by: its deadline, else a one-off's due date. */
const hardDate = (t: OpenTask) => t.deadline ?? (t.recurrence ? null : t.due_date)

/** Three or more fixed dates within three days of each other. */
export function busyStretches(tasks: OpenTask[], today: ISODate): BriefingContent['busy'] {
  const dated = tasks
    .map((t) => ({ t, date: hardDate(t) }))
    .filter((x): x is { t: OpenTask; date: ISODate } => x.date !== null && x.date >= today && x.date <= addDays(today, DEADLINE_DAYS))
    .sort((a, b) => a.date.localeCompare(b.date))
  const out: BriefingContent['busy'] = []
  let i = 0
  while (i < dated.length) {
    const end = addDays(dated[i].date, BUSY_WINDOW_DAYS - 1)
    const window = dated.filter((x) => x.date >= dated[i].date && x.date <= end)
    if (window.length >= BUSY_MIN_ITEMS) {
      out.push({ from: window[0].date, to: window[window.length - 1].date, titles: window.map((x) => x.t.title).slice(0, MAX_LISTED) })
      i = dated.findIndex((x) => x.date > end)
      if (i === -1) break
    } else {
      i++
    }
  }
  return out
}

/** Two timed tasks at the same time on the same day in the next week. */
export function clashes(tasks: OpenTask[], today: ISODate): BriefingContent['clashes'] {
  const groups = new Map<string, OpenTask[]>()
  for (const t of tasks) {
    if (!t.due_date || !t.due_time || t.due_date < today || t.due_date > addDays(today, 7)) continue
    const key = `${t.due_date} ${t.due_time.slice(0, 5)}`
    groups.set(key, [...(groups.get(key) ?? []), t])
  }
  return [...groups.entries()]
    .filter(([, ts]) => ts.length > 1)
    .map(([key, ts]) => ({ date: key.slice(0, 10), time: key.slice(11), titles: ts.map((t) => t.title) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
}

export function headline(c: Pick<BriefingContent, 'dueToday' | 'overdue' | 'behind' | 'deadlines' | 'busy' | 'date' | 'eventsToday'>): string {
  const parts: string[] = []
  if (c.dueToday) parts.push(`${c.dueToday} due today`)
  if (c.overdue) parts.push(`${c.overdue} overdue`)
  if (c.behind) parts.push(`${c.behind} ${c.behind === 1 ? 'job' : 'jobs'} behind`)
  if (c.eventsToday) parts.push(`${c.eventsToday} ${c.eventsToday === 1 ? 'event' : 'events'}`)
  const next = c.deadlines[0]
  if (next) parts.push(`“${next.title}” has a deadline ${shortDay(next.deadline, c.date)}`)
  else if (c.busy[0]) parts.push(`a busy stretch from ${shortDay(c.busy[0].from, c.date)}`)
  if (!parts.length) return 'Nothing due today.'
  const text = parts.join(', ')
  return `${text[0].toUpperCase()}${text.slice(1)}.`
}

/** A pending suggestion from any agent, as the briefing needs it. */
export type PendingSuggestion = Pick<SuggestionDraft, 'dedupe_key' | 'title' | 'severity' | 'recipients'>

/**
 * suggestions: every agent's pending suggestions (the Chief of Staff runs after
 * them in the same tick), so the briefing combines them rather than redoing them.
 */
export function briefingFor(
  ctx: TaskContext,
  tm: TaskManagerResult,
  member: Member,
  kind: 'daily' | 'weekly',
  now: Date,
  suggestions: PendingSuggestion[] = tm.suggestions,
): BriefingDraft {
  const { today } = ctx
  const mine = inView(ctx, member)
  const routine = mine.filter((t) => !isEveryDay(t))
  const since = new Date(now.getTime() - 86_400_000).toISOString()
  const partner = ctx.members.find((m) => m.id !== member.id)

  const deadlines = mine
    .filter((t) => t.deadline && t.deadline >= today && t.deadline <= addDays(today, DEADLINE_DAYS))
    .sort((a, b) => a.deadline!.localeCompare(b.deadline!))
    .slice(0, MAX_DEADLINES)
    .map((t) => ({ task_id: t.task_id, title: t.title, deadline: t.deadline! }))

  // What the other person finished in the last day, joint jobs only.
  const partnerDone = partner
    ? effectiveCompletions(ctx.events).filter(
        (c) => c.recorded_at >= since && c.people.includes(partner.id) && ownerOf(c, ctx.categories, ctx.lists) === null,
      )
    : []

  const added = mine
    .filter((t) => t.created_at >= since && t.created_by !== member.id)
    .slice(0, MAX_LISTED)
    .map((t) => ({ task_id: t.task_id, title: t.title, by: ctx.members.find((m) => m.id === t.created_by)?.name ?? 'Someone' }))

  const content: BriefingContent = {
    date: today,
    headline: '',
    dueToday: routine.filter((t) => t.due_date === today).length,
    overdue: routine.filter((t) => !t.recurrence && t.due_date !== null && t.due_date < today).length,
    behind: routine.filter((t) => t.recurrence && t.due_date !== null && daysBetween(t.due_date, today) >= (cycleDays(t.recurrence) ?? 1)).length,
    together: mine.filter((t) => t.needs_both && t.due_date !== null && t.due_date <= today).length,
    deadlines,
    busy: busyStretches(mine, today),
    clashes: clashes(mine, today),
    partnerDone: partner && partnerDone.length
      ? { name: partner.name, count: partnerDone.length, titles: partnerDone.map((c) => c.title).slice(0, MAX_LISTED) }
      : null,
    added,
    suggestions: [...suggestions]
      .filter((s) => s.recipients.includes(member.id))
      .sort((a, b) => b.severity - a.severity)
      .slice(0, MAX_SUGGESTIONS)
      .map((s) => ({ key: s.dedupe_key, title: s.title, severity: s.severity })),
  }
  if (ctx.calendar?.length) {
    const tz = ctx.timezone ?? 'Europe/London'
    const day = dayLoad(ctx.calendar, member.id, today, tz)
    content.calendar = day.events.slice(0, MAX_EVENTS_LISTED)
    content.eventsToday = day.timed
    content.packed = packedDays(ctx.calendar, member.id, addDays(today, 1), 6, tz).map((d) => ({
      date: d.date,
      load: loadText(d),
      titles: d.events.filter((e) => e.time).map((e) => e.title).slice(0, 3),
    }))
  }
  content.headline = headline(content)
  if (kind === 'weekly') {
    content.plan = tm.plans[member.id] ?? []
    content.workload = tm.workload
  }
  return { recipient_id: member.id, kind, period_key: kind === 'weekly' ? isoWeekKey(today) : today, content }
}
