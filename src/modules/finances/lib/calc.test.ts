import { formatMoney, parseMoney, toMoneyInput } from '@/lib/money'
import { activeBudgets, balanceOn, balanceSeries, goalProgress, monthlyFlows, netWorth, spendingByCategory, type AccountLike, type TxLike } from './calc'

const acct = (o: Partial<AccountLike> & { id: string }): AccountLike => ({
  name: o.id,
  currency: 'GBP',
  ownership: 'joint',
  owner_id: null,
  opening_balance_minor: 0,
  opening_date: '2026-01-01',
  is_liability: false,
  include_in_net_worth: true,
  archived_at: null,
  account_type: 'current',
  ...o,
})
let n = 0
const tx = (o: Partial<TxLike> & { account_id: string; amount_minor: number; occurred_on: string }): TxLike => ({
  id: `t${++n}`,
  kind: 'expense',
  category_id: null,
  created_at: `${o.occurred_on}T12:00:00Z`,
  ...o,
})

const current = acct({ id: 'cur', opening_balance_minor: 100_000 })
const card = acct({ id: 'card', account_type: 'credit_card', is_liability: true, opening_balance_minor: -20_000 })
const isa = acct({ id: 'isa', ownership: 'personal', owner_id: 'sophie' })
const txs: TxLike[] = [
  tx({ account_id: 'cur', amount_minor: 250_000, occurred_on: '2026-09-28', kind: 'income', category_id: 'salary' }),
  tx({ account_id: 'cur', amount_minor: -4_599, occurred_on: '2026-10-02', category_id: 'groceries' }),
  tx({ account_id: 'cur', amount_minor: 1_000, occurred_on: '2026-10-05', category_id: 'groceries' }), // refund
  tx({ account_id: 'card', amount_minor: -12_000, occurred_on: '2026-10-10', category_id: 'eating' }),
  // Transfer: both legs, must not count as income or spending.
  tx({ account_id: 'cur', amount_minor: -50_000, occurred_on: '2026-10-15', kind: 'transfer' }),
  tx({ account_id: 'isa', amount_minor: 50_000, occurred_on: '2026-10-15', kind: 'transfer' }),
]
const currency = new Map([['cur', 'GBP'], ['card', 'GBP'], ['isa', 'GBP']])

describe('money', () => {
  it('parses input into exact minor units', () => {
    expect(parseMoney('12.34')).toBe(1234)
    expect(parseMoney('£1,234.5')).toBe(123450)
    expect(parseMoney('0.1')).toBe(10)
    expect(parseMoney('-3')).toBe(-300)
    expect(parseMoney('.99')).toBe(99)
    expect(parseMoney('1.234')).toBeNull()
    expect(parseMoney('abc')).toBeNull()
    expect(parseMoney('1000', 'JPY')).toBe(1000)
  })
  it('avoids float drift: 0.1 + 0.2 in pence is exact', () => {
    expect(parseMoney('0.1')! + parseMoney('0.2')!).toBe(parseMoney('0.3'))
  })
  it('round-trips and formats', () => {
    expect(toMoneyInput(123456)).toBe('1234.56')
    expect(toMoneyInput(-5)).toBe('-0.05')
    expect(formatMoney(123456)).toBe('£1,234.56')
    expect(formatMoney(-2000)).toBe('-£20.00')
  })
})

describe('balances', () => {
  it('adds transactions to the opening balance', () => {
    expect(balanceOn(current, [], txs, '2026-10-31')).toBe(100_000 + 250_000 - 4_599 + 1_000 - 50_000)
    expect(balanceOn(current, [], txs, '2026-09-30')).toBe(350_000)
    expect(balanceOn(current, [], txs, '2025-12-31')).toBeNull()
  })

  it('uses the latest recorded balance as the base', () => {
    const snaps = [{ account_id: 'cur', as_of: '2026-10-03', balance_minor: 300_000, created_at: '2026-10-03T20:00:00Z' }]
    // Only the refund (05 Oct) and the transfer (15 Oct) come after the recording.
    expect(balanceOn(current, snaps, txs, '2026-10-31')).toBe(300_000 + 1_000 - 50_000)
  })

  it('counts same-day transactions entered after the recording', () => {
    const snaps = [{ account_id: 'cur', as_of: '2026-10-02', balance_minor: 1_000, created_at: '2026-10-02T08:00:00Z' }]
    // The 02 Oct grocery shop was entered at 12:00, after the 08:00 recording.
    expect(balanceOn(current, snaps, txs, '2026-10-02')).toBe(1_000 - 4_599)
  })

  it('flags recorded vs calculated points in a series', () => {
    const snaps = [{ account_id: 'isa', as_of: '2026-10-20', balance_minor: 51_000, created_at: '2026-10-20T09:00:00Z' }]
    const series = balanceSeries(isa, snaps, txs, 3, '2026-10-22')
    expect(series.map((p) => [p.date, p.balance, p.recorded])).toEqual([
      ['2026-08-31', 0, false],
      ['2026-09-30', 0, false],
      ['2026-10-20', 51_000, true],
      ['2026-10-22', 51_000, false],
    ])
  })
})

describe('net worth', () => {
  it('sums assets and liabilities by owner', () => {
    const balances = new Map([['cur', 296_401], ['card', -32_000], ['isa', 50_000]])
    const [gbp] = netWorth([current, card, isa], balances)
    expect(gbp).toEqual({
      currency: 'GBP',
      total: 314_401,
      assets: 346_401,
      liabilities: -32_000,
      byOwner: { joint: 264_401, sophie: 50_000 },
      byGroup: {
        all: { cash: 346_401, cards: -32_000 },
        joint: { cash: 296_401, cards: -32_000 },
        sophie: { cash: 50_000 },
      },
    })
  })
  it('groups property, pensions and mortgages for the breakdown', () => {
    const house = acct({ id: 'house', account_type: 'property' })
    const car = acct({ id: 'car', account_type: 'vehicle' })
    const mortgage = acct({ id: 'mort', account_type: 'mortgage', is_liability: true })
    const pension = acct({ id: 'pen', account_type: 'pension', ownership: 'personal', owner_id: 'tim' })
    const [gbp] = netWorth([house, car, mortgage, pension], new Map([['house', 39_700_000], ['car', 525_000], ['mort', -23_342_767], ['pen', 2_875_800]]))
    expect(gbp.byGroup.all).toEqual({ property: 40_225_000, loans: -23_342_767, pensions: 2_875_800 })
    expect(gbp.byGroup.tim).toEqual({ pensions: 2_875_800 })
  })
  it('keeps currencies separate', () => {
    const usd = acct({ id: 'usd', currency: 'USD', opening_balance_minor: 100 })
    const result = netWorth([current, usd], new Map([['cur', 1], ['usd', 100]]))
    expect(result.map((r) => r.currency)).toEqual(['GBP', 'USD'])
  })
})

describe('flows', () => {
  it('excludes transfers from income and spending; refunds reduce spending', () => {
    const flows = monthlyFlows(txs, currency, 'GBP', 2, '2026-10-22')
    expect(flows).toEqual([
      { month: '2026-09', label: 'Sep', income: 250_000, spending: 0, net: 250_000 },
      { month: '2026-10', label: 'Oct', income: 0, spending: 4_599 - 1_000 + 12_000, net: -(4_599 - 1_000 + 12_000) },
    ])
  })
  it('groups spending by category', () => {
    const s = spendingByCategory(txs, currency, 'GBP', '2026-10-01', '2026-10-31')
    expect(Object.fromEntries(s)).toEqual({ groceries: 3_599, eating: 12_000 })
  })
})

describe('budgets and goals', () => {
  it('picks the most recent budget in force for the month', () => {
    const budgets = [
      { id: 'a', category_id: 'groceries', amount_minor: 40_000, currency: 'GBP', starts_month: '2026-01-01', ends_month: null },
      { id: 'b', category_id: 'groceries', amount_minor: 45_000, currency: 'GBP', starts_month: '2026-09-01', ends_month: null },
      { id: 'c', category_id: 'eating', amount_minor: 10_000, currency: 'GBP', starts_month: '2026-01-01', ends_month: '2026-06-01' },
    ]
    expect(activeBudgets(budgets, '2026-10-01').map((b) => b.id)).toEqual(['b'])
    expect(activeBudgets(budgets, '2026-03-01').map((b) => b.id).sort()).toEqual(['a', 'c'])
  })
  it('measures goal progress from the linked account or manual amount', () => {
    expect(goalProgress({ target_minor: 100_000, account_id: 'isa', manual_saved_minor: 0 }, new Map([['isa', 25_000]]))).toEqual({ saved: 25_000, pct: 25 })
    expect(goalProgress({ target_minor: 1_000, account_id: null, manual_saved_minor: 5_000 }, new Map())).toEqual({ saved: 5_000, pct: 100 })
  })
})
