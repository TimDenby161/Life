// Health helpers. Purely descriptive: no thresholds, scores or advice.
import { parseISO } from 'date-fns'
import { type ISODate, toISODate } from '@/lib/dates'

export const HEALTH_CATEGORIES = [
  { key: 'body', label: 'Body' },
  { key: 'heart', label: 'Heart' },
  { key: 'fitness', label: 'Fitness' },
  { key: 'activity', label: 'Activity' },
  { key: 'sleep', label: 'Sleep' },
  { key: 'measurements', label: 'Measurements' },
  { key: 'custom', label: 'Custom metrics' },
  { key: 'exercise', label: 'Exercise sessions' },
  { key: 'notes', label: 'Health notes' },
] as const
export type HealthCategory = (typeof HEALTH_CATEGORIES)[number]['key']

export type Visibility = 'inherit' | 'private' | 'shared'

/** Mirrors public.health_is_visible for labelling in the UI (RLS is the real gate). */
export function isSharedWithPartner(visibility: Visibility, categoryShared: boolean): boolean {
  return visibility === 'shared' || (visibility === 'inherit' && categoryShared)
}

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

export function latestWithChange(series: readonly { date: ISODate; value: number }[]) {
  const last = series.at(-1)
  const prev = series.at(-2)
  return last ? { value: last.value, date: last.date, change: prev ? last.value - prev.value : null } : null
}

export function formatValue(value: number, decimals: number) {
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: decimals, minimumFractionDigits: 0 }).format(value)
}
