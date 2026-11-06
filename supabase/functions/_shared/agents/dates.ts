// Date helpers for the agents. Pure (no Deno, DOM or npm imports) so the Edge
// Function and the Vitest suite share them. Dates are "YYYY-MM-DD" strings in
// the household's local time; arithmetic is done in UTC so DST can't shift a day.

export type ISODate = string

const DAY_MS = 86_400_000

const toUTC = (iso: ISODate) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
const fromUTC = (ms: number): ISODate => new Date(ms).toISOString().slice(0, 10)

export function addDays(iso: ISODate, days: number): ISODate {
  return fromUTC(toUTC(iso) + days * DAY_MS)
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((toUTC(to) - toUTC(from)) / DAY_MS)
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(iso: ISODate): number {
  return ((new Date(toUTC(iso)).getUTCDay() + 6) % 7) + 1
}

/** The first date strictly after `iso` that falls on `weekday` (1 = Monday). */
export function nextWeekday(iso: ISODate, weekday: number): ISODate {
  const ahead = (weekday - isoWeekday(iso) + 7) % 7 || 7
  return addDays(iso, ahead)
}

/** "2026-W45": ISO-8601 week, the week containing that Thursday. */
export function isoWeekKey(iso: ISODate): string {
  const thursday = addDays(iso, 4 - isoWeekday(iso))
  const year = Number(thursday.slice(0, 4))
  const week = Math.floor(daysBetween(`${year}-01-01`, thursday) / 7) + 1
  return `${year}-W${String(week).padStart(2, '0')}`
}

/** The calendar date and hour in a time zone at an instant. */
export function localNow(now: Date, timeZone: string): { date: ISODate; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')), minute: Number(get('minute')) }
}

/** "6 Nov", or "Today"/"Tomorrow" relative to `today`. */
export function shortDay(iso: ISODate, today: ISODate): string {
  const diff = daysBetween(today, iso)
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff === -1) return 'yesterday'
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const label = `${Number(iso.slice(8, 10))} ${months[Number(iso.slice(5, 7)) - 1]}`
  return diff > 0 && diff < 7 ? `${days[isoWeekday(iso) - 1]} ${label}` : label
}
