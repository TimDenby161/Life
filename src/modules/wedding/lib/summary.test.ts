import { budgetTotals, byCategory, guestCounts, taskCounts } from './summary'

describe('wedding budget', () => {
  const items = [
    { category: 'Venue', budget_minor: 900_000, paid_minor: 200_000 },
    { category: 'Food & drink', budget_minor: 650_000, paid_minor: 0 },
    { category: 'Food & drink', budget_minor: 150_000, paid_minor: 150_000 },
    { category: 'Extras', budget_minor: 50_000, paid_minor: 60_000 },
  ]

  it('totals budget, paid and what is left to pay', () => {
    expect(budgetTotals(items)).toEqual({ budget: 1_750_000, paid: 410_000, remaining: 1_340_000 })
  })

  it('groups lines by category, biggest first', () => {
    expect(byCategory(items).map((g) => [g.category, g.items.length, g.totals.budget])).toEqual([
      ['Venue', 1, 900_000],
      ['Food & drink', 2, 800_000],
      ['Extras', 1, 50_000],
    ])
    expect(byCategory(items).find((g) => g.category === 'Extras')!.totals.remaining).toBe(0)
  })
})

describe('guest counts', () => {
  it('counts people, with plus-ones', () => {
    const guests = [
      { invite: 'day', rsvp: 'yes', plus_one: true },
      { invite: 'day', rsvp: 'pending', plus_one: false },
      { invite: 'evening', rsvp: 'no', plus_one: false },
      { invite: 'evening', rsvp: 'yes', plus_one: false },
    ]
    expect(guestCounts(guests)).toEqual({ invited: 5, day: 3, evening: 2, coming: 3, notComing: 1, awaiting: 1 })
  })
})

describe('checklist counts', () => {
  it('counts done, open and overdue', () => {
    const tasks = [
      { done_at: '2026-10-01T10:00:00Z', due_date: '2026-09-01' },
      { done_at: null, due_date: '2026-10-01' },
      { done_at: null, due_date: '2027-01-01' },
      { done_at: null, due_date: null },
    ]
    expect(taskCounts(tasks, '2026-10-26')).toEqual({ done: 1, open: 3, overdue: 1 })
  })
})
