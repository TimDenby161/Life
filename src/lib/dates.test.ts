import { formatDay, formatDayInline, todayLabel } from './dates'

const FRIDAY = new Date('2026-11-06T09:00:00')

describe('today with its weekday', () => {
  it('names the day', () => {
    expect(todayLabel(FRIDAY)).toBe('Today (Friday)')
    expect(formatDay('2026-11-06', FRIDAY)).toBe('Today (Friday)')
    expect(formatDay('2026-11-07', FRIDAY)).toBe('Tomorrow')
  })

  it('reads naturally mid-sentence', () => {
    expect(formatDayInline('2026-11-06', FRIDAY)).toBe('today (Friday)')
    expect(formatDayInline('2026-11-07', FRIDAY)).toBe('tomorrow')
    expect(formatDayInline('2026-11-10', FRIDAY)).toBe('Tue 10 Nov')
  })
})
