// Health helpers. Purely descriptive: no thresholds, scores or advice.
import { parseISO } from 'date-fns'
import { addDaysISO, daysBetween, type ISODate, toISODate } from '@/lib/dates'

export type MeasurementLike = { measured_at: string; value: number }
export type Aggregation = 'latest' | 'sum' | 'average'

/** One value per local day: the last reading, the total, or the mean. */
export function dailySeries(rows: readonly MeasurementLike[], aggregation: Aggregation): { date: ISODate; value: number }[] {
  const byDay = new Map<ISODate, MeasurementLike[]>()
  for (const r of rows) {
    const day = toISODate(parseISO(r.measured_at))
    ;(byDay.get(day) ?? byDay.set(day, []).get(day)!).push(r)
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => {
      const values = list.map((l) => Number(l.value))
      let value: number
      if (aggregation === 'sum') value = values.reduce((a, b) => a + b, 0)
      else if (aggregation === 'average') value = values.reduce((a, b) => a + b, 0) / values.length
      else value = Number(list.toSorted((a, b) => a.measured_at.localeCompare(b.measured_at)).at(-1)!.value)
      return { date, value }
    })
}

/**
 * The trailing average over the last `days` calendar days (that day included),
 * at each day with a reading. Missed days just leave fewer readings in the
 * window, so occasional weigh-ins still get a sensible line.
 */
export function movingAverage(series: readonly { date: ISODate; value: number }[], days = 7): { date: ISODate; value: number; average: number }[] {
  let start = 0
  let sum = 0
  return series.map((point, i) => {
    sum += point.value
    while (daysBetween(series[start].date, point.date) >= days) sum -= series[start++].value
    return { ...point, average: sum / (i - start + 1) }
  })
}

export function latestWithChange(series: readonly { date: ISODate; value: number }[]) {
  const last = series.at(-1)
  const prev = series.at(-2)
  return last ? { value: last.value, date: last.date, change: prev ? last.value - prev.value : null } : null
}

export function formatValue(value: number, decimals: number) {
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: decimals, minimumFractionDigits: 0 }).format(value)
}

export type PeriodLike = { started_on: ISODate; ended_on: ISODate | null }

/**
 * Plain arithmetic over logged periods: days between consecutive starts, their
 * mean, and that mean added to the last start. The next date is an estimate
 * and must be labelled as one.
 */
export function cycleSummary(periods: readonly PeriodLike[]) {
  const sorted = periods.toSorted((a, b) => a.started_on.localeCompare(b.started_on))
  const starts = sorted.map((p) => p.started_on)
  const cycles = starts.slice(1).map((s, i) => daysBetween(starts[i], s))
  const lengths = sorted.flatMap((p) => (p.ended_on ? [daysBetween(p.started_on, p.ended_on) + 1] : []))
  const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null)
  const averageCycle = mean(cycles.slice(-6))
  const last = starts.at(-1) ?? null
  return {
    cycles,
    averageCycle,
    averageLength: mean(lengths.slice(-6)),
    estimatedNext: last && averageCycle ? addDaysISO(last, averageCycle) : null,
  }
}

/** A task that is really "log my weight": "Weigh in", "Weekly weigh-in", "Weigh myself". */
export function isWeighIn(title: string): boolean {
  return /\bweigh(?:[- ]?in|\s+myself)\b/i.test(title)
}
