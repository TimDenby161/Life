import { type CalEvent, dayLoad, dayName, isPacked, loadText, packedDays } from '../../../../supabase/functions/_shared/agents/calendar.ts'
import { type BriefingContent, briefingFor } from '../../../../supabase/functions/_shared/agents/chiefOfStaff.ts'
import { summaryInput } from '../../../../supabase/functions/_shared/agents/llm.ts'
import { analyseTasks } from '../../../../supabase/functions/_shared/agents/taskManager.ts'
import { ALEX, ALEX_LIST, BOTH, context, SAM, task } from './fixtures'

const TZ = 'Europe/London'
const TODAY = '2026-11-06' // Friday; London is on GMT in November
const NOW = new Date('2026-11-06T09:00:00Z')

const ev = (title: string, start: string, end: string, owner_id: string | null = ALEX): CalEvent => ({ owner_id, title, start, end, allDay: false })
const allDay = (title: string, start: string, end: string, owner_id: string | null = ALEX): CalEvent => ({ owner_id, title, start, end, allDay: true })
/** Three timed events on a day: packed. */
const packed = (date: string, owner: string | null = ALEX) => [
  ev('Standup', `${date}T09:00:00Z`, `${date}T09:30:00Z`, owner),
  ev('Dentist', `${date}T11:00:00Z`, `${date}T12:00:00Z`, owner),
  ev('Work drinks', `${date}T18:00:00Z`, `${date}T20:00:00Z`, owner),
]

describe('calendar: a day', () => {
  it('lists the day in time order, all-day first, and adds up the booked minutes', () => {
    const load = dayLoad([...packed('2026-11-12'), allDay('Mum’s birthday', '2026-11-12', '2026-11-13')], ALEX, '2026-11-12', TZ)
    expect(load.events).toEqual([
      { time: null, title: 'Mum’s birthday' },
      { time: '09:00', title: 'Standup' },
      { time: '11:00', title: 'Dentist' },
      { time: '18:00', title: 'Work drinks' },
    ])
    expect(load).toMatchObject({ minutes: 210, timed: 3 })
    expect(isPacked(load)).toBe(true)
    expect(loadText(load)).toBe('3 events, about 4 hours')
  })

  it('uses local time (BST in summer)', () => {
    const load = dayLoad([ev('Padel', '2026-07-01T17:00:00Z', '2026-07-01T18:30:00Z')], ALEX, '2026-07-01', TZ)
    expect(load.events).toEqual([{ time: '18:00', title: 'Padel' }])
  })

  it('counts a shared calendar for both, and someone else’s for no one else', () => {
    const events = [ev('Shared dinner', '2026-11-12T19:00:00Z', '2026-11-12T21:00:00Z', null), ev('Sam’s gym', '2026-11-12T07:00:00Z', '2026-11-12T08:00:00Z', SAM)]
    expect(dayLoad(events, ALEX, '2026-11-12', TZ).events.map((e) => e.title)).toEqual(['Shared dinner'])
    expect(dayLoad(events, SAM, '2026-11-12', TZ).timed).toBe(2)
  })

  it('counts four booked hours as packed even with fewer events, and splits an overnight event', () => {
    const long = [ev('Training course', '2026-11-12T09:00:00Z', '2026-11-12T13:00:00Z')]
    expect(isPacked(dayLoad(long, ALEX, '2026-11-12', TZ))).toBe(true)
    const night = [ev('Night shift', '2026-11-12T22:00:00Z', '2026-11-13T06:00:00Z')]
    expect(dayLoad(night, ALEX, '2026-11-12', TZ)).toMatchObject({ minutes: 120, timed: 1 })
    expect(dayLoad(night, ALEX, '2026-11-13', TZ)).toMatchObject({ minutes: 360, timed: 0, events: [] })
  })

  it('finds packed days and names them', () => {
    expect(packedDays(packed('2026-11-12'), ALEX, '2026-11-07', 6, TZ).map((d) => d.date)).toEqual(['2026-11-12'])
    expect(dayName('2026-11-07', TODAY)).toBe('tomorrow')
    expect(dayName('2026-11-12', TODAY)).toBe('Thursday')
  })
})

describe('calendar: moving jobs off packed days', () => {
  const moves = (ctx: ReturnType<typeof context>) => analyseTasks(ctx, BOTH).suggestions.filter((s) => s.kind === 'packed_day')

  it('suggests moving my own job off my packed day to the next clear one', () => {
    const t = task({ title: 'Hoover downstairs', list_id: ALEX_LIST, due_date: '2026-11-12', recurrence: { freq: 'weekly' } })
    const [s] = moves(context({ open: [t], calendar: packed('2026-11-12') }))
    expect(s).toMatchObject({
      dedupe_key: `packed:${t.task_id}:2026-11-12`,
      title: 'Move “Hoover downstairs” to Friday?',
      recipients: [ALEX],
      action: { type: 'move_due_date', due_date: '2026-11-13' },
    })
    expect(s.reason).toBe('Thursday is packed: 3 events, about 4 hours (Standup, Dentist, Work drinks). Friday looks clearer.')
  })

  it('leaves a joint job where it is when one of you is free, but moves one you do together', () => {
    const joint = task({ due_date: '2026-11-12' })
    expect(moves(context({ open: [joint], calendar: packed('2026-11-12') }))).toEqual([])
    expect(moves(context({ open: [task({ due_date: '2026-11-12', needs_both: true })], calendar: packed('2026-11-12') }))).toHaveLength(1)
    expect(moves(context({ open: [joint], calendar: packed('2026-11-12', null) }))).toHaveLength(1)
  })

  it('never moves past a deadline, a timed task, a daily job, today or a job further out than a week', () => {
    const calendar = [...packed('2026-11-12'), ...packed('2026-11-06'), ...packed('2026-11-13')]
    const mine = { list_id: ALEX_LIST }
    expect(moves(context({ open: [task({ ...mine, due_date: '2026-11-12', deadline: '2026-11-12' })], calendar }))).toEqual([])
    expect(moves(context({ open: [task({ ...mine, due_date: '2026-11-12', due_time: '10:00' })], calendar }))).toEqual([])
    expect(moves(context({ open: [task({ ...mine, due_date: '2026-11-12', recurrence: { freq: 'daily' } })], calendar }))).toEqual([])
    expect(moves(context({ open: [task({ ...mine, due_date: TODAY })], calendar }))).toEqual([])
    expect(moves(context({ open: [task({ ...mine, due_date: '2026-11-13' })], calendar }))).toEqual([])
  })

  it('skips a packed next day to the first clear one', () => {
    const calendar = [...packed('2026-11-10'), ...packed('2026-11-11')]
    expect(moves(context({ open: [task({ list_id: ALEX_LIST, due_date: '2026-11-10' })], calendar }))[0].action).toMatchObject({ due_date: '2026-11-12' })
  })

  it('says nothing without a calendar', () => {
    expect(moves(context({ open: [task({ list_id: ALEX_LIST, due_date: '2026-11-12' })] }))).toEqual([])
  })
})

describe('calendar: the briefing', () => {
  const brief = (ctx: ReturnType<typeof context>) =>
    briefingFor(ctx, analyseTasks(ctx, BOTH), { id: ALEX, name: 'Alex' }, 'daily', NOW).content as BriefingContent

  it('lists today, counts events in the headline, and notes packed days ahead', () => {
    const c = brief(context({ open: [task({ due_date: TODAY })], calendar: [ev('Dentist', '2026-11-06T11:00:00Z', '2026-11-06T12:00:00Z'), ...packed('2026-11-10')] }))
    expect(c.calendar).toEqual([{ time: '11:00', title: 'Dentist' }])
    expect(c.headline).toBe('1 due today, 1 event.')
    expect(c.packed).toEqual([{ date: '2026-11-10', load: '3 events, about 4 hours', titles: ['Standup', 'Dentist', 'Work drinks'] }])
  })

  it('leaves the calendar out when none is connected', () => {
    expect(brief(context()).calendar).toBeUndefined()
  })

  it('gives the AI sentence the number of events, never their titles', () => {
    const c = brief(context({ calendar: [ev('Secret meeting', '2026-11-06T11:00:00Z', '2026-11-06T12:00:00Z')] }))
    const input = summaryInput('Alex', c)
    expect(JSON.parse(input).eventsToday).toBe(1)
    expect(input).not.toContain('Secret meeting')
  })
})
