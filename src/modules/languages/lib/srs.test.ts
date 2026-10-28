import { learnedSchedule, MAX_INTERVAL, nextInterval, reviewedSchedule } from './srs'

describe('spaced repetition', () => {
  it('brings a new item back the next day', () => {
    expect(learnedSchedule('2026-10-28')).toEqual({ learned_on: '2026-10-28', due_on: '2026-10-29', interval_days: 1 })
  })

  it('grows the gap each time an item is remembered, up to a cap', () => {
    const gaps = [1]
    while (gaps.length < 9) gaps.push(nextInterval(gaps.at(-1)!, true))
    expect(gaps).toEqual([1, 3, 8, 20, 50, 125, MAX_INTERVAL, MAX_INTERVAL, MAX_INTERVAL])
  })

  it('starts again from a day when an item is forgotten', () => {
    expect(reviewedSchedule({ interval_days: 20, reviews: 4, lapses: 0 }, false, '2026-10-28')).toEqual({
      interval_days: 1,
      due_on: '2026-10-29',
      reviews: 5,
      lapses: 1,
      last_reviewed_on: '2026-10-28',
    })
  })

  it('schedules a remembered item from the day it was reviewed, across the clock change', () => {
    expect(reviewedSchedule({ interval_days: 3, reviews: 1, lapses: 0 }, true, '2026-10-24').due_on).toBe('2026-11-01')
  })
})
