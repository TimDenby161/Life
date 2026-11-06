import { analyseFinance, balanceOn, type FinAccount, type FinanceInput, type FinSnapshot, type FinTx, monthEnd, pounds, positionOn, updateDates } from '../../../../supabase/functions/_shared/agents/finance.ts'
import { ALEX, BOTH, SAM } from './fixtures'

const TODAY = '2026-11-06'
const members = [
  { id: ALEX, name: 'Alex' },
  { id: SAM, name: 'Sam' },
]
const account = (id: string, account_type: string, owner_id: string | null = null): FinAccount => ({
  id,
  account_type,
  ownership: owner_id ? 'personal' : 'joint',
  owner_id,
  opening_balance_minor: 0,
  opening_date: '2025-01-01',
})
const accounts = [account('joint-savings', 'savings'), account('alex-isa', 'investment', ALEX), account('sam-card', 'credit_card', SAM)]
const snap = (account_id: string, as_of: string, pounds: number, source = 'sheet'): FinSnapshot => ({
  account_id,
  as_of,
  balance_minor: pounds * 100,
  source,
  created_at: `${as_of}T12:00:00Z`,
})
const tx = (account_id: string, occurred_on: string, pounds: number): FinTx => ({ account_id, occurred_on, amount_minor: pounds * 100, created_at: `${occurred_on}T13:00:00Z` })
/** One sheet update: savings, ISA and card (owed, negative) in pounds. */
const update = (date: string, savings: number, isa: number, card: number) => [
  snap('joint-savings', date, savings),
  snap('alex-isa', date, isa),
  snap('sam-card', date, card),
]
const input = (snapshots: FinSnapshot[], fields: Partial<FinanceInput> = {}): FinanceInput => ({ today: TODAY, accounts, snapshots, transactions: [], members, ...fields })
const byKind = (out: ReturnType<typeof analyseFinance>, kind: string) => out.find((s) => s.kind === kind)

describe('Finance: the position', () => {
  it('adds up net worth at the latest update, by person and joint', () => {
    const out = analyseFinance(input([...update('2026-10-14', 20_000, 30_000, -1_000)]), BOTH)
    const s = byKind(out, 'fin_position')!
    expect(s.title).toBe('Net worth £49,000')
    expect(s.reason).toBe('Alex £30,000, Sam −£1,000, joint £20,000. Balances as of 14 Oct.')
    expect(s.dedupe_key).toBe('fin:position:2026-10-14')
    expect(s.severity).toBe(1)
    expect(s.action).toBeNull()
    expect(s.recipients).toEqual(BOTH)
  })

  it('says what changed since the last update and what moved it', () => {
    const out = analyseFinance(input([...update('2026-09-14', 20_000, 27_000, -1_000), ...update('2026-10-14', 19_500, 30_100, -1_000)]), BOTH)
    const s = byKind(out, 'fin_position')!
    expect(s.title).toBe('Net worth £48,600, up £2,600 since 14 Sep')
    expect(s.reason).toMatch(/^Investments \+£3,100, savings −£500\. /)
  })

  it('compares with a year ago', () => {
    const out = analyseFinance(input([...update('2025-10-15', 10_000, 30_000, 0), ...update('2026-10-14', 20_000, 30_000, 0)]), BOTH)
    expect(byKind(out, 'fin_position')!.reason).toContain('Up £10,000 (25%) on a year ago.')
  })

  it('flags a fall of 3% or more, and a run of falls', () => {
    const fall = analyseFinance(input([...update('2026-09-14', 20_000, 30_000, 0), ...update('2026-10-14', 20_000, 28_000, 0)]), BOTH)
    expect(byKind(fall, 'fin_position')).toMatchObject({ severity: 2, title: 'Net worth £48,000, down £2,000 since 14 Sep' })
    const small = analyseFinance(input([...update('2026-09-14', 20_000, 30_000, 0), ...update('2026-10-14', 20_000, 29_500, 0)]), BOTH)
    expect(byKind(small, 'fin_position')!.severity).toBe(1)
    const run = analyseFinance(
      input([
        ...update('2026-07-14', 20_000, 30_000, 0),
        ...update('2026-08-14', 20_000, 29_900, 0),
        ...update('2026-09-14', 20_000, 29_800, 0),
        ...update('2026-10-14', 20_000, 29_700, 0),
      ]),
      BOTH,
    )
    expect(byKind(run, 'fin_position')).toMatchObject({ severity: 2 })
    expect(byKind(run, 'fin_position')!.reason).toContain('Down 3 updates in a row.')
  })

  it('marks passing a £50,000 step', () => {
    const out = analyseFinance(input([...update('2026-09-14', 20_000, 29_000, 0), ...update('2026-10-14', 20_000, 31_000, 0)]), BOTH)
    expect(byKind(out, 'fin_position')!.reason).toMatch(/^Passed £50,000\. /)
  })

  it('counts transactions after the latest balance, as the page does', () => {
    const out = analyseFinance(input(update('2026-10-14', 20_000, 30_000, 0), { transactions: [tx('joint-savings', '2026-10-20', -500), tx('joint-savings', '2026-12-01', -9_000)] }), BOTH)
    expect(byKind(out, 'fin_position')!.title).toBe('Net worth £50,000')
  })

  it('says nothing with no accounts, or when switched off', () => {
    expect(analyseFinance(input([], { accounts: [] }), BOTH)).toEqual([])
    expect(analyseFinance(input(update('2026-10-14', 1, 1, 0)), [])).toEqual([])
  })

  it('goes only to the people who have it on', () => {
    expect(analyseFinance(input(update('2026-10-14', 1, 1, 0)), [ALEX]).every((s) => s.recipients.join() === ALEX)).toBe(true)
  })
})

describe('Finance: old balances', () => {
  it('asks for an update after 45 days, offering a task', () => {
    const out = analyseFinance(input(update('2026-09-14', 20_000, 30_000, 0)), BOTH)
    const s = byKind(out, 'fin_stale')!
    expect(s).toMatchObject({ severity: 2, title: 'Balances last updated 14 Sep', dedupe_key: 'fin:stale:2026-09-14' })
    expect(s.action).toEqual({ type: 'create_task', title: 'Update the finance balances', list: 'joint', due_date: '2026-11-07' })
    expect(byKind(analyseFinance(input(update('2026-10-14', 20_000, 30_000, 0)), BOTH), 'fin_stale')).toBeUndefined()
  })
})

describe('Finance: cards and loans', () => {
  it('flags card and loan balances rising three updates running', () => {
    const out = analyseFinance(
      input([
        ...update('2026-07-14', 20_000, 30_000, -400),
        ...update('2026-08-14', 20_000, 30_000, -700),
        ...update('2026-09-14', 20_000, 30_000, -900),
        ...update('2026-10-14', 20_000, 30_000, -1_200),
      ]),
      BOTH,
    )
    expect(byKind(out, 'fin_debt')).toMatchObject({ severity: 2, title: 'Cards and loans £1,200, rising since 14 Jul', reason: 'Up £800 over the last 3 updates.' })
  })

  it('stays quiet when they dipped in between, or are small', () => {
    const dip = [...update('2026-07-14', 1, 1, -400), ...update('2026-08-14', 1, 1, -700), ...update('2026-09-14', 1, 1, -600), ...update('2026-10-14', 1, 1, -1_200)]
    expect(byKind(analyseFinance(input(dip), BOTH), 'fin_debt')).toBeUndefined()
    const small = [...update('2026-07-14', 1, 1, -100), ...update('2026-08-14', 1, 1, -200), ...update('2026-09-14', 1, 1, -300), ...update('2026-10-14', 1, 1, -400)]
    expect(byKind(analyseFinance(input(small), BOTH), 'fin_debt')).toBeUndefined()
  })

  it('ignores the mortgage', () => {
    const withMortgage = input(
      [
        ...['2026-07-14', '2026-08-14', '2026-09-14', '2026-10-14'].flatMap((d, i) => [
          snap('joint-savings', d, 1),
          snap('mortgage', d, -200_000 - i * 1_000),
        ]),
      ],
      { accounts: [...accounts, account('mortgage', 'mortgage')] },
    )
    expect(byKind(analyseFinance(withMortgage, BOTH), 'fin_debt')).toBeUndefined()
  })
})

describe('Finance: without the sheet', () => {
  // Opening balances and transactions only, like the local demo data.
  const live = (transactions: FinTx[]) =>
    input([], { accounts: [{ ...account('current', 'current'), opening_balance_minor: 1_000_00 }], transactions })

  it('compares today with the end of last month, one suggestion per month', () => {
    const out = analyseFinance(live([tx('current', '2026-10-10', 500), tx('current', '2026-11-02', -200)]), BOTH)
    expect(byKind(out, 'fin_position')).toMatchObject({ dedupe_key: 'fin:position:2026-11', title: 'Net worth £1,300, down £200 since 31 Oct' })
  })

  it('never says balances are old: they’re worked out to today', () => {
    expect(byKind(analyseFinance(live([]), BOTH), 'fin_stale')).toBeUndefined()
  })

  it('talks in months', () => {
    const falling = ['2026-08-15', '2026-09-15', '2026-10-15', '2026-11-02'].map((d) => tx('current', d, -100))
    expect(byKind(analyseFinance(live(falling), BOTH), 'fin_position')!.reason).toContain('Down 4 months in a row.')
  })
})

describe('Finance: matching the Finances page', () => {
  it('uses the sheet’s dates when there are any, otherwise month ends and today', () => {
    const snaps = [snap('joint-savings', '2026-10-01', 1, 'manual'), snap('joint-savings', '2026-10-14', 1), snap('alex-isa', '2026-12-01', 1)]
    expect(updateDates(input(snaps))).toEqual({ dates: ['2026-10-14'], fromSheet: true })
    const { dates, fromSheet } = updateDates(input([snap('joint-savings', '2026-10-01', 1, 'manual')]))
    expect(fromSheet).toBe(false)
    expect(dates).toHaveLength(12)
    expect(dates.slice(-3)).toEqual(['2026-09-30', '2026-10-31', TODAY])
    expect(dates[0]).toBe('2025-12-31')
  })

  it('finds month ends', () => {
    expect(monthEnd('2026-03-15', 1)).toBe('2026-02-28')
    expect(monthEnd('2028-03-15', 1)).toBe('2028-02-29')
    expect(monthEnd('2026-01-15', 1)).toBe('2025-12-31')
    expect(monthEnd('2026-11-06', 0)).toBe('2026-11-30')
  })

  it('values a house between two valuations on a straight line', () => {
    const house = account('house', 'property')
    const own = [snap('house', '2026-01-01', 300_000, 'estimate'), snap('house', '2027-01-01', 336_500, 'estimate')]
    expect(balanceOn(house, own, [], '2026-07-02')).toBe(31_820_000)
    expect(balanceOn({ ...house, opening_date: '2026-01-01' }, own, [], '2025-12-31')).toBeNull()
    expect(balanceOn(accounts[0], [snap('joint-savings', '2026-01-01', 5), snap('joint-savings', '2027-01-01', 10)], [], '2026-07-02')).toBe(500)
  })

  it('adds transactions after a balance, including later the same day', () => {
    const own = [snap('joint-savings', '2026-10-14', 100)]
    const same = { ...tx('joint-savings', '2026-10-14', 5), created_at: '2026-10-14T11:00:00Z' }
    expect(balanceOn(accounts[0], own, [same, tx('joint-savings', '2026-10-14', 7), tx('joint-savings', '2026-10-15', 1)], '2026-10-15')).toBe(10_800)
  })

  it('takes each account at its latest balance on or before the date', () => {
    const p = positionOn(input([snap('joint-savings', '2026-09-14', 100), snap('alex-isa', '2026-10-14', 50)]), '2026-10-14')
    expect(p.total).toBe(15_000)
  })

  it('shows whole pounds, with a proper minus', () => {
    expect(pounds(31_287_453)).toBe('£312,875')
    expect(pounds(-200_000)).toBe('−£2,000')
  })
})
