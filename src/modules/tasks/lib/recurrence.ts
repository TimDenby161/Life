// Mirror of public.recurrence_next_date (supabase/migrations/*_tasks.sql).
// The database is the source of truth for generating occurrences; this copy
// is used for previews ("next: Tue 28 Oct") and rule descriptions. Both are
// tested against supabase/tests/fixtures/recurrence-cases.json.
import { addDaysISO, daysBetween, type ISODate, parseISODate, toISODate } from '@/lib/dates'

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly'

export type RecurrenceRule = {
  freq: Frequency
  interval?: number
  /** ISO weekdays, 1 = Monday … 7 = Sunday (weekly only). */
  weekdays?: number[]
  /** 1–31, clamped to the month's last day (monthly only). */
  monthDay?: number
  until?: ISODate
  /** A job: due one interval after it was last done, not on fixed dates. */
  afterDone?: true
}

export const WEEKDAYS = [
  { iso: 1, short: 'Mon', long: 'Monday' },
  { iso: 2, short: 'Tue', long: 'Tuesday' },
  { iso: 3, short: 'Wed', long: 'Wednesday' },
  { iso: 4, short: 'Thu', long: 'Thursday' },
  { iso: 5, short: 'Fri', long: 'Friday' },
  { iso: 6, short: 'Sat', long: 'Saturday' },
  { iso: 7, short: 'Sun', long: 'Sunday' },
] as const

export function isoWeekday(date: ISODate): number {
  const d = parseISODate(date).getDay()
  return d === 0 ? 7 : d
}

function weekStart(date: ISODate): ISODate {
  return addDaysISO(date, 1 - isoWeekday(date))
}

function lastDayOfMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate()
}

/** First date of the series strictly after `after` (never before `anchor`); null when ended. */
export function nextOccurrence(rule: RecurrenceRule, anchor: ISODate, after: ISODate): ISODate | null {
  const interval = rule.interval ?? 1
  const start = daysBetween(anchor, addDaysISO(after, 1)) > 0 ? addDaysISO(after, 1) : anchor
  let candidate: ISODate | null = null

  if (rule.freq === 'daily') {
    const steps = Math.ceil(daysBetween(anchor, start) / interval)
    candidate = addDaysISO(anchor, steps * interval)
  } else if (rule.freq === 'weekly') {
    const weekdays = rule.weekdays?.length ? rule.weekdays : [isoWeekday(anchor)]
    const anchorWeek = weekStart(anchor)
    for (let i = 0; i <= 7 * interval + 6; i++) {
      const d = addDaysISO(start, i)
      const weeks = daysBetween(anchorWeek, weekStart(d)) / 7
      if (weekdays.includes(isoWeekday(d)) && weeks % interval === 0) {
        candidate = d
        break
      }
    }
  } else {
    const a = parseISODate(anchor)
    const s = parseISODate(start)
    const dom = rule.freq === 'monthly' ? (rule.monthDay ?? a.getDate()) : a.getDate()
    const step = rule.freq === 'monthly' ? interval : 12 * interval
    let months = (s.getFullYear() - a.getFullYear()) * 12 + (s.getMonth() - a.getMonth())
    months = Math.ceil(months / step) * step
    for (;;) {
      const y = a.getFullYear() + Math.floor((a.getMonth() + months) / 12)
      const m = (a.getMonth() + months) % 12
      const d = toISODate(new Date(y, m, Math.min(dom, lastDayOfMonth(y, m))))
      if (daysBetween(start, d) >= 0) {
        candidate = d
        break
      }
      months += step
    }
  }

  if (candidate && rule.until && daysBetween(rule.until, candidate) > 0) return null
  return candidate
}

/** The next `count` dates on or after `from`. */
export function upcomingOccurrences(rule: RecurrenceRule, anchor: ISODate, from: ISODate, count: number): ISODate[] {
  const out: ISODate[] = []
  let after = addDaysISO(from, -1)
  while (out.length < count) {
    const next = nextOccurrence(rule, anchor, after)
    if (!next) break
    out.push(next)
    after = next
  }
  return out
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

const plural = (n: number, unit: string) => (n === 1 ? unit : `${n} ${unit}s`)

const UNITS: Record<Frequency, string> = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }

/** "Every week", "Every 10 days": the interval of a job. */
export function describeInterval(rule: RecurrenceRule): string {
  return `Every ${plural(rule.interval ?? 1, UNITS[rule.freq])}`
}

/** Human description, e.g. "Every Tuesday", "Every 2 weeks on Mon, Thu". */
export function describeRecurrence(rule: RecurrenceRule, anchor: ISODate): string {
  if (rule.afterDone) return `${describeInterval(rule)} after it's done`
  const interval = rule.interval ?? 1
  let text: string
  switch (rule.freq) {
    case 'daily':
      text = interval === 1 ? 'Every day' : `Every ${interval} days`
      break
    case 'weekly': {
      const days = (rule.weekdays?.length ? rule.weekdays : [isoWeekday(anchor)]).toSorted((a, b) => a - b)
      const names =
        days.length === 1
          ? WEEKDAYS[days[0] - 1].long
          : days.length === 5 && days.every((d) => d <= 5)
            ? interval === 1
              ? 'weekday'
              : 'weekdays'
            : days.map((d) => WEEKDAYS[d - 1].short).join(', ')
      text = interval === 1 ? `Every ${names}` : `Every ${plural(interval, 'week')} on ${names}`
      break
    }
    case 'monthly': {
      const dom = rule.monthDay ?? parseISODate(anchor).getDate()
      text = `${interval === 1 ? 'Monthly' : `Every ${plural(interval, 'month')}`} on the ${ordinal(dom)}`
      break
    }
    case 'yearly': {
      const d = parseISODate(anchor)
      const label = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })
      text = `${interval === 1 ? 'Every year' : `Every ${plural(interval, 'year')}`} on ${label}`
      break
    }
  }
  return rule.until ? `${text}, until ${parseISODate(rule.until).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : text
}

export function parseRecurrence(value: unknown): RecurrenceRule | null {
  if (!value || typeof value !== 'object') return null
  const v = value as RecurrenceRule
  return ['daily', 'weekly', 'monthly', 'yearly'].includes(v.freq) ? v : null
}
