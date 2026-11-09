// Away from home today, going by a person's own calendar (not shared ones): an
// all-day event, or one event of four hours or more (a match, a day trip) that
// isn't work (we both work from home).
// Mirrors isAway in supabase/functions/_shared/agents/calendar.ts.
import { toISODate } from '@/lib/dates'
import type { CalendarIntegration } from '@/modules/calendar/api'
import type { CalendarEvent } from '@/modules/calendar/lib/grid'
import { freeMinutes, WORK_EVENT } from '../../../../supabase/functions/_shared/agents/calendar.ts'

export const AWAY_MINUTES = 240

export function awayToday(events: CalendarEvent[], integrations: Pick<CalendarIntegration, 'id' | 'owner_id'>[], person: string, today: string): boolean {
  const own = new Set(integrations.filter((i) => i.owner_id === person).map((i) => i.id))
  return events.some((e) => {
    if (!own.has(e.calendarId)) return false
    if (e.allDay) return e.start <= today && today < e.end
    if (WORK_EVENT.test(e.title)) return false
    return (new Date(e.end).getTime() - new Date(e.start).getTime()) / 60_000 >= AWAY_MINUTES
  })
}

const minuteOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes()

/**
 * Free minutes left today for these people together, from now: their own and
 * shared calendars' timed events count as busy (titles aren't looked at). As
 * freeToday in supabase/functions/_shared/agents/calendar.ts, in local time.
 */
export function freeMinutesToday(
  events: CalendarEvent[],
  integrations: Pick<CalendarIntegration, 'id' | 'owner_id'>[],
  people: string[],
  today: string,
  now = new Date(),
): number {
  const owner = new Map(integrations.map((i) => [i.id, i.owner_id]))
  const blocks = events
    .filter((e) => !e.allDay && (owner.get(e.calendarId) === null || people.includes(owner.get(e.calendarId) ?? '')))
    .map((e) => {
      const start = new Date(e.start)
      const end = new Date(e.end)
      return { from: toISODate(start) < today ? 0 : minuteOfDay(start), to: toISODate(end) > today ? 24 * 60 : minuteOfDay(end) }
    })
  return freeMinutes(blocks, minuteOfDay(now))
}
