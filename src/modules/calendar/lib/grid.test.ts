import { bucketByDay, type CalendarEvent, eventDays, monthGrid, plainText, weekDays } from './grid'

const ev = (o: Partial<CalendarEvent>): CalendarEvent => ({
  id: 'e',
  calendarId: 'c',
  calendarName: 'Shared',
  color: 'sky',
  title: 'Event',
  description: null,
  location: null,
  start: '2026-10-22T10:00:00+01:00',
  end: '2026-10-22T11:00:00+01:00',
  allDay: false,
  htmlLink: null,
  ...o,
})

describe('calendar grid', () => {
  it('builds full Monday-first weeks around a month', () => {
    const grid = monthGrid('2026-10-01')
    expect(grid[0][0]).toBe('2026-09-28')
    expect(grid.at(-1)!.at(-1)).toBe('2026-11-01')
    expect(grid.every((w) => w.length === 7)).toBe(true)
  })
  it('supports Sunday-first weeks', () => {
    expect(weekDays('2026-10-22', 0)[0]).toBe('2026-10-18')
    expect(weekDays('2026-10-22', 1)[0]).toBe('2026-10-19')
  })
})

describe('eventDays', () => {
  it('treats all-day end dates as exclusive', () => {
    expect(eventDays(ev({ allDay: true, start: '2026-10-24', end: '2026-10-27' }))).toEqual(['2026-10-24', '2026-10-25', '2026-10-26'])
  })
  it('does not spill an event ending at midnight into the next day', () => {
    expect(eventDays(ev({ start: '2026-10-22T20:00:00+01:00', end: '2026-10-23T00:00:00+01:00' }))).toEqual(['2026-10-22'])
  })
  it('spans overnight events', () => {
    expect(eventDays(ev({ start: '2026-10-22T22:00:00+01:00', end: '2026-10-23T02:00:00+01:00' }))).toEqual(['2026-10-22', '2026-10-23'])
  })
  it('sorts all-day events first within a day', () => {
    const map = bucketByDay([ev({ id: 'timed' }), ev({ id: 'allday', allDay: true, start: '2026-10-22', end: '2026-10-23' })])
    expect(map.get('2026-10-22')!.map((e) => e.id)).toEqual(['allday', 'timed'])
  })
})

describe('plainText', () => {
  it('strips markup and scripts from descriptions', () => {
    expect(plainText('Bring <b>cake</b><br>and <script>alert(1)</script>forks')).toBe('Bring cake\nand alert(1)forks')
  })
})
