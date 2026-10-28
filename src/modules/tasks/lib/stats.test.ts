import { computeTaskStats, effectiveCompletions, type StatsEvent, type StatsOccurrenceInput, streaksFor } from './stats'

const TIM = 'tim'
const SOPHIE = 'sophie'
let seq = 0

function ev(partial: Partial<StatsEvent> & Pick<StatsEvent, 'occurrence_id' | 'event_type'>): StatsEvent {
  seq++
  return {
    id: `e${seq}`,
    task_id: 'bins',
    completed_by: partial.event_type === 'completed' ? TIM : null,
    occurred_at: '2026-10-20T19:00:00Z',
    recorded_at: `2026-10-20T19:00:${String(seq).padStart(2, '0')}Z`,
    task_title: 'Bins out',
    category_id: 'cat-bins',
    category_name: 'Bins & recycling',
    assignee_id: TIM,
    due_date: '2026-10-20',
    is_recurring: true,
    occurrence_created_at: '2026-10-13T19:00:00Z',
    ...partial,
  }
}

const range = { from: '2026-10-01', to: '2026-10-31' }

describe('effectiveCompletions', () => {
  it('counts complete -> reopen -> complete once, credited to the final completer', () => {
    const events = [
      ev({ occurrence_id: 'w1', event_type: 'completed', completed_by: SOPHIE }),
      ev({ occurrence_id: 'w1', event_type: 'reopened' }),
      ev({ occurrence_id: 'w1', event_type: 'completed', completed_by: TIM }),
    ]
    const result = effectiveCompletions(events)
    expect(result).toHaveLength(1)
    expect(result[0].personId).toBe(TIM)
  })

  it('drops occurrences whose latest event is a reopen or skip', () => {
    const events = [
      ev({ occurrence_id: 'w1', event_type: 'completed' }),
      ev({ occurrence_id: 'w1', event_type: 'reopened' }),
      ev({ occurrence_id: 'w2', event_type: 'skipped' }),
    ]
    expect(effectiveCompletions(events)).toEqual([])
  })
})

describe('computeTaskStats', () => {
  const events = [
    // Bins: Tim week 1 (on time), Sophie week 2 (covering for Tim, late), Tim week 3.
    ev({ occurrence_id: 'w1', event_type: 'completed', completed_by: TIM, occurred_at: '2026-10-06T19:00:00Z', due_date: '2026-10-06' }),
    ev({ occurrence_id: 'w2', event_type: 'completed', completed_by: SOPHIE, occurred_at: '2026-10-14T08:00:00Z', due_date: '2026-10-13' }),
    ev({ occurrence_id: 'w3', event_type: 'completed', completed_by: TIM, occurred_at: '2026-10-20T19:00:00Z', due_date: '2026-10-20' }),
    // One-off task by Sophie, took 24h.
    ev({
      occurrence_id: 'o1',
      task_id: 'dentist',
      task_title: 'Book dentist',
      event_type: 'completed',
      completed_by: SOPHIE,
      assignee_id: SOPHIE,
      category_id: null,
      category_name: null,
      is_recurring: false,
      due_date: null,
      occurrence_created_at: '2026-10-10T09:00:00Z',
      occurred_at: '2026-10-11T09:00:00Z',
    }),
    // Outside the range.
    ev({ occurrence_id: 'old', event_type: 'completed', completed_by: TIM, occurred_at: '2026-09-01T10:00:00Z' }),
  ]

  const occ = (o: Partial<StatsOccurrenceInput> & { id: string }): StatsOccurrenceInput => ({
    task_id: 'bins',
    due_date: '2026-10-06',
    status: 'done',
    assignee_id: TIM,
    created_at: '2026-10-01T00:00:00Z',
    task: { title: 'Bins out', category_id: 'cat-bins', recurrence: { freq: 'weekly' }, archived_at: null },
    ...o,
  })
  const occurrences = [
    occ({ id: 'w1', due_date: '2026-10-06' }),
    occ({ id: 'w2', due_date: '2026-10-13' }),
    occ({ id: 'w3', due_date: '2026-10-20' }),
    occ({ id: 'w4', due_date: '2026-10-27', status: 'open' }),
    occ({ id: 'late', task_id: 'gutters', due_date: '2026-10-15', status: 'open', assignee_id: SOPHIE }),
    occ({ id: 'skip', due_date: '2026-10-28', status: 'skipped' }),
    occ({ id: 'o1', task_id: 'dentist', due_date: null, assignee_id: SOPHIE, created_at: '2026-10-10T09:00:00Z' }),
  ]

  const stats = computeTaskStats(events, occurrences, [TIM, SOPHIE], range, '2026-10-22')

  it('credits completions to the person who did the work', () => {
    expect(stats.totalCompleted).toBe(4)
    expect(stats.completedByPerson).toEqual({ [TIM]: 2, [SOPHIE]: 2 })
    expect(stats.completedShare).toEqual({ [TIM]: 50, [SOPHIE]: 50 })
  })

  it('tracks each recurring task once per occurrence with who did it', () => {
    expect(stats.byRecurringTask).toEqual([
      expect.objectContaining({ taskId: 'bins', total: 3, byPerson: { [TIM]: 2, [SOPHIE]: 1 }, lastCompletedBy: TIM }),
    ])
  })

  it('distinguishes assigned responsibility from completed work', () => {
    // Tim was assigned w1-w4 (skipped excluded); Sophie was assigned the gutters and the dentist.
    expect(stats.responsibility.assignedByPerson).toEqual({ [TIM]: 4, [SOPHIE]: 2 })
    expect(stats.responsibility.coveredForOther).toEqual({ [SOPHIE]: 1 })
    expect(stats.responsibility.completedOwn).toEqual({ [TIM]: 2, [SOPHIE]: 1 })
  })

  it('computes on-time rate from dated completions only', () => {
    expect(stats.onTimeRate).toBe(67)
  })

  it('averages time to complete for one-off tasks only', () => {
    expect(stats.avgHoursToComplete).toBe(24)
    expect(stats.avgHoursByPerson[TIM]).toBeNull()
  })

  it('counts open past-due work as overdue, by assignee', () => {
    expect(stats.overdue).toEqual({ total: 1, byAssignee: { [SOPHIE]: 1 } })
  })

  it('groups by category', () => {
    expect(stats.byCategory.map((c) => [c.name, c.total])).toEqual([
      ['Bins & recycling', 3],
      ['Uncategorised', 1],
    ])
  })

  it('builds continuous weekly buckets across the range', () => {
    expect(stats.weekly[0].key).toBe('2026-09-28')
    expect(stats.weekly.map((w) => w.total)).toEqual([0, 2, 1, 1, 0])
    expect(stats.monthly).toEqual([expect.objectContaining({ key: '2026-10', total: 4 })])
  })

  it('applies person and task filters', () => {
    const filtered = computeTaskStats(events, occurrences, [TIM, SOPHIE], { ...range, personId: SOPHIE, taskId: 'bins' }, '2026-10-22')
    expect(filtered.totalCompleted).toBe(1)
    expect(filtered.completedByPerson).toEqual({ [TIM]: 0, [SOPHIE]: 1 })
  })
})

describe('streaksFor', () => {
  it('finds current and longest runs of consecutive days', () => {
    const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-10', '2026-10-21', '2026-10-22']
    expect(streaksFor(days, '2026-10-22')).toEqual({ current: 2, longest: 3 })
  })
  it('keeps the streak alive until the end of the following day', () => {
    expect(streaksFor(['2026-10-21'], '2026-10-22').current).toBe(1)
    expect(streaksFor(['2026-10-20'], '2026-10-22').current).toBe(0)
  })
})

describe('done together', () => {
  const events = [
    ev({ occurrence_id: 'w1', event_type: 'completed', completed_by: TIM, occurred_at: '2026-10-06T19:00:00Z' }),
    // Sophie ticked it, then it was changed to "we both did it".
    ev({ occurrence_id: 'w2', event_type: 'completed', completed_by: SOPHIE, occurred_at: '2026-10-13T19:00:00Z' }),
    ev({ occurrence_id: 'w2', event_type: 'completed', completed_by: SOPHIE, also_completed_by: TIM, occurred_at: '2026-10-13T19:00:00Z' }),
  ]

  it('credits both people while counting the task once', () => {
    const stats = computeTaskStats(events, [], [TIM, SOPHIE], range, '2026-10-31')
    expect(stats.totalCompleted).toBe(2)
    expect(stats.completedByPerson).toEqual({ [TIM]: 2, [SOPHIE]: 1 })
    expect(stats.completedShare).toEqual({ [TIM]: 67, [SOPHIE]: 33 })
    expect(stats.byCategory[0]).toMatchObject({ total: 2, byPerson: { [TIM]: 2, [SOPHIE]: 1 } })
  })

  it('shows a shared task under either person filter', () => {
    const stats = computeTaskStats(events, [], [TIM, SOPHIE], { ...range, personId: SOPHIE }, '2026-10-31')
    expect(stats.totalCompleted).toBe(1)
  })
})
