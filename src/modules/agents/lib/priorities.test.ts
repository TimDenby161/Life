import { busyBlocks, type CalEvent } from '../../../../supabase/functions/_shared/agents/calendar.ts'
import { candidatesFor, cleanPicks, MAX_PICKS, prioritiesInput, TOGETHER } from '../../../../supabase/functions/_shared/agents/priorities.ts'
import { aiFirst, canDoAnywhere } from './aiOrder'
import { ALEX, ALEX_LIST, context, SAM, SAM_LIST, task } from './fixtures'

const TODAY = '2026-11-06'
const alex = { id: ALEX, name: 'Alex' }
const ev = (title: string, start: string, end: string, owner_id: string | null = ALEX): CalEvent => ({ owner_id, title, start, end, allDay: false })

describe('AI priorities: the shortlist', () => {
  it('takes late, soon, deadline and important jobs I could do, soonest first', () => {
    const ctx = context({
      open: [
        task({ title: 'Far off', due_date: '2026-12-20' }),
        task({ title: 'Due Monday', due_date: '2026-11-09' }),
        task({ title: 'Late', due_date: '2026-11-01' }),
        task({ title: 'Deadline soon', deadline: '2026-11-20' }),
        task({ title: 'Voted up', importance_votes: 2 }),
        task({ title: 'Sam’s own', list_id: SAM_LIST, due_date: TODAY }),
        task({ title: 'Mine', list_id: ALEX_LIST, due_date: TODAY }),
        task({ title: 'Together job', due_date: TODAY, needs_both: true }),
      ],
    })
    const c = candidatesFor(ctx, alex)
    expect(c.map((x) => x.title)).toEqual(['Late', 'Mine', 'Due Monday', 'Deadline soon', 'Voted up'])
    expect(candidatesFor(ctx, TOGETHER).map((x) => x.title)).toEqual(['Together job'])
    expect(c[0]).toMatchObject({ ref: 'J1', who: 'joint', late: 5 })
    expect(c[1].who).toBe('mine')
  })

  it('leaves out jobs waiting on another open job', () => {
    const first = task({ title: 'First', due_date: TODAY })
    const ctx = context({ open: [first, task({ title: 'After', due_date: TODAY, waiting_on_task_id: first.task_id })] })
    expect(candidatesFor(ctx, alex).map((x) => x.title)).toEqual(['First'])
  })
})

describe('AI priorities: what Claude sees', () => {
  it('gets refs, titles and dates, busy times without event titles, and no ids', () => {
    const t = task({ title: 'Book boiler service', due_date: TODAY })
    const ctx = context({
      open: [t],
      calendar: [ev('Secret dentist', '2026-11-06T10:00:00Z', '2026-11-06T11:00:00Z'), ev('Sam’s gym', '2026-11-06T18:00:00Z', '2026-11-06T19:00:00Z', SAM)],
    })
    const input = prioritiesInput(ctx, alex, candidatesFor(ctx, alex), '06:05')
    const data = JSON.parse(input)
    expect(data).toMatchObject({ person: 'Alex', partner: 'Sam', weekday: 'Friday', time: '06:05' })
    expect(data.busyToday).toEqual([{ from: '10:00', to: '11:00' }])
    expect(data.partnerBusyToday).toEqual([{ from: '18:00', to: '19:00' }])
    expect(data.jobs[0]).toMatchObject({ ref: 'J1', title: 'Book boiler service', who: 'joint' })
    expect(input).not.toContain(t.task_id)
    expect(input).not.toContain('dentist')
  })

  it('says who is away today, without saying why', () => {
    const ctx = context({ open: [task({ title: 'Hoover', due_date: TODAY })], calendar: [{ owner_id: SAM, title: 'Florida', start: '2026-11-05', end: '2026-11-12', allDay: true }] })
    const input = prioritiesInput(ctx, alex, candidatesFor(ctx, alex), '06:15')
    expect(JSON.parse(input)).toMatchObject({ awayToday: false, partnerAwayToday: true })
    expect(input).not.toContain('Florida')
  })

  it('names the Together tab after both of you, with both busy times', () => {
    const ctx = context({ open: [task({ title: 'Big shop', due_date: TODAY, needs_both: true })], calendar: [ev('Gym', '2026-11-06T18:00:00Z', '2026-11-06T19:00:00Z', SAM)] })
    const data = JSON.parse(prioritiesInput(ctx, TOGETHER, candidatesFor(ctx, TOGETHER), '06:05'))
    expect(data).toMatchObject({ person: 'Alex and Sam, together', partner: null, busyToday: [], partnerBusyToday: [{ from: '18:00', to: '19:00' }] })
    expect(data.jobs[0]).toMatchObject({ title: 'Big shop', who: 'together' })
  })

  it('keeps all-day events out of busy times', () => {
    expect(busyBlocks([{ owner_id: null, title: 'Birthday', start: TODAY, end: '2026-11-07', allDay: true }], ALEX, TODAY, 'Europe/London')).toEqual([])
  })
})

describe('AI priorities: checking the answer', () => {
  const ctx = context({ open: [task({ title: 'A', due_date: TODAY }), task({ title: 'B', due_date: TODAY }), task({ title: 'C', due_date: TODAY })] })
  const c = candidatesFor(ctx, alex)

  it('keeps picks from the shortlist, in order, with their reasons', () => {
    const picks = cleanPicks(JSON.stringify({ picks: [{ ref: 'J2', why: 'Due today', where: 'anywhere' }, { ref: 'J1', why: 'Quick win', where: 'home' }] }), c)
    expect(picks).toEqual([
      { task_id: c[1].task_id, title: 'B', why: 'Due today', where: 'anywhere' },
      { task_id: c[0].task_id, title: 'A', why: 'Quick win', where: 'home' },
    ])
    expect(cleanPicks(JSON.stringify({ picks: [{ ref: 'J1', why: 'x', where: 'moon' }] }), c)?.[0].where).toBe('home')
  })

  it('drops invented jobs, repeats, odd reasons and anything past the limit', () => {
    const many = Array.from({ length: 8 }, () => ({ ref: 'J1', why: 'x' }))
    expect(cleanPicks(JSON.stringify({ picks: [{ ref: 'J9', why: 'made up' }, ...many] }), c)).toHaveLength(1)
    expect(cleanPicks(JSON.stringify({ picks: [{ ref: 'J1', why: 'See https://example.com' }] }), c)).toEqual([{ task_id: c[0].task_id, title: 'A', why: '', where: 'home' }])
    expect(cleanPicks(JSON.stringify({ picks: [{ ref: 'J1', why: 'x'.repeat(101) }] }), c)?.[0].why).toBe('')
    const big = context({ open: Array.from({ length: 12 }, (_, i) => task({ title: `T${i}`, due_date: TODAY })) })
    const bc = candidatesFor(big, alex)
    expect(cleanPicks(JSON.stringify({ picks: bc.map((x) => ({ ref: x.ref, why: 'ok' })) }), bc)).toHaveLength(MAX_PICKS)
  })

  it('gives up on an answer that isn’t the right shape', () => {
    expect(cleanPicks('not json', c)).toBeNull()
    expect(cleanPicks('{"picks": "J1"}', c)).toBeNull()
  })
})

describe('AI priorities: Top jobs order', () => {
  const rows = [{ task_id: 'a' }, { task_id: 'b' }, { task_id: 'c' }]

  it('puts the tab’s picks first in the AI’s order, then the rest as they were', () => {
    const { items, notes, where } = aiFirst(rows, [{ task_id: 'c', why: 'Deadline Friday', where: 'anywhere' }, { task_id: 'gone', why: 'x' }, { task_id: 'b', why: '' }])
    expect(items.map((r) => r.task_id)).toEqual(['c', 'b', 'a'])
    expect(notes).toEqual(new Map([['c', 'Deadline Friday'], ['b', '']]))
    expect(where).toEqual(new Map([['c', 'anywhere'], ['b', 'home']]))
  })

  it('drops a pick that has been put off past today', () => {
    const jobs = [{ task_id: 'a', due_date: '2026-11-06' }, { task_id: 'b', due_date: '2026-11-07' }]
    const { items, notes } = aiFirst(jobs, [{ task_id: 'b', why: 'x' }, { task_id: 'a', why: 'y' }], TODAY)
    expect(items.map((r) => r.task_id)).toEqual(['a', 'b'])
    expect(notes.has('b')).toBe(false)
  })

  it('leaves the order alone with no picks', () => {
    expect(aiFirst(rows, undefined).items).toBe(rows)
  })
})

describe('out and about', () => {
  it('goes by the AI’s tag, except for obvious home jobs', () => {
    expect(canDoAnywhere('Draft the guest list', null, 'anywhere')).toBe(true)
    expect(canDoAnywhere('Learn two Spanish words', 'Spanish', 'home')).toBe(false)
    expect(canDoAnywhere('Check food supplies', null, 'anywhere')).toBe(false)
    expect(canDoAnywhere('Weekly shop', null, 'anywhere')).toBe(false)
    expect(canDoAnywhere('Vacuum the hall', null, 'anywhere')).toBe(false)
  })

  it('otherwise keeps language practice, calls and online admin, not housework', () => {
    expect(canDoAnywhere('Learn two Spanish words', 'Spanish')).toBe(true)
    expect(canDoAnywhere('Review Mandarin characters', null)).toBe(true)
    expect(canDoAnywhere('Call the council about bins', null)).toBe(true)
    expect(canDoAnywhere('Book boiler service', 'Admin & bills')).toBe(true)
    expect(canDoAnywhere('Check food supplies', null)).toBe(false)
    expect(canDoAnywhere('Vacuum the hall', 'Cleaning')).toBe(false)
    expect(canDoAnywhere('Change the towels', null)).toBe(false)
  })
})
