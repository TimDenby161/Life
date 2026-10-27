import cases from '../../../../supabase/tests/fixtures/recurrence-cases.json'
import { describeRecurrence, nextOccurrence, type RecurrenceRule, upcomingOccurrences } from './recurrence'

describe('nextOccurrence (shared vectors with the SQL implementation)', () => {
  it.each(cases)('$name', ({ rule, anchor, after, expected }) => {
    expect(nextOccurrence(rule as RecurrenceRule, anchor, after)).toBe(expected)
  })
})

describe('upcomingOccurrences', () => {
  it('lists the next bin days', () => {
    expect(upcomingOccurrences({ freq: 'weekly', weekdays: [2] }, '2026-10-20', '2026-10-21', 3)).toEqual([
      '2026-10-27',
      '2026-11-03',
      '2026-11-10',
    ])
  })
  it('stops at until', () => {
    expect(upcomingOccurrences({ freq: 'daily', until: '2026-01-03' }, '2026-01-01', '2026-01-01', 10)).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
    ])
  })
})

describe('describeRecurrence', () => {
  it.each([
    [{ freq: 'daily' }, 'Every day'],
    [{ freq: 'daily', interval: 2 }, 'Every 2 days'],
    [{ freq: 'weekly', weekdays: [2] }, 'Every Tuesday'],
    [{ freq: 'weekly', interval: 2, weekdays: [4, 1] }, 'Every 2 weeks on Mon, Thu'],
    [{ freq: 'weekly', weekdays: [1, 2, 3, 4, 5] }, 'Every weekday'],
    [{ freq: 'monthly', monthDay: 1 }, 'Monthly on the 1st'],
    [{ freq: 'monthly', interval: 3 }, 'Every 3 months on the 20th'],
    [{ freq: 'yearly' }, 'Every year on 20 October'],
    [{ freq: 'weekly', afterDone: true }, "Every week after it's done"],
    [{ freq: 'daily', interval: 10, afterDone: true }, "Every 10 days after it's done"],
  ] as [RecurrenceRule, string][])('%o -> %s', (rule, text) => {
    expect(describeRecurrence(rule, '2026-10-20')).toBe(text)
  })
})
