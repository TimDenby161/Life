import type { AccountLike, SnapshotLike } from './calc'
import { type GoalInput, goalAccounts, goalPlans, type Point, recentChanges, trendConcerns, trendPoints } from './insights'

const TODAY = '2026-11-10'
const goal = (g: Partial<GoalInput> & { id: string }): GoalInput => ({
  name: g.id,
  target_minor: 1200_00,
  target_date: null,
  account_id: null,
  manual_saved_minor: 0,
  pot_id: null,
  sort_order: 0,
  ownership: 'joint',
  owner_id: null,
  created_at: '2026-11-01T00:00:00Z',
  ...g,
})

describe('goalPlans', () => {
  it('works out what a dated goal needs a month, rounded up to the pound', () => {
    const [p] = goalPlans([goal({ id: 'holiday', target_date: '2027-11-10', manual_saved_minor: 200_00 })], [], new Map(), TODAY)
    // £1,000 to go over 12 months.
    expect(p).toMatchObject({ saved: 200_00, left: 1000_00, status: 'on_track' })
    expect(p.perMonth).toBe(8400)
  })

  it('fills a pot’s goals in order from its account, and counts each goal’s share', () => {
    const goals = [
      goal({ id: 'second', pot_id: 'pot', sort_order: 1, target_date: '2027-05-10' }),
      goal({ id: 'first', pot_id: 'pot', sort_order: 0, target_date: '2027-05-10' }),
    ]
    const plans = goalPlans(goals, [{ id: 'pot', name: 'Holidays', account_id: 'acc' }], new Map([['acc', 1500_00]]), TODAY)
    expect(plans.find((p) => p.id === 'first')).toMatchObject({ saved: 1200_00, pot: 'Holidays' })
    expect(plans.find((p) => p.id === 'second')).toMatchObject({ saved: 300_00, left: 900_00 })
  })

  it('has nothing a month for a goal that is reached, undated or past its date', () => {
    const plans = goalPlans(
      [
        goal({ id: 'done', manual_saved_minor: 5000_00, target_date: '2027-01-01' }),
        goal({ id: 'someday' }),
        goal({ id: 'late', target_date: '2026-10-01' }),
      ],
      [],
      new Map(),
      TODAY,
    )
    expect(Object.fromEntries(plans.map((p) => [p.id, [p.status, p.perMonth]]))).toEqual({ done: ['reached', null], someday: ['no_date', null], late: ['past_date', null] })
  })

  it('flags a goal more than a month’s saving behind a steady pace since it was set', () => {
    const [p] = goalPlans([goal({ id: 'wedding', target_minor: 2400_00, created_at: '2025-11-10T00:00:00Z', target_date: '2027-11-10' })], [], new Map(), TODAY)
    // Half the time has gone, nothing saved: £1,200 expected, £100 a month needed.
    expect(p.status).toBe('behind')
    expect(p.expected).toBeCloseTo(1200_00, -3)
  })

  it('puts dated goals first, soonest first', () => {
    const plans = goalPlans([goal({ id: 'b' }), goal({ id: 'late', target_date: '2028-01-01' }), goal({ id: 'soon', target_date: '2027-01-01' })], [], new Map(), TODAY)
    expect(plans.map((p) => p.id)).toEqual(['soon', 'late', 'b'])
  })

  it('knows which accounts hold goal money', () => {
    expect([...goalAccounts([goal({ id: 'a', account_id: 'own' }), goal({ id: 'b', pot_id: 'pot' })], [{ id: 'pot', name: 'P', account_id: 'potacc' }, { id: 'empty', name: 'E', account_id: 'unused' }])]).toEqual(['own', 'potacc'])
  })
})

const pt = (date: string, total: number, groups: Point['groups'] = {}, goalMoney = 0): Point => ({ date, total: total * 100, groups: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v! * 100])), goalMoney: goalMoney * 100 })
const keys = (points: Point[], needed = 0, today = '2026-11-05') => trendConcerns(points, needed * 100, today).map((c) => c.key)

describe('trendConcerns', () => {
  it('is quiet when things are steadily growing', () => {
    expect(keys([pt('2026-08-31', 10000), pt('2026-09-30', 11000), pt('2026-10-31', 12000)])).toEqual([])
  })

  it('flags a fall at the latest update, and a run of falls as more serious', () => {
    const one = trendConcerns([pt('2026-09-30', 12000, { savings: 5000 }), pt('2026-10-31', 11000, { savings: 4000 })], 0, '2026-11-05')
    expect(one).toEqual([{ key: 'fall', severity: 'medium', title: 'Net worth down £1,000 since 30 Sep', detail: 'Savings −£1,000.' }])
    const run = trendConcerns([pt('2026-08-31', 13000), pt('2026-09-30', 12000), pt('2026-10-31', 11000)], 0, '2026-11-05')
    expect(run[0]).toMatchObject({ key: 'fall', severity: 'high', title: 'Net worth down 2 updates in a row', detail: '−£2,000 since 31 Aug.' })
  })

  it('ignores a fall too small to matter', () => {
    expect(keys([pt('2026-09-30', 12000), pt('2026-10-31', 11900)])).toEqual([])
  })

  it('flags growth slowing to under half the pace of the months before', () => {
    const points = [pt('2026-06-30', 10000), pt('2026-07-31', 11000), pt('2026-08-31', 12000), pt('2026-09-30', 13000), pt('2026-10-31', 13100)]
    expect(keys(points)).toEqual(['slowing'])
  })

  it('flags money you hold falling three updates in a row, but not a car losing value', () => {
    const points = [
      pt('2026-07-31', 20000, { savings: 8000, vehicles: 9000 }),
      pt('2026-08-31', 20500, { savings: 7500, vehicles: 8800 }),
      pt('2026-09-30', 21000, { savings: 7000, vehicles: 8600 }),
      pt('2026-10-31', 21500, { savings: 6500, vehicles: 8400 }),
    ]
    expect(keys(points)).toEqual(['group:savings'])
  })

  it('flags cards and loans owed growing two updates in a row', () => {
    const points = [pt('2026-08-31', 10000, { cards: -500 }), pt('2026-09-30', 10500, { cards: -900 }), pt('2026-10-31', 11000, { cards: -1400, loans: -100 })]
    expect(trendConcerns(points, 0, '2026-11-05')[0]).toMatchObject({ key: 'debt', severity: 'high', title: 'Cards and loans up to £1,500' })
  })

  it('flags goal accounts growing more slowly than the goals need', () => {
    const points = [pt('2026-07-31', 10000, {}, 1000), pt('2026-08-31', 10500, {}, 1100), pt('2026-09-30', 11000, {}, 1200), pt('2026-10-31', 11500, {}, 1300)]
    // The goal accounts grow £100 a month.
    expect(keys(points, 90)).toEqual([])
    const short = trendConcerns(points, 500_00, '2026-11-05')
    expect(short).toEqual([expect.objectContaining({ key: 'goals', severity: 'high', title: 'Goals need £500 a month' })])
  })

  it('says when the balances are too old to trust', () => {
    expect(keys([pt('2026-08-31', 10000), pt('2026-09-15', 11000)], 0, TODAY)).toEqual(['stale'])
  })

  it('lists the most serious first', () => {
    const points = [pt('2026-08-31', 13000, { cards: -100 }), pt('2026-09-30', 12900, { cards: -500 }), pt('2026-10-31', 12800, { cards: -900 })]
    expect(trendConcerns(points, 0, '2026-11-05')[0].severity).toBe('high')
  })
})

describe('trendPoints and recentChanges', () => {
  const account = (id: string, type: string): AccountLike => ({
    id, name: id, currency: 'GBP', ownership: 'joint', owner_id: null, opening_balance_minor: 0, opening_date: '2026-01-01', is_liability: null, include_in_net_worth: true, archived_at: null, account_type: type,
  })
  const snap = (account_id: string, as_of: string, pounds: number): SnapshotLike => ({ account_id, as_of, balance_minor: pounds * 100, created_at: `${as_of}T12:00:00Z` })

  it('adds up net worth, its groups and the goal accounts on each date', () => {
    const accounts = [account('isa', 'savings'), account('card', 'credit_card')]
    const snaps = [snap('isa', '2026-09-30', 1000), snap('card', '2026-09-30', -200), snap('isa', '2026-10-31', 1500), snap('card', '2026-10-31', -100)]
    const points = trendPoints(accounts, snaps, [], ['2025-12-31', '2026-09-30', '2026-10-31'], new Set(['isa']))
    expect(points.map((p) => p.date)).toEqual(['2026-09-30', '2026-10-31'])
    expect(points[1]).toEqual({ date: '2026-10-31', total: 1400_00, groups: { savings: 1500_00, cards: -100_00 }, goalMoney: 1500_00 })
    expect(recentChanges(points)).toEqual([{ date: '2026-10-31', change: 600_00 }])
  })
})
