import { describe, expect, it } from 'vitest'
import { classify, type ExerciseName, type Person, TT_MATCH, TT_TOURNAMENT, weekBoxes } from './weekPlan'

// The week of Mon 9 Nov 2026; "today" is Friday 13th.
const days = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']
const today = '2026-11-13'
const tim: Person = { id: 'tim', name: 'Tim', goals: [] }
const sophie: Person = { id: 'sophie', name: 'Sophie', goals: [] }
const owners = new Map<string, string | null>([['tim-cal', 'tim'], ['sophie-cal', 'sophie'], ['shared', null]])
const names: ExerciseName[] = [
  { owner_id: 'tim', phrase: 'GS1', activity: TT_MATCH },
  { owner_id: 'tim', phrase: 'Crusaders', activity: TT_MATCH },
  { owner_id: 'tim', phrase: 'Teddington', activity: TT_MATCH },
  { owner_id: 'tim', phrase: 'Graham Spicer', activity: TT_TOURNAMENT },
]
const ev = (title: string, start: string, calendarId = 'tim-cal', allDay = false) => ({ title, start, allDay, calendarId })
const timsCalendar = [
  ev('Work AM', '2026-11-09T08:00:00Z'),
  ev('Padel with Lewis', '2026-11-09T19:15:00Z'),
  ev('Mandarin', '2026-11-11T17:00:00Z'),
  ev('Crusaders B Home', '2026-11-11T19:30:00Z'),
  ev('England vs Croatia', '2026-11-12T19:45:00Z'),
  ev('Coaching', '2026-11-14T12:00:00Z'),
  ev('Graham Spicer 1*', '2026-11-15T09:30:00Z'),
]
const acts = (items: { activity: string }[]) => items.map((i) => i.activity)

describe('classify', () => {
  it('knows remembered names, star tournaments, goals and exercise words', () => {
    expect(classify('GS1', 'tim', names, [])).toBe(TT_MATCH)
    expect(classify('Crusaders B Home', 'tim', names, [])).toBe(TT_MATCH)
    expect(classify('Graham Spicer 1*', 'tim', names, [])).toBe(TT_TOURNAMENT)
    expect(classify('Bristol 2 star', 'tim', [], [])).toBe(TT_TOURNAMENT)
    expect(classify('Parkrun', 'tim', [], ['Run'])).toBe('Run')
    expect(classify('Padel with Lewis', 'tim', [], [])).toBe('Padel with Lewis')
  })

  it('leaves out what is not exercise, and what you said is not', () => {
    for (const t of ['England vs Croatia', 'Surrey', 'Coaching', 'Mandarin', 'Travel']) expect(classify(t, 'tim', names, [])).toBeUndefined()
    expect(classify('Gym induction', 'tim', [{ owner_id: null, phrase: 'Gym induction', activity: null }], [])).toBeNull()
  })

  it("only uses a person's names on their own calendar", () => {
    expect(classify('Teddington', 'sophie', names, [])).toBeUndefined()
  })
})

describe('weekBoxes', () => {
  it("puts Tim's matches and the tournament in his column, and nothing for work or football on TV", () => {
    const week = weekBoxes({ days, today, people: [tim, sophie], events: timsCalendar, owners, names })
    expect(acts(week[0].people.tim)).toEqual(['Padel with Lewis'])
    expect(week[2].people.tim).toEqual([{ activity: TT_MATCH, source: 'calendar', title: 'Crusaders B Home' }])
    expect(week[3].people.tim).toEqual([])
    expect(week[6].people.tim).toEqual([{ activity: TT_TOURNAMENT, source: 'calendar', title: 'Graham Spicer 1*' }])
    expect(week[2].unknown.map((u) => u.title)).toEqual(['Mandarin'])
  })

  it('shows something done together once, across both', () => {
    const week = weekBoxes({
      days, today, people: [tim, sophie],
      saved: [{ day: today, owner_id: null, activity: 'Padel' }],
    })
    expect(week[4].both).toEqual([{ activity: 'Padel', source: 'you' }])
    expect(week[4].people.tim).toEqual([])
    expect(week[4].people.sophie).toEqual([])
  })

  it('merges the same exercise in both calendars, and a shared calendar goes on both', () => {
    const week = weekBoxes({
      days, today, people: [tim, sophie], owners,
      events: [ev('Yoga', '2026-11-10T07:00:00Z'), ev('Yoga', '2026-11-10T07:00:00Z', 'sophie-cal'), ev('Parkrun', '2026-11-14', 'shared', true)],
    })
    expect(acts(week[1].both)).toEqual(['Yoga'])
    expect(week[1].people.tim).toEqual([])
    expect(acts(week[5].both)).toEqual(['Parkrun'])
  })

  it('the coach fills what is left of the goals, from today on, never on a match day or the day before a tournament', () => {
    const week = weekBoxes({ days, today, people: [{ ...tim, goals: [{ name: 'Gym', times: 1 }] }, sophie], events: timsCalendar, owners, names })
    const coach = week.flatMap((w, i) => w.people.tim.filter((x) => x.source === 'coach').map(() => i))
    expect(coach.every((d) => d >= 4)).toBe(true)
    expect(coach).not.toContain(5) // Saturday, before the Sunday tournament, is last choice
    expect(coach).not.toContain(6) // tournament day
    expect(coach).toEqual([4])
  })

  it('uses Saturday when there is nothing else left', () => {
    const week = weekBoxes({ days, today, people: [{ ...tim, goals: [{ name: 'Gym', times: 2 }] }], events: timsCalendar, owners, names })
    expect(week.flatMap((w, i) => (w.people.tim.some((x) => x.source === 'coach') ? [i] : []))).toEqual([4, 5])
  })

  it('counts sessions already in the week towards the goal', () => {
    const week = weekBoxes({
      days, today, people: [{ ...tim, goals: [{ name: 'Table tennis', times: 2 }] }], events: timsCalendar, owners, names,
    })
    // The Crusaders match and the tournament make two.
    expect(week.flatMap((w) => w.people.tim).filter((x) => x.source === 'coach')).toEqual([])
  })

  it('puts a goal you share on both, once', () => {
    const run = { name: 'Run', times: 1 }
    const week = weekBoxes({ days, today, people: [{ ...tim, goals: [run] }, { ...sophie, goals: [run] }] })
    const both = week.flatMap((w) => w.both)
    expect(both).toEqual([{ activity: 'Run', source: 'coach' }])
    expect(week.flatMap((w) => [...w.people.tim, ...w.people.sophie])).toEqual([])
  })

  it('keeps the coach off a box you set, Rest included, and counts logged exercise', () => {
    const week = weekBoxes({
      days, today, people: [{ ...tim, goals: [{ name: 'Gym', times: 2 }] }],
      saved: [{ day: '2026-11-13', owner_id: 'tim', activity: null }],
      logged: [{ user_id: 'tim', description: 'Gym', started_at: '2026-11-10T18:00:00Z' }],
    })
    expect(week[1].people.tim).toEqual([{ activity: 'Gym', source: 'logged' }])
    expect(week[4].people.tim).toEqual([])
    expect(week.flatMap((w, i) => (w.people.tim.some((x) => x.source === 'coach') ? [i] : []))).toEqual([5])
  })

  it('a calendar entry and the same thing set by hand show once', () => {
    const week = weekBoxes({
      days, today, people: [tim], events: [ev('Gym', '2026-11-13T18:00:00Z')], owners,
      saved: [{ day: today, owner_id: 'tim', activity: 'Gym, Stretch' }],
    })
    expect(week[4].people.tim).toEqual([{ activity: 'Gym', source: 'calendar' }, { activity: 'Stretch', source: 'you' }])
  })

  it('suggests at most one session a day, and Tim\'s tournament leaves Sophie\'s days alone', () => {
    const week = weekBoxes({
      days, today, owners, names, events: timsCalendar,
      people: [{ ...tim, goals: [{ name: 'Gym', times: 3 }, { name: 'Run', times: 2 }] }, { ...sophie, goals: [{ name: 'Yoga', times: 2 }] }],
    })
    for (const w of week) expect(w.people.tim.filter((x) => x.source === 'coach').length).toBeLessThanOrEqual(1)
    expect(week.flatMap((w, i) => (w.people.sophie.some((x) => x.source === 'coach') ? [i] : []))).toEqual([4, 6])
  })
})

