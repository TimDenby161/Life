import { addDaysISO, daysBetween, formatDay, formatTime, type ISODate } from '@/lib/dates'
import type { Priority } from '../api'

const DELAY_STEPS = [1, 2, 4, 7]

/** Each put-off is longer than the last, but something important keeps coming back tomorrow. */
export function delayDays(timesDelayed: number, important: boolean) {
  return important ? 1 : DELAY_STEPS[Math.min(timesDelayed, DELAY_STEPS.length - 1)]
}

export function delayLabel(days: number) {
  return `Delay ${days} ${days === 1 ? 'day' : 'days'}`
}

/** Where delaying a task puts it: counted from today, or from its due date if that's later. */
export function delayedDate(dueDate: ISODate | null, today: ISODate, days: number): ISODate {
  return addDaysISO(dueDate && dueDate > today ? dueDate : today, days)
}

export type DueTone = 'overdue' | 'today' | 'soon' | 'later' | 'none'

export function dueTone(dueDate: ISODate | null, today: ISODate): DueTone {
  if (!dueDate) return 'none'
  const diff = daysBetween(today, dueDate)
  if (diff < 0) return 'overdue'
  if (diff === 0) return 'today'
  if (diff <= 7) return 'soon'
  return 'later'
}

export function dueLabel(dueDate: ISODate | null, dueTime: string | null): string {
  if (!dueDate) return ''
  return [formatDay(dueDate), formatTime(dueTime)].filter(Boolean).join(' · ')
}

export const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }

/** Sort: dated first by date/time, then priority, then title. */
export function compareOccurrences(
  a: { due_date: string | null; due_time: string | null; task: { priority: string; title: string } },
  b: { due_date: string | null; due_time: string | null; task: { priority: string; title: string } },
) {
  if (a.due_date !== b.due_date) {
    if (!a.due_date) return 1
    if (!b.due_date) return -1
    return a.due_date < b.due_date ? -1 : 1
  }
  if (a.due_time !== b.due_time) {
    if (!a.due_time) return 1
    if (!b.due_time) return -1
    return a.due_time < b.due_time ? -1 : 1
  }
  const p = (PRIORITY_ORDER[a.task.priority] ?? 2) - (PRIORITY_ORDER[b.task.priority] ?? 2)
  return p || a.task.title.localeCompare(b.task.title)
}

export type Section = 'overdue' | 'today' | 'upcoming' | 'later' | 'someday'
export const SECTION_LABELS: Record<Section, string> = {
  overdue: 'Overdue',
  today: 'Today',
  upcoming: 'Next 7 days',
  later: 'Later',
  someday: 'No date',
}

export function sectionOf(dueDate: ISODate | null, today: ISODate): Section {
  const tone = dueTone(dueDate, today)
  return tone === 'overdue' ? 'overdue' : tone === 'today' ? 'today' : tone === 'soon' ? 'upcoming' : tone === 'later' ? 'later' : 'someday'
}
