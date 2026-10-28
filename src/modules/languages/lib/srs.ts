// Spaced repetition, kept simple: an item comes back the day after it's
// learned, then each time it's remembered the gap grows about 2.5x
// (1, 3, 8, 20, 50, 125, 180 days). Forgetting it starts again from a day.
import { addDaysISO, type ISODate } from '@/lib/dates'

export const MAX_INTERVAL = 180

export type Schedule = { interval_days: number; reviews: number; lapses: number }

export function learnedSchedule(today: ISODate) {
  return { learned_on: today, due_on: addDaysISO(today, 1), interval_days: 1 }
}

export function nextInterval(interval: number, remembered: boolean): number {
  if (!remembered) return 1
  return Math.min(MAX_INTERVAL, Math.max(interval + 1, Math.round(interval * 2.5)))
}

export function reviewedSchedule(item: Schedule, remembered: boolean, today: ISODate) {
  const interval = nextInterval(item.interval_days, remembered)
  return {
    interval_days: interval,
    due_on: addDaysISO(today, interval),
    reviews: item.reviews + 1,
    lapses: item.lapses + (remembered ? 0 : 1),
    last_reviewed_on: today,
  }
}
