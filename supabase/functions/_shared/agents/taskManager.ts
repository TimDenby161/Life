// Smart Task Manager: deterministic rules over open tasks and the completion
// log. Pure, so the Edge Function and Vitest share it.
//
// Each run returns the full set of current suggestions; agent_finish_run expires
// any earlier ones it no longer produces. A task gets at most one "what to do
// about it" suggestion (key task:<id>), so two rules can never propose
// conflicting dates for the same task.
//
// Privacy: a suggestion about someone's own task (personal list or owned
// category) goes to that person only. Workload only looks at joint tasks.
import { addDays, daysBetween, type ISODate, isoWeekday, nextWeekday, shortDay } from './dates.ts'
import type { Action, Category, CompletionEvent, List, Member, OpenTask, Rule, Severity, SuggestionDraft, TaskContext } from './types.ts'

export const PUT_OFF_TIMES = 3
export const LONG_OVERDUE_DAYS = 14
export const UNDATED_DAYS = 45
export const MAX_UNDATED = 3
export const DEADLINE_WATCH_DAYS = 14
export const BLOCKED_DEADLINE_DAYS = 7
export const REPEAT_MIN_TIMES = 3
export const WORKLOAD_DAYS = 28
export const WORKLOAD_MIN_JOBS = 8
export const WORKLOAD_SHARE = 0.65
export const MAX_AUTOMATE = 3
export const PLAN_DAYS = 7
export const PLAN_DEADLINE_DAYS = 14
export const PLAN_SIZE = 10
/** At most this many of each kind per person per run, most pressing first, so a backlog doesn't become a flood. */
export const KIND_LIMITS: Record<string, number> = { missed_repeat: 3, undated: 3, automate: 3, overdue: 5, put_off: 5, duplicate: 5 }

// Mirrors WORK_CATEGORY in src/modules/tasks/lib/topJobs.ts.
const WORK_CATEGORY = /^c4\b/i

/** rank orders suggestions of the same kind and severity (higher first); it isn't stored. */
type Draft = Omit<SuggestionDraft, 'recipients'> & { rank?: number }

export type PlanItem = { task_id: string; title: string; due_date: ISODate | null; deadline: ISODate | null; late: number; together: boolean }

export type WorkloadSummary = { days: number; people: { id: string; name: string; jobs: number; minutes: number }[] }

export type TaskManagerResult = {
  suggestions: SuggestionDraft[]
  /** Per person: what to get done this week. */
  plans: Record<string, PlanItem[]>
  workload: WorkloadSummary | null
}

// ---------------------------------------------------------------------------
// Ownership (mirrors ownerOf in src/modules/tasks/lib/owner.ts)
// ---------------------------------------------------------------------------

/** The one person a task belongs to (owned category, else personal list); null means joint. */
export function ownerOf(task: { category_id: string | null; list_id: string | null }, categories: Category[], lists: List[]): string | null {
  const category = categories.find((c) => c.id === task.category_id)
  if (category?.owner_id) return category.owner_id
  const list = lists.find((l) => l.id === task.list_id)
  return list?.kind === 'personal' ? list.owner_id : null
}

/** Someone's own task goes to them alone (if they want this agent); a joint one to everyone who does. */
export function recipientsFor(task: { category_id: string | null; list_id: string | null }, ctx: TaskContext, enabled: string[]): string[] {
  const owner = ownerOf(task, ctx.categories, ctx.lists)
  return owner ? (enabled.includes(owner) ? [owner] : []) : enabled
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const quote = (title: string) => `“${title}”`

export function cycleDays(rule: Rule | null): number | null {
  if (!rule) return null
  const n = rule.interval ?? 1
  return rule.freq === 'daily' ? n : rule.freq === 'weekly' ? 7 * n : rule.freq === 'monthly' ? 30 * n : 365 * n
}

const isEveryDay = (rule: Rule | null) => rule?.freq === 'daily' && (rule.interval ?? 1) === 1

function categoryName(t: { category_id: string | null }, ctx: TaskContext) {
  return ctx.categories.find((c) => c.id === t.category_id)?.name ?? ''
}

function nextWorkday(today: ISODate) {
  let d = addDays(today, 1)
  while (isoWeekday(d) > 5) d = addDays(d, 1)
  return d
}

/** A date that can actually happen: the next workday for work, otherwise Saturday; never past the deadline. */
export function realisticDate(t: OpenTask, ctx: TaskContext): ISODate {
  let date = WORK_CATEGORY.test(categoryName(t, ctx)) ? nextWorkday(ctx.today) : nextWeekday(ctx.today, 6)
  if (t.deadline) {
    const before = addDays(t.deadline, -1)
    if (before < date) date = before > ctx.today ? before : ctx.today
  }
  return date
}

const STOPWORDS = new Set(['the', 'a', 'an', 'to', 'and', 'of', 'for', 'my', 'our', 'with', 'on', 'in'])

/** Lower-case words without punctuation, filler words or plural s. */
export function titleWords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9À-ɏ一-鿿]+/g, ' ')
    .split(' ')
    .filter((w) => w && !STOPWORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
}

/** Same words, or nearly the same (at least 3 in 4 shared) for titles of two words or more. */
export function similarTitles(a: string, b: string): boolean {
  const wa = titleWords(a)
  const wb = titleWords(b)
  if (!wa.length || !wb.length) return false
  if (wa.join(' ') === wb.join(' ')) return true
  if (Math.min(wa.length, wb.length) < 2) return false
  const sa = new Set(wa)
  const sb = new Set(wb)
  const shared = [...sa].filter((w) => sb.has(w)).length
  return shared / new Set([...sa, ...sb]).size >= 0.75
}

const EFFORT: [RegExp, number][] = [
  [/\b(shop|shopping|groceries)\b/i, 45],
  [/\b(cook|meal|dinner|batch)\b/i, 40],
  [/\b(clean|hoover|vacuum|mop|scrub|oven|fridge|windows?|bathroom|kitchen|ensuite)\b/i, 30],
  [/\b(laundry|washing|sheets|bedding|ironing|towels)\b/i, 20],
  [/\b(bins?|recycling|dishwasher|plants?|tidy|wipe|dust)\b/i, 10],
]

/** Rough minutes a job takes, from its wording. An estimate, and labelled as one wherever it's shown. */
export function estimateMinutes(title: string, category: string | null = null): number {
  const text = `${title} ${category ?? ''}`
  return EFFORT.find(([re]) => re.test(text))?.[1] ?? 15
}

export function formatMinutes(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`
}

export type Completion = { occurrence_id: string; task_id: string; title: string; list_id: string | null; category_id: string | null; category_name: string | null; people: string[]; date: ISODate; recorded_at: string; is_recurring: boolean }

/** The log reduced to the current state of each occurrence (as in tasks/lib/stats.ts). */
export function effectiveCompletions(events: CompletionEvent[]): Completion[] {
  const latest = new Map<string, CompletionEvent>()
  for (const e of events) {
    const prev = latest.get(e.occurrence_id)
    if (!prev || e.recorded_at >= prev.recorded_at) latest.set(e.occurrence_id, e)
  }
  return [...latest.values()]
    .filter((e) => e.event_type === 'completed' && e.completed_by)
    .map((e) => ({
      occurrence_id: e.occurrence_id,
      task_id: e.task_id,
      title: e.task_title,
      list_id: e.list_id,
      category_id: e.category_id,
      category_name: e.category_name,
      people: e.also_completed_by ? [e.completed_by!, e.also_completed_by] : [e.completed_by!],
      date: e.occurred_at.slice(0, 10),
      recorded_at: e.recorded_at,
      is_recurring: e.is_recurring,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ---------------------------------------------------------------------------
// One finding per task, most pressing first
// ---------------------------------------------------------------------------

function moveTo(t: OpenTask, date: ISODate): Action | null {
  return date === t.due_date ? null : { type: 'move_due_date', due_date: date }
}

function taskFinding(t: OpenTask, ctx: TaskContext, openByTask: Map<string, OpenTask>): Draft | null {
  const { today } = ctx
  const key = `task:${t.task_id}`
  const base = { dedupe_key: key, task_id: t.task_id }
  const deadlineIn = t.deadline ? daysBetween(today, t.deadline) : null

  const blocker = t.waiting_on_task_id ? openByTask.get(t.waiting_on_task_id) : undefined
  if (blocker) {
    if (deadlineIn === null || deadlineIn < 0 || deadlineIn > BLOCKED_DEADLINE_DAYS) return null
    return {
      ...base,
      kind: 'blocked',
      severity: 3,
      title: `${quote(t.title)} is waiting on ${quote(blocker.title)}`,
      reason: `Its deadline is ${shortDay(t.deadline!, today)} and ${quote(blocker.title)} is still open, so that one needs doing first.`,
      action: null,
    }
  }

  if (deadlineIn !== null && deadlineIn >= 0 && deadlineIn <= DEADLINE_WATCH_DAYS && (!t.due_date || t.due_date > t.deadline!)) {
    const target = addDays(t.deadline!, -2) > today ? addDays(t.deadline!, -2) : today
    return {
      ...base,
      kind: 'deadline_risk',
      severity: 3,
      title: `${quote(t.title)} is set for after its deadline`,
      reason: `The deadline is ${shortDay(t.deadline!, today)} but it is ${t.due_date ? `due ${shortDay(t.due_date, today)}` : 'not dated'}. Moving it to ${shortDay(target, today)} leaves a little slack.`,
      action: moveTo(t, target),
    }
  }

  if (t.delay_count >= PUT_OFF_TIMES) {
    const date = realisticDate(t, ctx)
    return {
      ...base,
      kind: 'put_off',
      rank: t.delay_count,
      severity: deadlineIn !== null && deadlineIn <= DEADLINE_WATCH_DAYS ? 3 : 2,
      title: `${quote(t.title)} has been put off ${t.delay_count} times`,
      reason: `Delayed ${t.delay_count} times${t.due_date ? `, now due ${shortDay(t.due_date, today)}` : ''}. A set day is more likely to stick than another delay: ${shortDay(date, today)}?`,
      action: moveTo(t, date),
    }
  }

  const late = t.due_date ? daysBetween(t.due_date, today) : null
  if (!t.recurrence && late !== null && late >= LONG_OVERDUE_DAYS) {
    const date = realisticDate(t, ctx)
    return {
      ...base,
      kind: 'overdue',
      rank: late,
      severity: 2,
      title: `${quote(t.title)} is ${late} days overdue`,
      reason: `It was due ${shortDay(t.due_date!, today)}. Give it a day it can really happen (${shortDay(date, today)}?), or archive it if it no longer matters.`,
      action: moveTo(t, date),
    }
  }

  const cycle = cycleDays(t.recurrence)
  if (cycle && late !== null && late >= Math.max(2 * cycle, 7)) {
    return {
      ...base,
      kind: 'missed_repeat',
      rank: late / cycle,
      severity: 1,
      title: `${quote(t.title)} hasn't been done for a while`,
      reason: `It was due ${shortDay(t.due_date!, today)}, ${late} days ago, and normally comes round every ${cycle === 1 ? 'day' : `${cycle} days`}. Do it, skip this round, or archive it if it's no longer needed.`,
      action: null,
    }
  }

  return null
}

/** One-offs added long ago and never given a date: the oldest few. */
function undatedFindings(ctx: TaskContext): Draft[] {
  return ctx.open
    .filter((t) => !t.recurrence && !t.due_date && !t.waiting_on_task_id && daysBetween(t.created_at.slice(0, 10), ctx.today) >= UNDATED_DAYS)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(0, MAX_UNDATED)
    .map((t) => {
      const date = realisticDate(t, ctx)
      return {
        dedupe_key: `task:${t.task_id}`,
        task_id: t.task_id,
        kind: 'undated',
        severity: 1 as Severity,
        title: `${quote(t.title)} has no date`,
        reason: `Added ${daysBetween(t.created_at.slice(0, 10), ctx.today)} days ago and never scheduled. ${shortDay(date, ctx.today)}?`,
        action: { type: 'move_due_date', due_date: date },
      }
    })
}

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

function duplicateFindings(ctx: TaskContext): { draft: Draft; task: OpenTask }[] {
  const out: { draft: Draft; task: OpenTask }[] = []
  const sorted = [...ctx.open].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const archived = new Set<string>()
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const older = sorted[i]
      const newer = sorted[j]
      if (archived.has(newer.task_id) || archived.has(older.task_id)) continue
      if (older.task_id === newer.task_id) continue
      if (ownerOf(older, ctx.categories, ctx.lists) !== ownerOf(newer, ctx.categories, ctx.lists)) continue
      if (older.needs_both !== newer.needs_both || Boolean(older.recurrence) !== Boolean(newer.recurrence)) continue
      if (older.waiting_on_task_id === newer.task_id || newer.waiting_on_task_id === older.task_id) continue
      if (!similarTitles(older.title, newer.title)) continue
      archived.add(newer.task_id)
      const same = older.title.trim().toLowerCase() === newer.title.trim().toLowerCase()
      out.push({
        task: newer,
        draft: {
          dedupe_key: `duplicate:${older.task_id}:${newer.task_id}`,
          task_id: newer.task_id,
          kind: 'duplicate',
          severity: 1,
          title: same ? `${quote(newer.title)} is on the list twice` : `${quote(older.title)} and ${quote(newer.title)} look like the same task`,
          reason: `Both are open. Approving archives the newer one (added ${newer.created_at.slice(0, 10)}); nothing is deleted.`,
          action: { type: 'archive_task' },
        },
      })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// One-offs that keep coming back
// ---------------------------------------------------------------------------

export function inferRule(gapDays: number): { rule: Rule; label: string } | null {
  if (gapDays < 3) return null
  if (gapDays < 6) return { rule: { freq: 'daily', interval: gapDays, afterDone: true }, label: `every ${gapDays} days` }
  if (gapDays <= 48) {
    const weeks = Math.max(1, Math.round(gapDays / 7))
    return { rule: { freq: 'weekly', interval: weeks, afterDone: true }, label: weeks === 1 ? 'every week' : `every ${weeks} weeks` }
  }
  const months = Math.min(12, Math.max(1, Math.round(gapDays / 30)))
  return { rule: { freq: 'monthly', interval: months, afterDone: true }, label: months === 1 ? 'every month' : `every ${months} months` }
}

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2)
}

function repeatFindings(ctx: TaskContext, completions: Completion[]): { draft: Draft; task: { category_id: string | null; list_id: string | null } }[] {
  const groups = new Map<string, Completion[]>()
  for (const c of completions) {
    if (c.is_recurring) continue
    const key = titleWords(c.title).join(' ')
    if (!key) continue
    groups.set(key, [...(groups.get(key) ?? []), c])
  }
  const out: { draft: Draft; task: { category_id: string | null; list_id: string | null } }[] = []
  for (const [key, done] of groups) {
    if (done.length < REPEAT_MIN_TIMES) continue
    const latest = done[done.length - 1]
    if (ctx.open.some((t) => similarTitles(t.title, latest.title))) continue
    const gaps = done.slice(1).map((c, i) => daysBetween(done[i].date, c.date))
    const gap = median(gaps)
    const inferred = inferRule(gap)
    if (!inferred) continue
    const due = addDays(latest.date, gap) > ctx.today ? addDays(latest.date, gap) : ctx.today
    const category = ctx.categories.find((c) => c.id === latest.category_id)
    const owner = ownerOf(latest, ctx.categories, ctx.lists)
    out.push({
      task: latest,
      draft: {
        dedupe_key: `repeat:${key}`.slice(0, 120),
        task_id: null,
        kind: 'repeat',
        severity: 1,
        title: `Make ${quote(latest.title)} a job ${inferred.label}`,
        reason: `Added and done ${done.length} times since ${shortDay(done[0].date, ctx.today)}, about every ${gap} days. As a job it comes back by itself ${inferred.label} after it's done.`,
        action: {
          type: 'create_task',
          title: latest.title,
          list: owner ? 'personal' : 'joint',
          due_date: due,
          recurrence: inferred.rule,
          category_id: category?.id ?? null,
        },
      },
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Joint workload
// ---------------------------------------------------------------------------

function isJoint(t: { category_id: string | null; list_id: string | null }, ctx: TaskContext) {
  return ownerOf(t, ctx.categories, ctx.lists) === null
}

export function workloadSummary(ctx: TaskContext, completions: Completion[]): WorkloadSummary | null {
  if (ctx.members.length !== 2) return null
  const from = addDays(ctx.today, -WORKLOAD_DAYS)
  const recent = completions.filter((c) => c.date > from && c.date <= ctx.today && isJoint(c, ctx))
  const people = ctx.members.map((m) => {
    const mine = recent.filter((c) => c.people.includes(m.id))
    return { id: m.id, name: m.name, jobs: mine.length, minutes: mine.reduce((sum, c) => sum + estimateMinutes(c.title, c.category_name), 0) }
  })
  return { days: WORKLOAD_DAYS, people }
}

function workloadFinding(ctx: TaskContext, summary: WorkloadSummary | null): Draft | null {
  if (!summary) return null
  const jobs = summary.people.reduce((n, p) => n + p.jobs, 0)
  const minutes = summary.people.reduce((n, p) => n + p.minutes, 0)
  if (jobs < WORKLOAD_MIN_JOBS || !minutes) return null
  const [heavy, light] = [...summary.people].sort((a, b) => b.minutes - a.minutes)
  const share = heavy.minutes / minutes
  if (share < WORKLOAD_SHARE) return null
  const pickUp = ctx.open
    .filter((t) => t.recurrence && !t.needs_both && isJoint(t, ctx) && !isEveryDay(t.recurrence) && t.due_date && t.due_date <= addDays(ctx.today, 14))
    .sort((a, b) => estimateMinutes(b.title) - estimateMinutes(a.title))
    .slice(0, 3)
  return {
    dedupe_key: `workload:${ctx.today.slice(0, 7)}`,
    task_id: null,
    kind: 'workload',
    severity: 1,
    title: `${heavy.name} did ${Math.round(share * 100)}% of the joint jobs in the last 4 weeks`,
    reason:
      `By estimated time: ${heavy.name} about ${formatMinutes(heavy.minutes)}, ${light.name} about ${formatMinutes(light.minutes)} (${heavy.jobs} and ${light.jobs} jobs). ` +
      `Estimates come from the kind of job, not timings, and only joint jobs count.` +
      (pickUp.length ? ` ${light.name} could take ${pickUp.map((t) => quote(t.title)).join(', ')}.` : ''),
    action: null,
  }
}

// ---------------------------------------------------------------------------
// Repeating chores that something else could do
// ---------------------------------------------------------------------------

// A payment someone makes by hand ("Pay the window cleaner"), not a review ("Check bills").
const PAYMENT = /\b(pay|rent|council tax)\b/i
const PURCHASE = /\b(buy|order|restock)\b/i

function automateFindings(ctx: TaskContext): { draft: Draft; task: OpenTask }[] {
  return ctx.open
    .filter((t) => t.recurrence && !t.needs_both && (PAYMENT.test(t.title) || PURCHASE.test(t.title)))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(0, MAX_AUTOMATE)
    .map((t) => {
      const payment = PAYMENT.test(t.title)
      return {
        task: t,
        draft: {
          dedupe_key: `automate:${t.task_id}`,
          task_id: t.task_id,
          kind: 'automate',
          severity: 1,
          title: payment ? `Could ${quote(t.title)} be a direct debit?` : `Could ${quote(t.title)} be a repeat order?`,
          reason: payment
            ? 'It repeats and is a payment, so a direct debit or standing order could do it for you. Approving adds a task to set one up; nothing is paid or changed.'
            : 'It repeats and is a purchase, so a subscription or repeat delivery could take it off the list. Approving adds a task to look into it.',
          action: {
            type: 'create_task',
            title: `${payment ? 'Set up a direct debit for' : 'Set up a repeat order for'}: ${t.title}`.slice(0, 200),
            list: ownerOf(t, ctx.categories, ctx.lists) ? 'personal' : 'joint',
            due_date: nextWeekday(ctx.today, 6),
          },
        },
      }
    })
}

// ---------------------------------------------------------------------------
// Weekly plan
// ---------------------------------------------------------------------------

/** What one person (or the two of them) should get done in the next week, deadlines first. */
export function weeklyPlan(ctx: TaskContext, member: Member): PlanItem[] {
  const open = new Set(ctx.open.map((t) => t.task_id))
  const until = addDays(ctx.today, PLAN_DAYS - 1)
  const deadlineUntil = addDays(ctx.today, PLAN_DEADLINE_DAYS - 1)
  return ctx.open
    .filter((t) => {
      const owner = ownerOf(t, ctx.categories, ctx.lists)
      if (owner !== null && owner !== member.id) return false
      if (t.waiting_on_task_id && open.has(t.waiting_on_task_id)) return false
      if (isEveryDay(t.recurrence)) return false
      return (t.due_date !== null && t.due_date <= until) || (t.deadline !== null && t.deadline <= deadlineUntil)
    })
    .sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
    .slice(0, PLAN_SIZE)
    .map((t) => ({
      task_id: t.task_id,
      title: t.title,
      due_date: t.due_date,
      deadline: t.deadline,
      late: t.due_date && t.due_date < ctx.today ? daysBetween(t.due_date, ctx.today) : 0,
      together: t.needs_both,
    }))
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/** Everything the Task Manager has to say, for the people who have it switched on. */
export function analyseTasks(ctx: TaskContext, enabled: string[]): TaskManagerResult {
  const openByTask = new Map(ctx.open.map((t) => [t.task_id, t]))
  const completions = effectiveCompletions(ctx.events)
  const workload = workloadSummary(ctx, completions)
  const drafts: { draft: Draft; task: { category_id: string | null; list_id: string | null } | null }[] = []

  const taken = new Set<string>()
  for (const t of ctx.open) {
    const finding = taskFinding(t, ctx, openByTask)
    if (finding) {
      drafts.push({ draft: finding, task: t })
      taken.add(finding.dedupe_key)
    }
  }
  for (const draft of undatedFindings(ctx)) {
    if (!taken.has(draft.dedupe_key)) drafts.push({ draft, task: openByTask.get(draft.task_id!)! })
  }
  drafts.push(...duplicateFindings(ctx), ...repeatFindings(ctx, completions), ...automateFindings(ctx))
  const balance = workloadFinding(ctx, workload)
  if (balance) drafts.push({ draft: balance, task: null })

  const counts = new Map<string, number>()
  const suggestions = drafts
    .map(({ draft, task }) => ({ ...draft, recipients: task ? recipientsFor(task, ctx, enabled) : enabled }))
    .filter((s) => s.recipients.length > 0)
    .sort((a, b) => b.severity - a.severity || (b.rank ?? 0) - (a.rank ?? 0) || a.dedupe_key.localeCompare(b.dedupe_key))
    .filter((s) => {
      const limit = KIND_LIMITS[s.kind]
      if (!limit) return true
      const group = `${s.kind}:${s.recipients.join(',')}`
      counts.set(group, (counts.get(group) ?? 0) + 1)
      return counts.get(group)! <= limit
    })
    .map(({ rank: _rank, ...s }) => s)

  const plans = Object.fromEntries(ctx.members.filter((m) => enabled.includes(m.id)).map((m) => [m.id, weeklyPlan(ctx, m)]))
  return { suggestions, plans, workload }
}
