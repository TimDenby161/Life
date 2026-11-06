// Calendar awareness for the agents: what's on someone's day, and when a day
// counts as packed. Pure. Events carry times and titles only (never
// descriptions or locations); a shared calendar (owner null) counts for both.
import { addDays, type ISODate, localNow } from './dates.ts'

/** Timed events adding up to this many minutes make a day packed… */
export const BUSY_MINUTES = 240
/** …as do this many timed events. */
export const BUSY_EVENTS = 3
export const MAX_EVENTS_LISTED = 6

export type CalEvent = {
  owner_id: string | null
  title: string
  /** ISO date-time with offset, or YYYY-MM-DD for an all-day event. */
  start: string
  /** As start; an all-day event's end date is the day after it ends. */
  end: string
  allDay: boolean
}

/** What's on one person's day: events in time order (all-day first), and the minutes booked by timed ones. */
export type DayLoad = { date: ISODate; events: { time: string | null; title: string }[]; minutes: number; timed: number }

const hhmm = (p: { hour: number; minute: number }) => `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`

export function dayLoad(events: CalEvent[], person: string, date: ISODate, timeZone: string): DayLoad {
  const load: DayLoad = { date, events: [], minutes: 0, timed: 0 }
  for (const e of events) {
    if (e.owner_id !== null && e.owner_id !== person) continue
    if (e.allDay) {
      if (e.start <= date && date < e.end) load.events.push({ time: null, title: e.title })
      continue
    }
    const start = localNow(new Date(e.start), timeZone)
    const end = localNow(new Date(e.end), timeZone)
    if (start.date > date || end.date < date) continue
    // Minutes of it that fall on this day.
    const from = start.date === date ? start.hour * 60 + start.minute : 0
    const to = end.date === date ? end.hour * 60 + end.minute : 24 * 60
    if (to <= from && start.date === date && end.date === date) continue
    load.minutes += Math.max(0, to - from)
    if (start.date === date) {
      load.timed++
      load.events.push({ time: hhmm(start), title: e.title })
    }
  }
  load.events.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))
  return load
}

export const isPacked = (load: DayLoad) => load.minutes >= BUSY_MINUTES || load.timed >= BUSY_EVENTS

/** Packed days for one person from `from` for `days` days. */
export function packedDays(events: CalEvent[], person: string, from: ISODate, days: number, timeZone: string): DayLoad[] {
  return Array.from({ length: days }, (_, i) => dayLoad(events, person, addDays(from, i), timeZone)).filter(isPacked)
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
/** "tomorrow", or "Thursday" for a day within the week. */
export function dayName(date: ISODate, today: ISODate): string {
  if (date === addDays(today, 1)) return 'tomorrow'
  if (date === today) return 'today'
  return DAYS[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7]
}

/** "4 events, about 5 hours". */
export function loadText(load: DayLoad): string {
  const hours = Math.round(load.minutes / 60)
  return `${load.timed} ${load.timed === 1 ? 'event' : 'events'}${hours ? `, about ${hours} ${hours === 1 ? 'hour' : 'hours'}` : ''}`
}

/** One person's busy times on a day, as "HH:MM" ranges with no titles (for the AI). All-day events don't block time. */
export function busyBlocks(events: CalEvent[], person: string, date: ISODate, timeZone: string): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = []
  for (const e of events) {
    if (e.allDay || (e.owner_id !== null && e.owner_id !== person)) continue
    const start = localNow(new Date(e.start), timeZone)
    const end = localNow(new Date(e.end), timeZone)
    if (start.date > date || end.date < date) continue
    const from = start.date === date ? hhmm(start) : '00:00'
    const to = end.date === date ? hhmm(end) : '24:00'
    if (to > from) out.push({ from, to })
  }
  return out.sort((a, b) => a.from.localeCompare(b.from))
}
