import type { CalendarEvent } from '@/modules/calendar/lib/grid'
import { isAway, type CalEvent } from '../../../../supabase/functions/_shared/agents/calendar.ts'
import { awayToday } from './away'

const TODAY = '2026-11-07'
const calendars = [{ id: 'tim', owner_id: 'tim' }, { id: 'sophie', owner_id: 'sophie' }, { id: 'shared', owner_id: null }]
const ev = (calendarId: string, start: string, end: string, allDay = false) => ({ id: start, calendarId, title: 'x', start, end, allDay }) as CalendarEvent

describe('away today (app)', () => {
  it('counts an all-day event or one of four hours or more in my own calendar', () => {
    expect(awayToday([ev('tim', '2026-11-07T09:00:00Z', '2026-11-07T17:00:00Z')], calendars, 'tim', TODAY)).toBe(true) // SBL
    expect(awayToday([ev('sophie', '2026-11-05', '2026-11-12', true)], calendars, 'sophie', TODAY)).toBe(true) // America
    expect(awayToday([ev('tim', '2026-11-07T10:00:00Z', '2026-11-07T11:00:00Z')], calendars, 'tim', TODAY)).toBe(false)
  })

  it('ignores shared calendars and the other person’s', () => {
    expect(awayToday([ev('shared', '2026-11-07', '2026-11-08', true)], calendars, 'tim', TODAY)).toBe(false)
    expect(awayToday([ev('sophie', '2026-11-07', '2026-11-08', true)], calendars, 'tim', TODAY)).toBe(false)
  })

  it('ignores an all-day event that has ended', () => {
    expect(awayToday([ev('tim', '2026-11-05', '2026-11-07', true)], calendars, 'tim', TODAY)).toBe(false)
  })
})

describe('away today (agents)', () => {
  const cal = (owner_id: string | null, start: string, end: string, allDay = false): CalEvent => ({ owner_id, title: 'x', start, end, allDay })
  it('uses the same rule', () => {
    expect(isAway([cal('tim', '2026-11-07T09:00:00Z', '2026-11-07T17:00:00Z')], 'tim', TODAY, 'Europe/London')).toBe(true)
    expect(isAway([cal('tim', '2026-11-07T09:00:00Z', '2026-11-07T10:00:00Z')], 'tim', TODAY, 'Europe/London')).toBe(false)
    expect(isAway([cal(null, '2026-11-07', '2026-11-08', true)], 'tim', TODAY, 'Europe/London')).toBe(false)
    expect(isAway([cal('tim', '2026-11-07', '2026-11-08', true)], 'tim', TODAY, 'Europe/London')).toBe(true)
  })
})
