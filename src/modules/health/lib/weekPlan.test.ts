import { describe, expect, it } from 'vitest'
import { calendarExercise, draftWeek, joinDay } from './weekPlan'

const days = (cells: ReturnType<typeof draftWeek>, owner: string | null, activity: string) =>
  cells.filter((c) => c.owner === owner && c.activity === activity).map((c) => c.day)

describe('draftWeek', () => {
  it('spreads sessions across the week', () => {
    const cells = draftWeek([{ id: 'tim', goals: [{ name: 'Gym', times: 3 }] }])
    const d = days(cells, 'tim', 'Gym')
    expect(d).toHaveLength(3)
    // No two on neighbouring days.
    for (let i = 1; i < d.length; i++) expect(d[i] - d[i - 1]).toBeGreaterThan(1)
  })

  it('leaves optional goals out and keeps different activities on different days when it can', () => {
    const cells = draftWeek([{ id: 'tim', goals: [{ name: 'Gym', times: 3 }, { name: 'Run', times: 2 }, { name: 'Swim', times: 1, optional: true }] }])
    expect(days(cells, 'tim', 'Swim')).toEqual([])
    const all = cells.map((c) => c.day)
    expect(new Set(all).size).toBe(5)
  })

  it('puts a shared activity in Together and the rest in each column', () => {
    const cells = draftWeek([
      { id: 'tim', goals: [{ name: 'Run', times: 2 }, { name: 'Gym', times: 3 }] },
      { id: 'sophie', goals: [{ name: 'run', times: 1 }, { name: 'Yoga', times: 2 }] },
    ])
    expect(days(cells, null, 'Run')).toHaveLength(1)
    expect(days(cells, 'tim', 'Run')).toHaveLength(1)
    expect(days(cells, 'sophie', 'run')).toHaveLength(0)
    expect(days(cells, 'sophie', 'Yoga')).toHaveLength(2)
    // Tim's own run isn't on the day of the joint one.
    expect(days(cells, 'tim', 'Run')[0]).not.toBe(days(cells, null, 'Run')[0])
  })

  it('caps at seven a week', () => {
    expect(draftWeek([{ id: 'tim', goals: [{ name: 'Walk', times: 9 }] }])).toHaveLength(7)
  })
})

describe('joinDay', () => {
  it('joins two on one day', () => {
    expect(joinDay([{ day: 0, owner: 'a', activity: 'Gym' }, { day: 0, owner: 'a', activity: 'Run' }])).toEqual([{ day: 0, owner: 'a', activity: 'Gym, Run' }])
  })
})

describe('calendarExercise', () => {
  const days = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']
  const owners = new Map<string, string | null>([['tim-cal', 'tim'], ['shared', null]])
  const people = [
    { id: 'tim', name: 'Tim', goals: [{ name: 'Gym', times: 3 }] },
    { id: 'sophie', name: 'Sophie', goals: [{ name: 'Yoga', times: 2 }] },
  ]
  const ev = (title: string, start: string, calendarId = 'tim-cal', allDay = false) => ({ title, start, allDay, calendarId })

  it('puts exercise on its owner, shared ones on Together or the person named', () => {
    const cells = calendarExercise(
      [
        ev('Gym', '2026-11-16T18:00:00'),
        ev('Dentist', '2026-11-17T09:00:00'),
        ev('Yoga with Sophie', '2026-11-18T07:00:00', 'shared'),
        ev('Parkrun', '2026-11-21', 'shared', true),
        ev('Work', '2026-11-19T09:00:00'),
      ],
      owners,
      people,
      days,
    )
    expect(cells).toEqual([
      { day: 0, owner: 'tim', activity: 'Gym' },
      { day: 2, owner: 'sophie', activity: 'Yoga' },
      { day: 5, owner: null, activity: 'Parkrun' },
    ])
  })

  it('counts towards the goals when drafting, and steers off booked days', () => {
    const booked = [{ day: 0, owner: 'tim', activity: 'Gym' }]
    const cells = draftWeek([{ id: 'tim', goals: [{ name: 'Gym', times: 3 }] }], booked)
    expect(cells).toHaveLength(2)
    expect(cells.map((c) => c.day)).not.toContain(0)
  })
})
