import type { CalendarIntegration } from '@/modules/calendar/api'
import type { CalendarEvent } from '@/modules/calendar/lib/grid'
import { upcomingToday } from './TodayCalendar'

const ME = 'me'
const cal = (id: string, owner_id: string | null, use_for_agents = true) => ({ id, owner_id, use_for_agents }) as CalendarIntegration
const calendars = [cal('mine', ME), cal('shared', null), cal('partner', 'partner'), cal('birthdays', null, false)]
const ev = (title: string, calendarId: string, start: string, end: string, allDay = false) =>
  ({ id: title, title, calendarId, start, end, allDay }) as CalendarEvent
const NOW = new Date('2026-11-07T12:30:00Z') // Saturday, GMT

describe('the rest of today', () => {
  it('shows my calendars and shared ones, not my partner’s or Birthdays', () => {
    const out = upcomingToday(
      [
        ev('Mine', 'mine', '2026-11-07T15:00:00Z', '2026-11-07T16:00:00Z'),
        ev('Shared', 'shared', '2026-11-07T18:00:00Z', '2026-11-07T19:00:00Z'),
        ev('Theirs', 'partner', '2026-11-07T15:00:00Z', '2026-11-07T16:00:00Z'),
        ev('Mum’s birthday', 'birthdays', '2026-11-07', '2026-11-08', true),
      ],
      calendars,
      ME,
      NOW,
    )
    expect(out.map((e) => e.title)).toEqual(['Mine', 'Shared'])
  })

  it('drops what has finished, keeps what is still going, all-day first', () => {
    const out = upcomingToday(
      [
        ev('Breakfast', 'mine', '2026-11-07T08:00:00Z', '2026-11-07T09:00:00Z'),
        ev('Lunch', 'mine', '2026-11-07T12:00:00Z', '2026-11-07T13:00:00Z'),
        ev('Padel', 'mine', '2026-11-07T17:00:00Z', '2026-11-07T18:00:00Z'),
        ev('Away', 'shared', '2026-11-06', '2026-11-09', true),
        ev('Yesterday', 'shared', '2026-11-06', '2026-11-07', true),
      ],
      calendars,
      ME,
      NOW,
    )
    expect(out.map((e) => e.title)).toEqual(['Away', 'Lunch', 'Padel'])
  })
})
