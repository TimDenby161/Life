import { cycleSummary, dailySeries, isWeighIn, latestWithChange, movingAverage, weeklyExerciseMinutes } from './metrics'

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

describe('cycleSummary', () => {
  it('averages the gaps between starts and adds that to the last one', () => {
    const s = cycleSummary([
      { started_on: '2026-09-29', ended_on: null },
      { started_on: '2026-08-04', ended_on: '2026-08-08' },
      { started_on: '2026-09-01', ended_on: '2026-09-05' },
    ])
    expect(s.cycles).toEqual([28, 28])
    expect(s.averageCycle).toBe(28)
    expect(s.averageLength).toBe(5)
    expect(s.estimatedNext).toBe('2026-10-27')
  })
  it('estimates nothing from a single period', () => {
    expect(cycleSummary([{ started_on: '2026-10-01', ended_on: null }])).toEqual({ cycles: [], averageCycle: null, averageLength: null, estimatedNext: null })
  })
})

describe('isWeighIn', () => {
  it('spots weigh-in tasks', () => {
    for (const t of ['Weigh in', 'Weekly weigh-in', 'weighin', 'Weigh myself']) expect(isWeighIn(t)).toBe(true)
  })
  it('ignores other tasks', () => {
    for (const t of ['Weight training', 'Weigh up the options', 'Bins out']) expect(isWeighIn(t)).toBe(false)
  })
})

describe('movingAverage', () => {
  it('averages the readings in the last 7 days, that day included', () => {
    const out = movingAverage([
      { date: '2026-10-01', value: 84 },
      { date: '2026-10-02', value: 82 },
      { date: '2026-10-07', value: 83 },
      { date: '2026-10-08', value: 80 },
    ])
    expect(out.map((p) => p.average)).toEqual([84, 83, 83, 81.666666666666671])
  })

  it('copes with gaps longer than the window', () => {
    expect(movingAverage([{ date: '2026-09-01', value: 90 }, { date: '2026-10-01', value: 85 }]).map((p) => p.average)).toEqual([90, 85])
  })
})

describe('weeklyExerciseMinutes', () => {
  const s = (user_id: string, started_at: string, duration_minutes: number) => ({ user_id, started_at, duration_minutes })

  it('totals Monday to Sunday per person, most first', () => {
    // Wednesday 28 Oct 2026: the week is Mon 26 Oct to Sun 1 Nov.
    const out = weeklyExerciseMinutes(
      [
        s('tim', '2026-10-25T20:00:00Z', 60), // Sunday before: last week
        s('tim', '2026-10-26T07:00:00Z', 20),
        s('sophie', '2026-10-27T18:00:00Z', 45),
        s('sophie', '2026-11-01T22:30:00Z', 10), // Sunday night (GMT): still this week
        s('tim', '2026-11-02T07:00:00Z', 30), // next Monday
      ],
      ['tim', 'sophie'],
      '2026-10-28',
    )
    expect(out).toEqual({
      weekStart: '2026-10-26',
      weekEnd: '2026-11-01',
      totals: [{ personId: 'sophie', minutes: 55 }, { personId: 'tim', minutes: 20 }],
    })
  })

  it('includes people with nothing yet, keeping their order on a tie', () => {
    expect(weeklyExerciseMinutes([], ['tim', 'sophie'], '2026-10-26').totals).toEqual([
      { personId: 'tim', minutes: 0 },
      { personId: 'sophie', minutes: 0 },
    ])
  })
})
