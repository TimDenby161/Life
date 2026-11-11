// Who is in for lunch and dinner, from the calendars. Run overnight by the
// agents function for the next few days; the result fills meal_availability
// (the Plan view on /meals), where either of you can change it by hand. Pure.
//
// Out for a meal when:
//   - the day counts as away (isAway: an all-day event or one of 4h+ that isn't work), or
//   - events (with travel there and back) cover more than half the meal window.
// Work and hidden events (Work, Work AM…) never count: you both work from home.
import { type CalEvent, isAway, travelFor, type TravelRule, WORK_EVENT } from './calendar.ts'
import { addDays, type ISODate, localNow } from './dates.ts'

/** As far ahead as the Plan view on /meals can go (MAX_PLAN_DAYS). */
export const MEAL_DAYS = 7
export const MEAL_SLOTS = ['lunch', 'dinner'] as const
export type MealSlot = (typeof MEAL_SLOTS)[number]

/** When each meal is eaten, in minutes after midnight. */
export const MEAL_WINDOWS: Record<MealSlot, { from: number; to: number }> = {
  lunch: { from: 12 * 60, to: 14 * 60 },
  dinner: { from: 18 * 60, to: 20 * 60 + 30 },
}

export type MealAvailability = { day: ISODate; slot: MealSlot; person_id: string; available: boolean }

/** Minutes of one meal window on `date` taken by the person's non-work events. */
function covered(events: CalEvent[], person: string, date: ISODate, slot: MealSlot, timeZone: string, travel: TravelRule[]): number {
  const w = MEAL_WINDOWS[slot]
  const spans: { from: number; to: number }[] = []
  for (const e of events) {
    if (e.allDay || e.hidden || WORK_EVENT.test(e.title)) continue
    if (e.owner_id !== null && e.owner_id !== person) continue
    const start = localNow(new Date(e.start), timeZone)
    const end = localNow(new Date(e.end), timeZone)
    if (start.date > date || end.date < date) continue
    const way = travelFor(e.title, travel)
    const from = (start.date === date ? start.hour * 60 + start.minute : 0) - way
    const to = (end.date === date ? end.hour * 60 + end.minute : 24 * 60) + way
    const lo = Math.max(from, w.from)
    const hi = Math.min(to, w.to)
    if (hi > lo) spans.push({ from: lo, to: hi })
  }
  // Overlapping events count once.
  spans.sort((a, b) => a.from - b.from)
  let total = 0
  let reach = w.from
  for (const s of spans) {
    const lo = Math.max(s.from, reach)
    if (s.to > lo) total += s.to - lo
    reach = Math.max(reach, s.to)
  }
  return total
}

/** Lunch and dinner for each person over the next `days` days, starting today. */
export function mealAvailability(
  events: CalEvent[],
  people: string[],
  today: ISODate,
  timeZone: string,
  travel: (person: string) => TravelRule[] = () => [],
  days = MEAL_DAYS,
): MealAvailability[] {
  const out: MealAvailability[] = []
  for (let i = 0; i < days; i++) {
    const day = addDays(today, i)
    for (const person_id of people) {
      const away = isAway(events, person_id, day, timeZone)
      for (const slot of MEAL_SLOTS) {
        const w = MEAL_WINDOWS[slot]
        const available = !away && covered(events, person_id, day, slot, timeZone, travel(person_id)) * 2 <= w.to - w.from
        out.push({ day, slot, person_id, available })
      }
    }
  }
  return out
}
