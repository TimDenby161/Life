import { busyBlocks, type CalEvent, dayLoad, freeMinutes, freeToday, isAway, longestGap, parseTravel, workToday } from '../../../../supabase/functions/_shared/agents/calendar.ts'
import { candidatesFor, cleanPicks, goodDayToAsk, isShopJob, isWorkAsk, MAX_PICKS, planBudget, prioritiesInput, shopGap, shopsClose, TOGETHER, workBudget } from '../../../../supabase/functions/_shared/agents/priorities.ts'
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
  type Job = ReturnType<typeof job>
  const plan = (ranked: Job[], picked: Set<string> | null, budget = 120, fits?: (o: Job) => boolean) =>
    todaysPlan(ranked, picked, { score: (o) => o.score, minutes: (o) => o.minutes, budget, fits }).map((o) => o.task_id)

  it('puts the AI’s picks first in its order, then fills spare time with what’s due or late', () => {
    const ranked = [job('a', 200), job('b', 150), job('c', 120), job('later', 50)]
    expect(plan(ranked, new Set(['c', 'a']), 30)).toEqual(['a', 'c'])
    expect(plan(ranked, new Set(['c', 'a']))).toEqual(['a', 'c', 'b'])
    // A pick gone from the list (deleted) has its time go to the next job.
    expect(plan(ranked.filter((o) => o.task_id !== 'c'), new Set(['c', 'a']), 30)).toEqual(['a', 'b'])
  })

  it('never brings in a new job when one is finished or put off, only for time freed by a deleted one', () => {
    const ranked = [job('a', 200, 30), job('b', 150, 30), job('next', 120, 30)]
    const rules = (backfill: number) => ({ score: (o: Job) => o.score, minutes: (o: Job) => o.minutes, budget: 240, backfill })
    // 'c' was picked and finished: it's gone from the open list, and nothing replaces it.
    expect(todaysPlan(ranked, new Set(['a', 'b', 'c']), rules(0)).map((o) => o.task_id)).toEqual(['a', 'b'])
    // 'c' was deleted, freeing 30 minutes: the next job due takes its place.
    expect(todaysPlan(ranked, new Set(['a', 'b', 'c']), rules(30)).map((o) => o.task_id)).toEqual(['a', 'b', 'next'])
  })

  it('always shows a job added by hand for today, first, even when the AI’s plan fills the day', () => {
    const ranked = [job('a', 200, 60), job('b', 150, 60), job('mine', 100, 30)]
    const rules = { score: (o: Job) => o.score, minutes: (o: Job) => o.minutes, budget: 120, backfill: 0, added: (o: Job) => o.task_id === 'mine' }
    // Its 30 minutes come out of the day, so the second pick no longer fits.
    expect(todaysPlan(ranked, new Set(['a', 'b']), rules).map((o) => o.task_id)).toEqual(['mine', 'a'])
    // Even with no time left at all.
    expect(todaysPlan(ranked, new Set(['a', 'b']), { ...rules, budget: 0 }).map((o) => o.task_id)).toEqual(['mine'])
  })

  it('leaves out jobs that can’t be done today, like shopping after the shops shut', () => {
    const ranked = [job('shop', 200, 45), job('hoover', 150, 30)]
    expect(plan(ranked, new Set(['shop', 'hoover']), 120, (o) => o.task_id !== 'shop')).toEqual(['hoover'])
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

describe('Paid work in work time', () => {
  const work: CalEvent = { owner_id: ALEX, title: 'Work PM', start: '2026-11-06T13:00:00Z', end: '2026-11-06T17:30:00Z', allDay: false }

  it('counts the Work time left today', () => {
    expect(workToday([work], ALEX, TODAY, 'Europe/London', 14 * 60)).toBe(210)
    expect(workToday([work], SAM, TODAY, 'Europe/London', 14 * 60)).toBe(0)
    expect(workToday([{ ...work, title: 'Padel' }], ALEX, TODAY, 'Europe/London', 14 * 60)).toBe(0)
  })

  it('gives the AI the work minutes and drops paid work past them', () => {
    const ctx = context({
      calendar: [work],
      open: [task({ title: 'Reply to client', due_date: TODAY, category_id: 'c-work', duration_minutes: 120 }), task({ title: 'Fix the API', due_date: TODAY, category_id: 'c-work', duration_minutes: 120 })],
    })
    const alex = ctx.members[0]
    const c = candidatesFor(ctx, alex)
    expect(JSON.parse(prioritiesInput(ctx, alex, c, '14:00')).workMinutesToday).toBe(210)
    expect(workBudget(ctx, TOGETHER, 14 * 60)).toBe(0)
    const picks = cleanPicks(JSON.stringify({ picks: c.map((x) => ({ ref: x.ref, why: 'ok' })) }), c, 240, workBudget(ctx, alex, 14 * 60))
    expect(picks).toHaveLength(1)
  })

  it('on Home, fits paid work to work time and the rest to free time', () => {
    const job = (task_id: string, minutes: number, work = false) => ({ task_id, minutes, work })
    const ranked = [job('w1', 120, true), job('w2', 120, true), job('h1', 30), job('h2', 30)]
    const plan = todaysPlan(ranked, new Set(ranked.map((o) => o.task_id)), { score: () => 200, minutes: (o) => o.minutes, budget: 45, isWork: (o) => o.work, workBudget: 150 })
    expect(plan.map((o) => o.task_id)).toEqual(['w1', 'h1'])
  })
})

describe('Hidden calendar titles', () => {
  const work: CalEvent = { owner_id: ALEX, title: 'Work PM', start: '2026-11-06T13:00:00Z', end: '2026-11-06T17:30:00Z', allDay: false, hidden: true }

  it('still count as busy and as work time, but never as a packed day, a day away or a listed event', () => {
    expect(workToday([work], ALEX, TODAY, 'Europe/London', 14 * 60)).toBe(210)
    expect(freeToday([work], [ALEX], TODAY, 'Europe/London', 14 * 60)).toBe(8 * 60 - 210)
    const long = { ...work, title: 'Secret day out', start: '2026-11-06T08:00:00Z', end: '2026-11-06T18:00:00Z' }
    expect(isAway([long], ALEX, TODAY, 'Europe/London')).toBe(false)
    expect(dayLoad([long, work], ALEX, TODAY, 'Europe/London')).toMatchObject({ events: [], minutes: 0, timed: 0 })
  })
})

describe('Asking a manager', () => {
  it('spots asks, not parcels or shelves', () => {
    expect(['Negotiate package', 'Ask for laptop', 'Ask Sebastien about a pay rise', 'Salary review'].every(isWorkAsk)).toBe(true)
    expect(['Collect package from the post office', 'Raise the shelf', 'Buy a laptop bag'].some(isWorkAsk)).toBe(false)
  })

  it('waits for Tuesday to Thursday, and the AI knows it', () => {
    expect(['2026-11-09', '2026-11-10', '2026-11-12', '2026-11-13', '2026-11-14'].map(goodDayToAsk)).toEqual([false, true, true, false, false])
    const ctx = context({ today: '2026-11-09', open: [task({ title: 'Ask for laptop', due_date: '2026-11-02' }), task({ title: 'Hoover', due_date: '2026-11-09' })] })
    const c = candidatesFor(ctx, ctx.members[0])
    expect(c.find((x) => x.title === 'Ask for laptop')?.ask).toBe(true)
    expect(JSON.parse(prioritiesInput(ctx, ctx.members[0], c, '06:15')).goodDayToAsk).toBe(false)
    const raw = JSON.stringify({ picks: c.map((x) => ({ ref: x.ref, why: 'ok' })) })
    expect(cleanPicks(raw, c, 240, 240, false)!.map((p) => p.title)).toEqual(['Hoover'])
    expect(cleanPicks(raw, c, 240, 240, true)!.map((p) => p.title)).toContain('Ask for laptop')
  })
})

describe('Shopping hours', () => {
  it('spots shopping jobs and knows when the shops shut', () => {
    expect(['Weekly shop', 'Do the shopping', 'Tesco run', 'Buy groceries'].every(isShopJob)).toBe(true)
    expect(['Shop around for car insurance online', 'Clean the oven'].map(isShopJob)).toEqual([false, false])
    expect(shopsClose('2026-11-09')).toBe(22 * 60)
    expect(shopsClose('2026-11-15')).toBe(17 * 60)
  })

  it('finds the longest free stretch before closing', () => {
    expect(longestGap([{ from: 1095, to: 1335 }], 1020, 1320)).toBe(75)
    expect(longestGap([], 1020, 1020)).toBe(0)
  })

  it('gives the AI the gap before the shops shut and drops a shop that won’t fit', () => {
    // Free 17:00 to 18:15, then padel with travel until 22:15.
    const padel: CalEvent = { owner_id: ALEX, title: 'Padel', start: '2026-11-06T18:15:00Z', end: '2026-11-06T22:15:00Z', allDay: false }
    const ctx = context({ calendar: [padel], open: [task({ title: 'Weekly shop', due_date: TODAY, duration_minutes: 90 }), task({ title: 'Hoover', due_date: TODAY })] })
    const alex = ctx.members[0]
    const c = candidatesFor(ctx, alex)
    expect(c.find((x) => x.title === 'Weekly shop')?.shop).toBe(true)
    expect(shopGap(ctx, alex, 17 * 60)).toBe(75)
    expect(JSON.parse(prioritiesInput(ctx, alex, c, '17:00')).shopGapToday).toBe(75)
    const raw = JSON.stringify({ picks: c.map((x) => ({ ref: x.ref, why: 'ok' })) })
    expect(cleanPicks(raw, c, 240, 240, true, 75)!.map((p) => p.title)).toEqual(['Hoover'])
  })
})
