import { mix, plan, type PlanHolding } from './plan'

const h = (ticker: string, pounds: number, target: number | null, extra: Partial<PlanHolding> = {}): PlanHolding => ({
  ticker,
  name: ticker,
  asset_class: 'shares',
  value_minor: pounds * 100,
  target_pct: target,
  action: 'keep',
  reason: null,
  ...extra,
})

const portfolio = [
  h('BOND', 5000, 0, { asset_class: 'bonds' }),
  h('WORLD', 5000, 100),
  h('JUNK', 1000, null, { action: 'sell', reason: 'Leveraged' }),
  h('PICK', 500, null, { action: 'review' }),
]

describe('mix', () => {
  it('splits the total by asset class', () => {
    expect(mix(portfolio)).toEqual({ total: 1150000, shares: 650000, bonds: 500000, cash: 0 })
  })
})

describe('plan', () => {
  it('sets wedding cash aside and puts the rest into the mix', () => {
    const { steps, monthly } = plan(portfolio, { monthly_minor: 35000, wedding_minor: 300000 })
    expect(steps).toEqual([
      { kind: 'sell', ticker: 'JUNK', amount: 100000, reason: 'Leveraged' },
      { kind: 'trim', ticker: 'BOND', amount: 500000 },
      { kind: 'cash', amount: 300000 },
      { kind: 'buy', ticker: 'WORLD', amount: 300000 },
      { kind: 'review', ticker: 'PICK', reason: null },
    ])
    expect(monthly).toEqual([{ ticker: 'WORLD', amount: 35000 }])
  })

  it('leaves 0% holdings alone until the wedding amount is set', () => {
    const { steps } = plan(portfolio, { monthly_minor: 0, wedding_minor: null })
    expect(steps.map((s) => s.kind)).toEqual(['wedding-unset', 'sell', 'buy', 'review'])
    expect(steps.find((s) => s.kind === 'buy')).toMatchObject({ ticker: 'WORLD', amount: 100000 })
  })

  it('counts cash already held towards the wedding', () => {
    const { steps } = plan([...portfolio, h('CASH', 2000, null, { asset_class: 'cash' })], { monthly_minor: 0, wedding_minor: 300000 })
    expect(steps.find((s) => s.kind === 'cash')).toEqual({ kind: 'cash', amount: 100000 })
  })

  it('never sets aside more than there is', () => {
    const { steps } = plan(portfolio, { monthly_minor: 0, wedding_minor: 5000000 })
    expect(steps.find((s) => s.kind === 'cash')).toEqual({ kind: 'cash', amount: 1100000 })
    expect(steps.find((s) => s.kind === 'buy')).toBeUndefined()
  })

  it('skips trades too small to bother with and flags targets that miss 100%', () => {
    const { steps } = plan([h('A', 500, 50), h('B', 510, 40)], { monthly_minor: 0, wedding_minor: 0 })
    expect(steps[0]).toEqual({ kind: 'targets', total: 90 })
    expect(steps.filter((s) => s.kind === 'buy' || s.kind === 'trim')).toEqual([
      { kind: 'trim', ticker: 'B', amount: 6100 },
      { kind: 'buy', ticker: 'A', amount: 6100 },
    ])
  })
})
