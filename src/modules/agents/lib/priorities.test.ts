import { busyBlocks, type CalEvent, freeMinutes, freeToday, isAway, parseTravel } from '../../../../supabase/functions/_shared/agents/calendar.ts'
import { candidatesFor, cleanPicks, MAX_PICKS, planBudget, prioritiesInput, TOGETHER } from '../../../../supabase/functions/_shared/agents/priorities.ts'
import { aiFirst, canDoAnywhere, PLAN_MAX, todaysPlan } from './aiOrder'
import { estimateMinutes } from '../../../../supabase/functions/_shared/agents/taskManager.ts'
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

describe('Today’s plan on Home', () => {
  const job = (task_id: string, score: number, minutes = 15) => ({ task_id, score, minutes })
  const plan = (ranked: ReturnType<typeof job>[], picked: Set<string> | null, budget = 120) =>
    todaysPlan(ranked, picked, (o) => o.score, (o) => o.minutes, budget).map((o) => o.task_id)

  it('is exactly the AI’s plan when there is one, and empty once it’s all done', () => {
    const ranked = [job('a', 200), job('b', 150), job('c', 120)]
    expect(plan(ranked, new Set(['c', 'a']))).toEqual(['a', 'c'])
    expect(plan(ranked, new Set())).toEqual([])
  })

  it('drops AI picks that no longer fit as the day fills up, keeping its order', () => {
    const ranked = [job('a', 200, 60), job('b', 150, 45), job('c', 120, 15)]
    expect(plan(ranked, new Set(['a', 'b', 'c']), 80)).toEqual(['a', 'c'])
    expect(plan(ranked, new Set(['a', 'b', 'c']), 0)).toEqual([])
  })

  it('without one, takes what’s due or late until about two hours', () => {
    const ranked = [job('late', 210, 30), job('due', 100, 45), job('big', 100, 60), job('small', 100, 15), job('soon', 60), job('undated', 30)]
    expect(plan(ranked, null)).toEqual(['late', 'due', 'small'])
    expect(plan([job('huge', 150, 180)], null)).toEqual([])
    expect(plan(Array.from({ length: 20 }, (_, i) => job(`j${i}`, 100, 5)), null)).toHaveLength(PLAN_MAX)
  })
})

describe('Job times', () => {
  it('uses the time set on a job, else estimates it from the wording', () => {
    expect(estimateMinutes('Clean the oven', null, 90)).toBe(90)
    expect(estimateMinutes('Clean the oven')).toBe(30)
    expect(estimateMinutes('Do the tax return')).toBe(15)
  })

  it('gives the AI the time set on a job', () => {
    const ctx = context({ open: [task({ title: 'Tax return', due_date: TODAY, duration_minutes: 180 })] })
    expect(candidatesFor(ctx, ctx.members[0])[0].minutes).toBe(180)
  })
})

describe('Free time', () => {
  it('counts free minutes from now to 10pm, after overlapping busy blocks', () => {
    // 9 to 5:30 work and a 7pm match overlapping a 7:30 call, from 6am.
    const blocks = [{ from: 540, to: 1050 }, { from: 1140, to: 1260 }, { from: 1170, to: 1200 }]
    expect(freeMinutes(blocks, 360)).toBe(900 - 510 - 120)
    expect(freeMinutes(blocks, 1250)).toBe(1320 - 1260)
    expect(freeMinutes([], 1330)).toBe(0)
  })

  it('treats work as busy but not away', () => {
    const work: CalEvent = { owner_id: ALEX, title: 'Work', start: '2026-11-06T09:00:00Z', end: '2026-11-06T17:30:00Z', allDay: false }
    const match: CalEvent = { ...work, title: 'SBL Halton', start: '2026-11-06T10:00:00Z', end: '2026-11-06T16:00:00Z' }
    expect(isAway([work], ALEX, TODAY, 'Europe/London')).toBe(false)
    expect(isAway([match], ALEX, TODAY, 'Europe/London')).toBe(true)
    expect(freeToday([work], [ALEX], TODAY, 'Europe/London', 6 * 60)).toBe(900 - 510)
  })

  it('gives the AI the free minutes and drops picks past them (paid work aside)', () => {
    const work: CalEvent = { owner_id: ALEX, title: 'Work', start: '2026-11-06T09:00:00Z', end: '2026-11-06T21:00:00Z', allDay: false }
    const ctx = context({
      calendar: [work],
      categories: [...context().categories],
      open: [task({ title: 'Clean the oven', due_date: TODAY }), task({ title: 'Reply to client', due_date: TODAY, category_id: 'c-work' }), task({ title: 'Hoover', due_date: TODAY })],
    })
    const alex = ctx.members[0]
    const c = candidatesFor(ctx, alex)
    const budget = planBudget(ctx, alex, 6 * 60)
    expect(budget).toBe(120 + 60) // 7 to 9am and 9 to 10pm
    expect(JSON.parse(prioritiesInput(ctx, alex, c, '06:00')).freeMinutesToday).toBe(180)
    const ref = (t: string) => c.find((x) => x.title === t)!.ref
    const picks = cleanPicks(JSON.stringify({ picks: ['Clean the oven', 'Reply to client', 'Hoover'].map((t) => ({ ref: ref(t), why: 'ok' })) }), c, 40)
    expect(picks!.map((p) => p.title)).toEqual(['Clean the oven', 'Reply to client'])
  })
})

describe('Travel time', () => {
  const padel: CalEvent = { owner_id: ALEX, title: 'Padel', start: '2026-11-06T19:00:00Z', end: '2026-11-06T20:30:00Z', allDay: false }

  it('reads rules and blocks the journey both sides of a matching event', () => {
    const travel = parseTravel({ travel: [{ word: ' Padel ', minutes: 60 }, { word: 'x', minutes: 10 }, { word: 'Gym', minutes: 999 }] })
    expect(travel).toEqual([{ word: 'padel', minutes: 60 }])
    expect(busyBlocks([padel], ALEX, TODAY, 'Europe/London', travel)).toEqual([{ from: '18:00', to: '21:30' }])
    // From 5pm: 17:00 to 18:00 and 21:30 to 22:00.
    expect(freeToday([padel], [ALEX], TODAY, 'Europe/London', 17 * 60, () => travel)).toBe(90)
    expect(freeToday([padel], [ALEX], TODAY, 'Europe/London', 17 * 60)).toBe(120 + 90)
  })

  it('gives the AI the free time after travel', () => {
    const ctx = context({ calendar: [padel], travel: { [ALEX]: [{ word: 'padel', minutes: 60 }] }, open: [task({ title: 'Hoover', due_date: TODAY })] })
    expect(planBudget(ctx, ctx.members[0], 17 * 60)).toBe(90)
  })
})
