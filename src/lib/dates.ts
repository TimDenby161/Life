import { addDays, differenceInCalendarDays, format, isValid, parseISO } from 'date-fns'

/** Dates without time are passed around as ISO "YYYY-MM-DD" strings in local time. */
export type ISODate = string

export function toISODate(date: Date): ISODate {
  return format(date, 'yyyy-MM-dd')
}

export function todayISO(now = new Date()): ISODate {
  return toISODate(now)
}

export function parseISODate(value: ISODate): Date {
  // parseISO treats date-only strings as local midnight, which is what we want.
  return parseISO(value)
}

export function addDaysISO(value: ISODate, days: number): ISODate {
  return toISODate(addDays(parseISODate(value), days))
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return differenceInCalendarDays(parseISODate(to), parseISODate(from))
}

export function isISODate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && isValid(parseISODate(value))
}

/** "Today", "Tomorrow", "Yesterday", "Mon 3 Nov", "3 Nov 2027". */
export function formatDay(value: ISODate, now = new Date()): string {
  const diff = differenceInCalendarDays(parseISODate(value), now)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff === -1) return 'Yesterday'
  const date = parseISODate(value)
  if (date.getFullYear() !== now.getFullYear()) return format(date, 'd MMM yyyy')
  if (Math.abs(diff) < 7) return format(date, 'EEE d MMM')
  return format(date, 'd MMM')
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return ''
  // "HH:MM:SS" -> "HH:MM"
  return value.slice(0, 5)
}

export function formatDateTime(iso: string): string {
  return format(new Date(iso), 'd MMM yyyy, HH:mm')
}

export function monthStart(value: ISODate): ISODate {
  return `${value.slice(0, 7)}-01`
}

export function greeting(now = new Date()): string {
  const h = now.getHours()
  if (h < 5) return 'Good evening'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}
