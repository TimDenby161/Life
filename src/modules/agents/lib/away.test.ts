import type { CalendarEvent } from '@/modules/calendar/lib/grid'
import { isAway, type CalEvent } from '../../../../supabase/functions/_shared/agents/calendar.ts'
import { awayToday, freeMinutesToday, withoutWork, workMinutesToday } from './away'

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

describe('free time today (app)', () => {
  const at = (hhmm: string) => new Date(`${TODAY}T${hhmm}:00`)
  const work = { ...ev('tim', at('09:00').toISOString(), at('17:30').toISOString()), title: 'Work' } as CalendarEvent

  it('is the time to 10pm less my own and shared events, and work never means away', () => {
    const shared = ev('shared', at('19:00').toISOString(), at('20:00').toISOString())
    expect(freeMinutesToday([work, shared], calendars, ['tim'], TODAY, at('06:00'))).toBe(15 * 60 - 510 - 60)
    expect(freeMinutesToday([work], calendars, ['sophie'], TODAY, at('20:00'))).toBe(120)
    expect(awayToday([work], calendars, 'tim', TODAY)).toBe(false)
  })

  it('needs both free for Together', () => {
    const sophie = ev('sophie', at('18:00').toISOString(), at('21:00').toISOString())
    expect(freeMinutesToday([work, sophie], calendars, ['tim', 'sophie'], TODAY, at('17:00'))).toBe(30 + 60)
  })
})

describe('travel time (app)', () => {
  it('blocks the journey both sides of my own matching events', () => {
    const at = (hhmm: string) => new Date(`${TODAY}T${hhmm}:00`)
    const padel = { ...ev('tim', at('19:00').toISOString(), at('20:30').toISOString()), title: 'Padel' } as CalendarEvent
    const rules = (p: string) => (p === 'tim' ? [{ word: 'padel', minutes: 60 }] : [])
    expect(freeMinutesToday([padel], calendars, ['tim'], TODAY, at('17:00'), rules)).toBe(60 + 30)
  })
})

describe('hidden events (app)', () => {
  it('count as busy and work time but never as away', () => {
    const at = (hhmm: string) => new Date(`${TODAY}T${hhmm}:00`)
    const work = { ...ev('tim', at('09:00').toISOString(), at('17:30').toISOString()), title: 'Work', hidden: true } as CalendarEvent
    const dayOut = { ...ev('tim', at('08:00').toISOString(), at('18:00').toISOString()), title: 'Private', hidden: true } as CalendarEvent
    expect(workMinutesToday([work], calendars, 'tim', TODAY, at('14:00'))).toBe(210)
    expect(freeMinutesToday([work], calendars, ['tim'], TODAY, at('14:00'))).toBe(8 * 60 - 210)
    expect(awayToday([dayOut], calendars, 'tim', TODAY)).toBe(false)
  })
})

describe('off work today', () => {
  const at = (hhmm: string) => new Date(`${TODAY}T${hhmm}:00`)
  const timed = (calendarId: string, title: string) => ({ ...ev(calendarId, at('09:00').toISOString(), at('17:00').toISOString()), title }) as CalendarEvent

  it('frees my work hours but keeps everything else, and Sophie’s work', () => {
    const mine = timed('tim', 'Work')
    const dentist = { ...timed('tim', 'Dentist'), id: 'dentist' } as CalendarEvent
    const hers = timed('sophie', 'Work')
    const events = [mine, dentist, hers]
    expect(withoutWork(events, calendars, 'tim')).toEqual([dentist, hers])
    const noon = at('12:00')
    expect(freeMinutesToday(withoutWork([mine], calendars, 'tim'), calendars, ['tim'], TODAY, noon)).toBe(freeMinutesToday([], calendars, ['tim'], TODAY, noon))
    expect(workMinutesToday(withoutWork([mine], calendars, 'tim'), calendars, 'tim', TODAY, noon)).toBe(0)
  })
})
