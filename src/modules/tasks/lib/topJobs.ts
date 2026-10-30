import { daysBetween, type ISODate } from '@/lib/dates'
import type { TaskCategory } from '../api'
import { compareOccurrences, delayDays } from './format'

type Scorable = {
  due_date: string | null
  due_time: string | null
  task: { title: string; description?: string | null; priority: string; category_id: string | null; recurrence?: unknown; importance_votes?: number }
}

// How important a task sounds, from its words. Each tier counts once however many words match.
const CRITICAL =
  /\b(pay|payments?|bills?|invoices?|tax|hmrc|deadlines?|renew(al)?|expir(es?|y|ing)|insurance|mortgage|rent|passport|visa|licen[cs]e|mot|solicitor|contract|legal|court|fines?|urgent|asap|important|doctor|gp|dentist|hospital|prescriptions?|vet)\b/i
const MAJOR =
  /\b(book|register|submit|apply|sign|cancel|confirm|deposit|wedding|venue|quotes?|finances?|appointments?|call|phone|reply|send|order|fix|repair|boiler|buy)\b/i
const ROUTINE =
  /\b(clean|wipe|dust|hoover|vacuum|tidy|mop|wash|laundry|descale|learn|study|practi[cs]e|review|words?|characters?|mandarin|spanish|stretch|weigh)\b/i

const PRIORITY_POINTS: Record<string, number> = { urgent: 50, high: 25, normal: 0, low: -25 }
const VOTE_POINTS = 15

function taskText(task: Scorable['task'], categories: Pick<TaskCategory, 'id' | 'name'>[]) {
  const category = categories.find((c) => c.id === task.category_id)?.name ?? ''
  return [task.title, task.description, category].filter(Boolean).join(' ')
}

/** Our own votes settle it; without any, the flag and the wording decide. */
function isImportant(task: Scorable['task'], categories: Pick<TaskCategory, 'id' | 'name'>[]) {
  const votes = task.importance_votes ?? 0
  if (votes) return votes > 0
  return task.priority === 'high' || task.priority === 'urgent' || CRITICAL.test(taskText(task, categories))
}

/** How long delaying this task puts it off, given how often it's been put off already. */
export function delayDaysFor(o: { delay_count: number; task: Scorable['task'] }, categories: Pick<TaskCategory, 'id' | 'name'>[]) {
  return delayDays(o.delay_count, isImportant(o.task, categories))
}

function importanceScore(task: Scorable['task'], categories: Pick<TaskCategory, 'id' | 'name'>[]) {
  const text = taskText(task, categories)
  return (
    (task.importance_votes ?? 0) * VOTE_POINTS +
    (PRIORITY_POINTS[task.priority] ?? 0) +
    (CRITICAL.test(text) ? 40 : MAJOR.test(text) ? 25 : 0) -
    (ROUTINE.test(text) ? 15 : 0) -
    (task.recurrence ? 15 : 0)
  )
}

/** Overdue edges past due today, but only a little: among today's tasks, importance decides. */
function urgencyScore(dueDate: ISODate | null, today: ISODate) {
  if (!dueDate) return 0
  const days = daysBetween(today, dueDate)
  if (days < 0) return 40 + Math.min(-days, 14)
  if (days === 0) return 40
  if (days === 1) return 30
  if (days <= 3) return 22
  if (days <= 7) return 12
  if (days <= 30) return 4
  return -20
}

export function taskScore(o: Scorable, categories: Pick<TaskCategory, 'id' | 'name'>[], today: ISODate) {
  return importanceScore(o.task, categories) + urgencyScore(o.due_date, today)
}

/**
 * Every task's hidden score, most pressing first: anything flagged Urgent, then
 * everything due today (or overdue), then how important it sounds plus how soon it's due.
 */
export function byScore<T extends Scorable>(items: T[], categories: Pick<TaskCategory, 'id' | 'name'>[], today: ISODate): T[] {
  const tier = (o: T) => (o.task.priority === 'urgent' ? 2 : o.due_date !== null && o.due_date <= today ? 1 : 0)
  return items
    .map((item) => ({ item, tier: tier(item), score: taskScore(item, categories, today) }))
    .sort((a, b) => b.tier - a.tier || b.score - a.score || compareOccurrences(a.item, b.item))
    .map(({ item }) => item)
}

export function topJobs<T extends Scorable>(items: T[], categories: Pick<TaskCategory, 'id' | 'name'>[], today: ISODate, limit = 5): T[] {
  return byScore(items, categories, today).slice(0, limit)
}
