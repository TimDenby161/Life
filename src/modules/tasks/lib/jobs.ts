// Jobs are recurring tasks with { afterDone: true }: each one is due one
// interval after it was last done (see supabase/migrations/*_task_jobs.sql).
import { daysBetween, type ISODate, toISODate } from '@/lib/dates'
import { nextOccurrence, parseRecurrence, type RecurrenceRule } from './recurrence'

export function jobRule(recurrence: unknown): RecurrenceRule | null {
  const rule = parseRecurrence(recurrence)
  return rule?.afterDone ? rule : null
}

/** Mirrors public.task_last_done_on: the later of the hand-set date and the latest completion. */
export function lastDoneOf(lastDoneOn: ISODate | null, latestCompletedAt: string | null | undefined): ISODate | null {
  const completed = latestCompletedAt ? toISODate(new Date(latestCompletedAt)) : null
  if (!completed) return lastDoneOn
  if (!lastDoneOn) return completed
  return completed > lastDoneOn ? completed : lastDoneOn
}

/** When a job will next be due: one interval after it was last done, or today if never. */
export function nextDueAfter(rule: RecurrenceRule, lastDone: ISODate | null, today: ISODate): ISODate {
  return lastDone ? (nextOccurrence(rule, lastDone, lastDone) ?? today) : today
}

/** "Due today", "2 days overdue", "Due in 5 days". */
export function dueInWords(dueDate: ISODate, today: ISODate): string {
  const diff = daysBetween(today, dueDate)
  if (diff === 0) return 'Due today'
  if (diff === 1) return 'Due tomorrow'
  if (diff > 0) return `Due in ${diff} days`
  return diff === -1 ? '1 day overdue' : `${-diff} days overdue`
}

/** "today", "yesterday", "5 days ago". */
export function agoInWords(date: ISODate, today: ISODate): string {
  const diff = daysBetween(date, today)
  if (diff <= 0) return 'today'
  if (diff === 1) return 'yesterday'
  return `${diff} days ago`
}
