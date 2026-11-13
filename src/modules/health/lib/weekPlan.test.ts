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
// Friday 13th, 9am.
const now = new Date('2026-11-13T09:00:00Z')
const ev = (title: string, start: string, calendarId = 'tim-cal', allDay = false, end = start) => ({ title, start, end, allDay, calendarId })
const at = (title: string, day: string, from: string, to: string, calendarId = 'tim-cal') => ev(title, `${day}T${from}:00Z`, calendarId, false, `${day}T${to}:00Z`)
const work = days.slice(0, 5).flatMap((d) => [at('Work AM', d, '08:00', '12:00'), at('Work PM', d, '13:00', '17:00')])
const timsCalendar = [
  ...work,
  at('Tube', '2026-11-09', '18:15', '19:15'),
  at('Padel with Lewis', '2026-11-09', '19:15', '20:15'),
  at('Travel', '2026-11-09', '20:15', '22:15'),
  at('Mandarin', '2026-11-11', '17:00', '18:00'),
  at('Travel', '2026-11-11', '18:30', '19:30'),
  at('Crusaders B Home', '2026-11-11', '19:30', '23:00'),
  at('Travel', '2026-11-12', '18:15', '19:45'),
  at('England vs Croatia', '2026-11-12', '19:45', '21:45'),
  at('Coaching', '2026-11-14', '12:00', '17:00'),
  at('Graham Spicer 1*', '2026-11-15', '09:30', '17:00'),
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
    const week = weekBoxes({ days, today, now, people: [tim, sophie], events: timsCalendar, owners, names })
    expect(acts(week[0].people.tim)).toEqual(['Padel with Lewis'])
    expect(week[2].people.tim).toEqual([{ activity: TT_MATCH, source: 'calendar', title: 'Crusaders B Home' }])
    expect(week[3].people.tim).toEqual([])
    expect(week[6].people.tim).toEqual([{ activity: TT_TOURNAMENT, source: 'calendar', title: 'Graham Spicer 1*' }])
    expect(week[2].unknown.map((u) => u.title)).toEqual(['Mandarin', 'Travel'])
  })

  it('shows something done together once, across both', () => {
    const week = weekBoxes({
      days, today, now, people: [tim, sophie],
      saved: [{ day: today, owner_id: null, activity: 'Padel' }],
    })
    expect(week[4].both).toEqual([{ activity: 'Padel', source: 'you' }])
    expect(week[4].people.tim).toEqual([])
    expect(week[4].people.sophie).toEqual([])
  })

  it('merges the same exercise in both calendars, and a shared calendar goes on both', () => {
    const week = weekBoxes({
      days, today, now, people: [tim, sophie], owners,
      events: [at('Yoga', '2026-11-10', '07:00', '08:00'), at('Yoga', '2026-11-10', '07:00', '08:00', 'sophie-cal'), ev('Parkrun', '2026-11-14', 'shared', true)],
    })
    expect(acts(week[1].both)).toEqual(['Yoga'])
    expect(week[1].people.tim).toEqual([])
    expect(acts(week[5].both)).toEqual(['Parkrun'])
  })

  it('the coach fills what is left of the goals, from today on, never on a match day or the day before a tournament', () => {
    const week = weekBoxes({ days, today, now, people: [{ ...tim, goals: [{ name: 'Gym', times: 1 }] }, sophie], events: timsCalendar, owners, names })
    const coach = week.flatMap((w, i) => w.people.tim.filter((x) => x.source === 'coach').map(() => i))
    expect(coach.every((d) => d >= 4)).toBe(true)
    expect(coach).not.toContain(5) // Saturday, before the Sunday tournament, is last choice
    expect(coach).not.toContain(6) // tournament day
    expect(coach).toEqual([4])
  })

  it('uses Saturday when there is nothing else left', () => {
    const week = weekBoxes({ days, today, now, people: [{ ...tim, goals: [{ name: 'Gym', times: 2 }] }], events: timsCalendar, owners, names })
    expect(week.flatMap((w, i) => (w.people.tim.some((x) => x.source === 'coach') ? [i] : []))).toEqual([4, 5])
  })

  it('counts sessions already in the week towards the goal', () => {
    const week = weekBoxes({
      days, today, now, people: [{ ...tim, goals: [{ name: 'Table tennis', times: 2 }] }], events: timsCalendar, owners, names,
    })
    // The Crusaders match and the tournament make two.
    expect(week.flatMap((w) => w.people.tim).filter((x) => x.source === 'coach')).toEqual([])
  })

  it('puts a goal you share on both, once', () => {
    const run = { name: 'Run', times: 1 }
    const week = weekBoxes({ days, today, now, people: [{ ...tim, goals: [run] }, { ...sophie, goals: [run] }] })
    const both = week.flatMap((w) => w.both)
    expect(both).toEqual([{ activity: 'Run', source: 'coach', time: '17:30' }])
    expect(week.flatMap((w) => [...w.people.tim, ...w.people.sophie])).toEqual([])
  })

  it('keeps the coach off a box you set, Rest included, and counts logged exercise', () => {
    const week = weekBoxes({
      days, today, now, people: [{ ...tim, goals: [{ name: 'Gym', times: 2 }] }],
      saved: [{ day: '2026-11-13', owner_id: 'tim', activity: null }],
      logged: [{ user_id: 'tim', description: 'Gym', started_at: '2026-11-10T18:00:00Z' }],
    })
    expect(week[1].people.tim).toEqual([{ activity: 'Gym', source: 'logged' }])
    expect(week[4].people.tim).toEqual([])
    expect(week.flatMap((w, i) => (w.people.tim.some((x) => x.source === 'coach') ? [i] : []))).toEqual([5])
  })

  it('a calendar entry and the same thing set by hand show once', () => {
    const week = weekBoxes({
      days, today, now, people: [tim], events: [at('Gym', '2026-11-13', '18:00', '19:00')], owners,
      saved: [{ day: today, owner_id: 'tim', activity: 'Gym, Stretch' }],
    })
    expect(week[4].people.tim).toEqual([{ activity: 'Gym', source: 'calendar' }, { activity: 'Stretch', source: 'you' }])
  })

  it('suggests at most one session a day, and Tim\'s tournament leaves Sophie\'s days alone', () => {
    const week = weekBoxes({
      days, today, now, owners, names, events: timsCalendar,
      people: [{ ...tim, goals: [{ name: 'Gym', times: 3 }, { name: 'Run', times: 2 }] }, { ...sophie, goals: [{ name: 'Yoga', times: 2 }] }],
    })
    for (const w of week) expect(w.people.tim.filter((x) => x.source === 'coach').length).toBeLessThanOrEqual(1)
    expect(week.flatMap((w, i) => (w.people.sophie.some((x) => x.source === 'coach') ? [i] : []))).toEqual([4, 6])
  })

  it('only suggests when the calendar is free, says when, and skips days away', () => {
    const monday = new Date('2026-11-09T07:00:00Z')
    const week = weekBoxes({
      days, today: '2026-11-09', now: monday, owners, names, events: timsCalendar,
      people: [{ ...tim, goals: [{ name: 'Gym', times: 7 }] }],
    })
    const coach = week.flatMap((w, i) => w.people.tim.filter((x) => x.source === 'coach').map((x) => [i, x.time]))
    // Mon: padel evening. Wed: match. Thu: football. Sun: tournament. Tue and Fri evenings are free; Sat morning before coaching, as a last resort.
    expect(coach).toEqual([[1, '17:30'], [4, '17:30'], [5, '08:00']])
  })

  it('needs you both free for something you do together, and nothing once the evening has gone', () => {
    const run = { name: 'Run', times: 1 }
    const late = new Date('2026-11-13T21:00:00Z')
    const week = weekBoxes({
      days, today, now: late, owners,
      events: [at('Work drinks', '2026-11-14', '08:00', '20:00', 'sophie-cal'), ev('Sophie in Birmingham', '2026-11-15', 'sophie-cal', true, '2026-11-16')],
      people: [{ ...tim, goals: [run] }, { ...sophie, goals: [run] }],
    })
    expect(week.flatMap((w) => w.both)).toEqual([])
    // With nothing shared possible, each still gets their own where they can.
    expect(week.flatMap((w, i) => w.people.tim.map(() => i))).toEqual([5])
    expect(week.flatMap((w) => w.people.sophie)).toEqual([])
  })

  it('never books an "at most" goal, and leaves half an hour after work', () => {
    const week = weekBoxes({
      days, today, now, owners,
      events: [at('Work', '2026-11-13', '09:00', '17:30', 'sophie-cal')],
      people: [{ ...tim, goals: [{ name: 'Table tennis', times: 2, max: true }] }, { ...sophie, goals: [{ name: 'Yoga', times: 1 }] }],
    })
    expect(week.flatMap((w) => w.people.tim)).toEqual([])
    expect(week[4].people.sophie).toEqual([{ activity: 'Yoga', source: 'coach', time: '18:00' }])
  })
})

