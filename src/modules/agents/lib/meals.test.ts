import type { CalEvent } from '../../../../supabase/functions/_shared/agents/calendar.ts'
import { mealAvailability } from '../../../../supabase/functions/_shared/agents/meals.ts'

const TZ = 'Europe/London'
const TODAY = '2026-11-11' // Wednesday; GMT
const TIM = 'tim'
const SOPHIE = 'sophie'

const ev = (title: string, start: string, end: string, owner_id: string | null = TIM, extra: Partial<CalEvent> = {}): CalEvent => ({
  owner_id,
  title,
  start,
  end,
  allDay: false,
  ...extra,
})

/** "lunch:in dinner:out" for one person on one day. */
function day(events: CalEvent[], person: string, date = TODAY, travel = () => [] as { word: string; minutes: number }[]) {
  return mealAvailability(events, [TIM, SOPHIE], TODAY, TZ, travel)
    .filter((r) => r.person_id === person && r.day === date)
    .map((r) => `${r.slot}:${r.available ? 'in' : 'out'}`)
    .join(' ')
}

describe('meal availability from the calendar', () => {
  it('covers lunch and dinner for each person over the next seven days', () => {
    const rows = mealAvailability([], [TIM, SOPHIE], TODAY, TZ)
    expect(rows).toHaveLength(7 * 2 * 2)
    expect(new Set(rows.map((r) => r.day))).toEqual(new Set(['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17']))
    expect(rows.every((r) => r.available)).toBe(true)
  })

  it('misses dinner when an evening event covers most of it, and only for its owner', () => {
    const events = [ev('Table tennis match', `${TODAY}T18:30:00Z`, `${TODAY}T21:30:00Z`)]
    expect(day(events, TIM)).toBe('lunch:in dinner:out')
    expect(day(events, SOPHIE)).toBe('lunch:in dinner:in')
  })

  it('keeps you in for a short event, unless travel there and back makes it long', () => {
    const events = [ev('Padel', `${TODAY}T19:30:00Z`, `${TODAY}T20:30:00Z`)]
    expect(day(events, TIM)).toBe('lunch:in dinner:in')
    expect(day(events, TIM, TODAY, () => [{ word: 'padel', minutes: 60 }])).toBe('lunch:in dinner:out')
  })

  it('never counts work or hidden events: you both work from home', () => {
    const events = [
      ev('Work', `${TODAY}T09:00:00Z`, `${TODAY}T17:30:00Z`),
      ev('Something hidden', `${TODAY}T18:00:00Z`, `${TODAY}T20:30:00Z`, TIM, { hidden: true }),
    ]
    expect(day(events, TIM)).toBe('lunch:in dinner:in')
  })

  it('a shared calendar event takes you both out', () => {
    const events = [ev('Lunch with Mum', `${TODAY}T12:00:00Z`, `${TODAY}T14:00:00Z`, null)]
    expect(day(events, TIM)).toBe('lunch:out dinner:in')
    expect(day(events, SOPHIE)).toBe('lunch:out dinner:in')
  })

  it('an away day (all-day event in your own calendar) misses both meals', () => {
    const events: CalEvent[] = [{ owner_id: SOPHIE, title: 'Trip', start: '2026-11-12', end: '2026-11-14', allDay: true }]
    expect(day(events, SOPHIE, '2026-11-12')).toBe('lunch:out dinner:out')
    expect(day(events, SOPHIE, '2026-11-13')).toBe('lunch:out dinner:out')
    expect(day(events, SOPHIE, '2026-11-14')).toBe('lunch:in dinner:in')
    expect(day(events, TIM, '2026-11-12')).toBe('lunch:in dinner:in')
  })

  it('uses local time (BST in summer)', () => {
    const rows = mealAvailability([ev('Drinks', '2026-07-01T17:00:00Z', '2026-07-01T19:30:00Z')], [TIM], '2026-07-01', TZ, () => [], 1)
    // 18:00-20:30 BST covers the whole dinner window.
    expect(rows.find((r) => r.slot === 'dinner')?.available).toBe(false)
  })
})
