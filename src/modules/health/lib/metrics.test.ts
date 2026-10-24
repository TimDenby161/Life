import { dailySeries, isSharedWithPartner, latestWithChange } from './metrics'

describe('visibility', () => {
  it('lets a record override its category', () => {
    expect(isSharedWithPartner('inherit', false)).toBe(false)
    expect(isSharedWithPartner('inherit', true)).toBe(true)
    expect(isSharedWithPartner('private', true)).toBe(false)
    expect(isSharedWithPartner('shared', false)).toBe(true)
  })
})

describe('dailySeries', () => {
  const rows = [
    { measured_at: '2026-10-20T07:00:00Z', value: 3000 },
    { measured_at: '2026-10-20T19:00:00Z', value: 5000 },
    { measured_at: '2026-10-21T08:00:00Z', value: 9000 },
  ]
  it('sums, averages or takes the latest per day', () => {
    expect(dailySeries(rows, 'sum')).toEqual([{ date: '2026-10-20', value: 8000 }, { date: '2026-10-21', value: 9000 }])
    expect(dailySeries(rows, 'average')[0].value).toBe(4000)
    expect(dailySeries(rows, 'latest')[0].value).toBe(5000)
  })
  it('reports change against the previous day', () => {
    expect(latestWithChange(dailySeries(rows, 'sum'))).toEqual({ value: 9000, date: '2026-10-21', change: 1000 })
    expect(latestWithChange([])).toBeNull()
  })
})
