import { addDays, endOfMonth, endOfWeek, format, parseISO, startOfMonth, startOfWeek } from 'date-fns'
import { addDaysISO, type ISODate, toISODate } from '@/lib/dates'

export type CalendarEvent = {
  id: string
  calendarId: string
  calendarName: string
  color: string
  title: string
  description: string | null
  location: string | null
  /** All-day: "YYYY-MM-DD" (end exclusive, as Google returns it). Timed: ISO datetime. */
  start: string
  end: string
  allDay: boolean
  htmlLink: string | null
}

type WeekStart = 0 | 1

export function monthGrid(month: ISODate, weekStartsOn: WeekStart = 1): ISODate[][] {
  const first = startOfWeek(startOfMonth(parseISO(month)), { weekStartsOn })
  const last = endOfWeek(endOfMonth(parseISO(month)), { weekStartsOn })
  const weeks: ISODate[][] = []
  for (let d = first; d <= last; d = addDays(d, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => toISODate(addDays(d, i))))
  }
  return weeks
}

export function weekDays(date: ISODate, weekStartsOn: WeekStart = 1): ISODate[] {
  const first = startOfWeek(parseISO(date), { weekStartsOn })
  return Array.from({ length: 7 }, (_, i) => toISODate(addDays(first, i)))
}

/** Local calendar days an event occupies. */
export function eventDays(e: CalendarEvent): ISODate[] {
  let start: ISODate
  let endInclusive: ISODate
  if (e.allDay) {
    start = e.start.slice(0, 10)
    endInclusive = addDaysISO(e.end.slice(0, 10), -1)
  } else {
    const s = new Date(e.start)
    const en = new Date(e.end)
    start = toISODate(s)
    // An event ending exactly at midnight does not spill into that day.
    const endAdj = new Date(en.getTime() - 1)
    endInclusive = endAdj < s ? start : toISODate(endAdj)
  }
  const days: ISODate[] = []
  for (let d = start; d <= endInclusive && days.length < 366; d = addDaysISO(d, 1)) days.push(d)
  return days.length ? days : [start]
}

export function bucketByDay(events: readonly CalendarEvent[]): Map<ISODate, CalendarEvent[]> {
  const map = new Map<ISODate, CalendarEvent[]>()
  for (const e of events) for (const d of eventDays(e)) (map.get(d) ?? map.set(d, []).get(d)!).push(e)
  for (const list of map.values()) {
    list.sort((a, b) => (a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1))
  }
  return map
}

export function formatEventTime(e: CalendarEvent, day?: ISODate): string {
  if (e.allDay) return 'All day'
  const s = new Date(e.start)
  const en = new Date(e.end)
  if (day && toISODate(s) !== day) return `until ${format(en, 'HH:mm')}`
  return `${format(s, 'HH:mm')}–${format(en, 'HH:mm')}`
}

/** Google descriptions may contain HTML; we only ever render plain text. */
export function plainText(html: string | null): string {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, '\n'), 'text/html')
  return (doc.body.textContent ?? '').trim()
}
