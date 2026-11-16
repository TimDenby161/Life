import { describe, expect, it } from 'vitest'
import { cashflowTotals, perMonth } from './cashflow'

describe('cashflow', () => {
  it('counts a yearly amount as a twelfth a month', () => {
    expect(perMonth({ amount_minor: 60000, every: 'year' })).toBe(5000)
    expect(perMonth({ amount_minor: 100, every: 'year' })).toBe(8)
    expect(perMonth({ amount_minor: 123456, every: 'month' })).toBe(123456)
  })

  it('adds up money in and out, and what is left', () => {
    expect(
      cashflowTotals([
        { direction: 'in', amount_minor: 300000, every: 'month' },
        { direction: 'in', amount_minor: 250000, every: 'month' },
        { direction: 'out', amount_minor: 120000, every: 'month' },
        { direction: 'out', amount_minor: 60000, every: 'year' },
      ]),
    ).toEqual({ in: 550000, out: 125000, left: 425000 })
  })

  it('goes negative when more goes out than comes in', () => {
    expect(cashflowTotals([{ direction: 'out', amount_minor: 1000, every: 'month' }])).toEqual({ in: 0, out: 1000, left: -1000 })
    expect(cashflowTotals([])).toEqual({ in: 0, out: 0, left: 0 })
  })
})
