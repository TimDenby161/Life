import { describe, expect, it } from 'vitest'
import { delayedDate } from './format'

const today = '2026-10-30'

describe('delayedDate', () => {
  it('counts from today for a task due today, overdue or undated', () => {
    expect(delayedDate(today, today)).toBe('2026-11-02')
    expect(delayedDate('2026-10-01', today)).toBe('2026-11-02')
    expect(delayedDate(null, today)).toBe('2026-11-02')
  })
  it('counts from the due date for a task due later', () => {
    expect(delayedDate('2026-11-10', today)).toBe('2026-11-13')
  })
})
