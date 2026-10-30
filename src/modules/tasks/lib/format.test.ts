import { describe, expect, it } from 'vitest'
import { delayDays, delayedDate, delayLabel } from './format'

const today = '2026-10-30'

describe('delayDays', () => {
  it('gets longer each time, up to a week', () => {
    expect([0, 1, 2, 3, 4, 9].map((n) => delayDays(n, false))).toEqual([1, 2, 4, 7, 7, 7])
  })
  it('stays at one day for something important', () => {
    expect([0, 1, 5].map((n) => delayDays(n, true))).toEqual([1, 1, 1])
  })
})

describe('delayLabel', () => {
  it('says day or days', () => {
    expect(delayLabel(1)).toBe('Delay 1 day')
    expect(delayLabel(4)).toBe('Delay 4 days')
  })
})

describe('delayedDate', () => {
  it('counts from today for a task due today, overdue or undated', () => {
    expect(delayedDate(today, today, 1)).toBe('2026-10-31')
    expect(delayedDate('2026-10-01', today, 2)).toBe('2026-11-01')
    expect(delayedDate(null, today, 4)).toBe('2026-11-03')
  })
  it('counts from the due date for a task due later', () => {
    expect(delayedDate('2026-11-10', today, 7)).toBe('2026-11-17')
  })
})
