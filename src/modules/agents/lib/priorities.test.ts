import { busyBlocks, type CalEvent } from '../../../../supabase/functions/_shared/agents/calendar.ts'
import { candidatesFor, cleanPicks, MAX_PICKS, prioritiesInput } from '../../../../supabase/functions/_shared/agents/priorities.ts'
import { aiFirst } from './aiOrder'
import { ALEX, ALEX_LIST, context, SAM, SAM_LIST, task } from './fixtures'

const TODAY = '2026-11-06'
const alex = { id: ALEX, name: 'Alex' }
const sam = { id: SAM, name: 'Sam' }
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
      ],
    })
    const c = candidatesFor(ctx, alex)
    expect(c.map((x) => x.title)).toEqual(['Late', 'Mine', 'Due Monday', 'Deadline soon', 'Voted up'])
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
    const t = task({ title: 'Book boiler service', due_date: TODAY, needs_both: true })
    const ctx = context({
      open: [t],
      calendar: [ev('Secret dentist', '2026-11-06T10:00:00Z', '2026-11-06T11:00:00Z'), ev('Sam’s gym', '2026-11-06T18:00:00Z', '2026-11-06T19:00:00Z', SAM)],
    })
    const input = prioritiesInput(ctx, alex, sam, candidatesFor(ctx, alex), '06:05')
    const data = JSON.parse(input)
    expect(data).toMatchObject({ person: 'Alex', partner: 'Sam', weekday: 'Friday', time: '06:05' })
    expect(data.busyToday).toEqual([{ from: '10:00', to: '11:00' }])
    expect(data.partnerBusyToday).toEqual([{ from: '18:00', to: '19:00' }])
    expect(data.jobs[0]).toMatchObject({ ref: 'J1', title: 'Book boiler service', who: 'together' })
    expect(input).not.toContain(t.task_id)
    expect(input).not.toContain('dentist')
  })

  it('keeps all-day events out of busy times', () => {
    expect(busyBlocks([{ owner_id: null, title: 'Birthday', start: TODAY, end: '2026-11-07', allDay: true }], ALEX, TODAY, 'Europe/London')).toEqual([])
  })
})

describe('AI priorities: checking the answer', () => {
  const ctx = context({ open: [task({ title: 'A', due_date: TODAY }), task({ title: 'B', due_date: TODAY }), task({ title: 'C', due_date: TODAY })] })
  const c = candidatesFor(ctx, alex)

  it('keeps picks from the shortlist, in order, with their reasons', () => {
    const picks = cleanPicks(JSON.stringify({ picks: [{ ref: 'J2', why: 'Due today' }, { ref: 'J1', why: 'Quick win' }] }), c)
    expect(picks).toEqual([
      { task_id: c[1].task_id, title: 'B', why: 'Due today' },
      { task_id: c[0].task_id, title: 'A', why: 'Quick win' },
    ])
  })

  it('drops invented jobs, repeats, odd reasons and anything past the limit', () => {
    const many = Array.from({ length: 8 }, () => ({ ref: 'J1', why: 'x' }))
    expect(cleanPicks(JSON.stringify({ picks: [{ ref: 'J9', why: 'made up' }, ...many] }), c)).toHaveLength(1)
    expect(cleanPicks(JSON.stringify({ picks: [{ ref: 'J1', why: 'See https://example.com' }] }), c)).toEqual([{ task_id: c[0].task_id, title: 'A', why: '' }])
    expect(cleanPicks(JSON.stringify({ picks: [{ ref: 'J1', why: 'x'.repeat(101) }] }), c)?.[0].why).toBe('')
    const big = context({ open: Array.from({ length: 9 }, (_, i) => task({ title: `T${i}`, due_date: TODAY })) })
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

  it('puts today’s picks first in the AI’s order, then the rest as they were', () => {
    const { items, notes } = aiFirst(rows, [{ task_id: 'c', why: 'Deadline Friday' }, { task_id: 'gone', why: 'x' }, { task_id: 'b', why: '' }], TODAY, TODAY)
    expect(items.map((r) => r.task_id)).toEqual(['c', 'b', 'a'])
    expect(notes).toEqual(new Map([['c', 'Deadline Friday'], ['b', '']]))
  })

  it('ignores yesterday’s picks', () => {
    expect(aiFirst(rows, [{ task_id: 'c', why: '' }], '2026-11-05', TODAY).items).toBe(rows)
  })
})
