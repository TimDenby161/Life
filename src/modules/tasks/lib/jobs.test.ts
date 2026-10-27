import { agoInWords, dueInWords, jobRule, lastDoneOf, nextDueAfter } from './jobs'

describe('jobs', () => {
  it('recognises job rules only', () => {
    expect(jobRule({ freq: 'weekly', afterDone: true })).toEqual({ freq: 'weekly', afterDone: true })
    expect(jobRule({ freq: 'weekly' })).toBeNull()
    expect(jobRule(null)).toBeNull()
  })

  it('takes the later of the hand-set date and the latest completion', () => {
    expect(lastDoneOf(null, null)).toBeNull()
    expect(lastDoneOf('2026-10-20', null)).toBe('2026-10-20')
    expect(lastDoneOf(null, '2026-10-25T09:00:00Z')).toBe('2026-10-25')
    expect(lastDoneOf('2026-10-26', '2026-10-25T09:00:00Z')).toBe('2026-10-26')
    // 23:30 UTC on 25 Oct (after the clocks change) is still the 25th in London.
    expect(lastDoneOf('2026-10-20', '2026-10-25T23:30:00Z')).toBe('2026-10-25')
  })

  it('is due one interval after it was last done', () => {
    expect(nextDueAfter({ freq: 'weekly', afterDone: true }, '2026-10-20', '2026-10-27')).toBe('2026-10-27')
    expect(nextDueAfter({ freq: 'daily', interval: 10, afterDone: true }, '2026-10-20', '2026-10-27')).toBe('2026-10-30')
    expect(nextDueAfter({ freq: 'monthly', afterDone: true }, '2026-01-31', '2026-02-01')).toBe('2026-02-28')
    expect(nextDueAfter({ freq: 'weekly', afterDone: true }, null, '2026-10-27')).toBe('2026-10-27')
  })

  it('describes due dates and last-done dates', () => {
    expect(dueInWords('2026-10-27', '2026-10-27')).toBe('Due today')
    expect(dueInWords('2026-11-01', '2026-10-27')).toBe('Due in 5 days')
    expect(dueInWords('2026-10-24', '2026-10-27')).toBe('3 days overdue')
    expect(agoInWords('2026-10-26', '2026-10-27')).toBe('yesterday')
    expect(agoInWords('2026-10-20', '2026-10-27')).toBe('7 days ago')
  })
})
