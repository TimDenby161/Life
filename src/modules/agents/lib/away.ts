// Away from home today, going by a person's own calendar (not shared ones): an
// all-day event, or one event of four hours or more (a match, a day trip).
// Mirrors isAway in supabase/functions/_shared/agents/calendar.ts.
import type { CalendarIntegration } from '@/modules/calendar/api'
import type { CalendarEvent } from '@/modules/calendar/lib/grid'

export const AWAY_MINUTES = 240

export function awayToday(events: CalendarEvent[], integrations: Pick<CalendarIntegration, 'id' | 'owner_id'>[], person: string, today: string): boolean {
  const own = new Set(integrations.filter((i) => i.owner_id === person).map((i) => i.id))
  return events.some((e) => {
    if (!own.has(e.calendarId)) return false
    if (e.allDay) return e.start <= today && today < e.end
    return (new Date(e.end).getTime() - new Date(e.start).getTime()) / 60_000 >= AWAY_MINUTES
  })
}
