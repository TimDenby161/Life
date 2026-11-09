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
  /**
   * A title hidden in Settings (e.g. Work): never shown or listed, and not a
   * packed day or a day away, but still busy time (and Work time) for plans.
   */
  hidden?: boolean
}

/** What's on one person's day: events in time order (all-day first), and the minutes booked by timed ones. */
export type DayLoad = { date: ISODate; events: { time: string | null; title: string }[]; minutes: number; timed: number }

const hhmm = (p: { hour: number; minute: number }) => `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`

export function dayLoad(events: CalEvent[], person: string, date: ISODate, timeZone: string): DayLoad {
  const load: DayLoad = { date, events: [], minutes: 0, timed: 0 }
  for (const e of events) {
    if (e.hidden || (e.owner_id !== null && e.owner_id !== person)) continue
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

/** Getting to and from events: minutes each way for events whose title has the word (e.g. padel, 60). */
export type TravelRule = { word: string; minutes: number }

/** Travel rules as saved in the Chief of Staff's agent_settings.config, cleaned. */
export function parseTravel(config: unknown): TravelRule[] {
  const t = (config as { travel?: unknown } | null)?.travel
  return (Array.isArray(t) ? t : [])
    .map((r) => r as { word?: unknown; minutes?: unknown })
    .filter((r) => typeof r.word === 'string' && r.word.trim().length > 1 && Number.isInteger(r.minutes) && (r.minutes as number) > 0 && (r.minutes as number) <= 240)
    .slice(0, 12)
    .map((r) => ({ word: (r.word as string).trim().toLowerCase().slice(0, 30), minutes: r.minutes as number }))
}

/** Minutes each way to get to an event, from the rules: the longest that matches its title. */
export function travelFor(title: string, travel: TravelRule[]): number {
  const t = title.toLowerCase()
  return Math.max(0, ...travel.filter((r) => t.includes(r.word)).map((r) => r.minutes))
}

const pad = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/**
 * One person's busy times on a day, as "HH:MM" ranges with no titles (for the
 * AI), including travel there and back from their rules. All-day events don't
 * block time.
 */
export function busyBlocks(events: CalEvent[], person: string, date: ISODate, timeZone: string, travel: TravelRule[] = []): { from: string; to: string }[] {
  const out: { from: number; to: number }[] = []
  for (const e of events) {
    if (e.allDay || (e.owner_id !== null && e.owner_id !== person)) continue
    const start = localNow(new Date(e.start), timeZone)
    const end = localNow(new Date(e.end), timeZone)
    const way = travelFor(e.title, travel)
    const from = start.date === date ? start.hour * 60 + start.minute - way : start.date < date ? 0 : null
    const to = end.date === date ? end.hour * 60 + end.minute + way : end.date > date ? 24 * 60 : null
    if (from === null || to === null) continue
    const lo = Math.max(0, from)
    const hi = Math.min(24 * 60, to)
    if (hi > lo) out.push({ from: lo, to: hi })
  }
  return out.sort((a, b) => a.from - b.from).map((b) => ({ from: pad(b.from), to: pad(b.to) }))
}

/** An event this long means a day out (a match, a day trip, a wedding)… */
export const AWAY_MINUTES = 240
/** …unless it's work: busy, but at home (we both work from home). */
export const WORK_EVENT = /\b(work|working|office|c4)\b/i

/** Jobs fit between these local times: nothing before 7am or after 10pm. */
export const DAY_START = 7 * 60
export const DAY_END = 22 * 60

/** "HH:MM" to minutes after midnight. */
export const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/**
 * Free minutes from `from` (minutes after midnight) to the end of the day,
 * after the busy blocks (which may overlap). Never before DAY_START or after DAY_END.
 */
export function freeMinutes(blocks: { from: number; to: number }[], from: number, start = DAY_START, end = DAY_END): number {
  const lo = Math.max(from, start)
  if (lo >= end) return 0
  const clipped = blocks
    .map((b) => ({ from: Math.max(b.from, lo), to: Math.min(b.to, end) }))
    .filter((b) => b.to > b.from)
    .sort((a, b) => a.from - b.from)
  let busy = 0
  let reach = lo
  for (const b of clipped) {
    if (b.to <= reach) continue
    busy += b.to - Math.max(b.from, reach)
    reach = b.to
  }
  return end - lo - busy
}

/** The longest free stretch between `from` and `until`, after the busy blocks: what a single errand needs. */
export function longestGap(blocks: { from: number; to: number }[], from: number, until: number): number {
  let reach = from
  let best = 0
  for (const b of [...blocks].sort((x, y) => x.from - y.from)) {
    if (b.to <= reach) continue
    if (b.from >= until) break
    best = Math.max(best, Math.min(b.from, until) - reach)
    reach = Math.max(reach, b.to)
  }
  return Math.max(best, until - reach, 0)
}

/** Busy blocks today for these people, in minutes after midnight, with their travel. */
export function busyMinutes(events: CalEvent[], people: string[], date: ISODate, timeZone: string, travel: (person: string) => TravelRule[] = () => []) {
  return people.flatMap((p) => busyBlocks(events, p, date, timeZone, travel(p))).map((b) => ({ from: toMinutes(b.from), to: toMinutes(b.to) }))
}

/** Minutes covered by the blocks (which may overlap) from `from` to the end of the day. */
export function coveredMinutes(blocks: { from: number; to: number }[], from: number): number {
  return 24 * 60 - from - freeMinutes(blocks, from, 0, 24 * 60)
}

/**
 * Work time left today for one person: their Work events (own or shared
 * calendars, by WORK_EVENT) from `fromMinute`. Paid-work jobs fit in here.
 */
export function workToday(events: CalEvent[], person: string, date: ISODate, timeZone: string, fromMinute: number): number {
  const work = events.filter((e) => WORK_EVENT.test(e.title))
  return coveredMinutes(busyBlocks(work, person, date, timeZone).map((b) => ({ from: toMinutes(b.from), to: toMinutes(b.to) })), fromMinute)
}

/** The part of the day jobs can go in, as minutes after midnight: by default 7am to 10pm. */
export type DayWindow = { start: number; end: number }
export const DEFAULT_WINDOW: DayWindow = { start: DAY_START, end: DAY_END }

/**
 * Free minutes left today for these people together (both free for a Together
 * job, inside everyone's day), from the calendar and their travel rules.
 */
export function freeToday(
  events: CalEvent[],
  people: string[],
  date: ISODate,
  timeZone: string,
  fromMinute: number,
  travel: (person: string) => TravelRule[] = () => [],
  window: (person: string) => DayWindow = () => DEFAULT_WINDOW,
): number {
  const blocks = people.flatMap((p) => busyBlocks(events, p, date, timeZone, travel(p))).map((b) => ({ from: toMinutes(b.from), to: toMinutes(b.to) }))
  const start = Math.max(...people.map((p) => window(p).start))
  const end = Math.min(...people.map((p) => window(p).end))
  return freeMinutes(blocks, fromMinute, start, end)
}

/**
 * Away from home today, going by the person's own calendar (not shared ones):
 * an all-day event, or one event of four hours or more that isn't work. Mirrored for the app
 * in agents/lib/away.ts.
 */
export function isAway(events: CalEvent[], person: string, date: ISODate, timeZone: string): boolean {
  return events.some((e) => {
    if (e.owner_id !== person || e.hidden) return false
    if (e.allDay) return e.start <= date && date < e.end
    if (WORK_EVENT.test(e.title)) return false
    const start = localNow(new Date(e.start), timeZone)
    const end = localNow(new Date(e.end), timeZone)
    return start.date <= date && end.date >= date && (new Date(e.end).getTime() - new Date(e.start).getTime()) / 60_000 >= AWAY_MINUTES
  })
}
