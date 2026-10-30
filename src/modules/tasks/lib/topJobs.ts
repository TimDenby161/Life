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

export function topJobScore(o: Scorable, categories: Pick<TaskCategory, 'id' | 'name'>[], today: ISODate) {
  return importanceScore(o.task, categories) + urgencyScore(o.due_date, today)
}

/**
 * The tasks that most need doing: everything due today (or overdue) comes
 * first, then how important they sound plus how soon they're due.
 */
export function topJobs<T extends Scorable>(items: T[], categories: Pick<TaskCategory, 'id' | 'name'>[], today: ISODate, limit = 5): T[] {
  const dueNow = (o: T) => Number(o.due_date !== null && o.due_date <= today)
  return items
    .map((item) => ({ item, score: topJobScore(item, categories, today) }))
    .sort((a, b) => dueNow(b.item) - dueNow(a.item) || b.score - a.score || compareOccurrences(a.item, b.item))
    .slice(0, limit)
    .map(({ item }) => item)
}
