import { owedByEmployer, progressSince } from './progress'

const P = 'p1'
const snap = (day: string, played: number, won: number, league = 'jbl_boys') => ({ tt_user_id: P, league, day, played, won })

describe('a player’s progress', () => {
  it('compares with about four weeks ago', () => {
    const snaps = [snap('2026-09-20', 4, 1), snap('2026-10-10', 8, 3), snap('2026-10-20', 10, 5)]
    expect(progressSince(snaps, P, 'jbl_boys', { played: 16, won: 10 }, '2026-11-11')).toEqual({ since: '2026-10-10', games: 8, wins: 7, ratePoints: 25 })
  })

  it('uses the oldest snapshot when they are all recent, and shows nothing without new games', () => {
    const snaps = [snap('2026-11-05', 6, 3)]
    expect(progressSince(snaps, P, 'jbl_boys', { played: 9, won: 6 }, '2026-11-11')?.ratePoints).toBe(17)
    expect(progressSince(snaps, P, 'jbl_boys', { played: 6, won: 3 }, '2026-11-11')).toBeNull()
    expect(progressSince([], P, 'jbl_boys', { played: 6, won: 3 }, '2026-11-11')).toBeNull()
  })
})

describe('coaching pay', () => {
  it('adds up what each employer still owes', () => {
    const owed = owedByEmployer([
      { employer_id: 'gs', amount_minor: 3000, paid_on: null },
      { employer_id: 'gs', amount_minor: 2000, paid_on: '2026-11-01' },
      { employer_id: 'gs', amount_minor: 1500, paid_on: null },
      { employer_id: 'surrey', amount_minor: 4000, paid_on: null },
    ])
    expect(Object.fromEntries(owed)).toEqual({ gs: { amount: 4500, count: 2 }, surrey: { amount: 4000, count: 1 } })
  })
})
