import { addDays } from '../../../../supabase/functions/_shared/agents/dates.ts'
import {
  analyseTasks,
  estimateMinutes,
  inferRule,
  realisticDate,
  similarTitles,
  weeklyPlan,
} from '../../../../supabase/functions/_shared/agents/taskManager.ts'
import { ALEX, ALEX_LIST, BOTH, CLEANING, context, done, SAM, SAM_LIST, task, WORK } from './fixtures'

const find = (ctx: ReturnType<typeof context>, kind: string, enabled = BOTH) =>
  analyseTasks(ctx, enabled).suggestions.filter((s) => s.kind === kind)

describe('put off and overdue tasks', () => {
  it('flags a task put off three times and proposes Saturday', () => {
    const t = task({ title: 'Sort the loft', due_date: '2026-11-10', delay_count: 3 })
    const [s] = find(context({ open: [t] }), 'put_off')
    expect(s.title).toBe('“Sort the loft” has been put off 3 times')
    expect(s.action).toEqual({ type: 'move_due_date', due_date: '2026-11-07' })
  })

  it('offers no move when it is already on that day', () => {
    const t = task({ due_date: '2026-11-07', delay_count: 3 })
    expect(find(context({ open: [t] }), 'put_off')[0].action).toBeNull()
  })

  it('proposes the next Saturday, or the next workday for work tasks', () => {
    const ctx = context()
    expect(realisticDate(task(), ctx)).toBe('2026-11-07')
    expect(realisticDate(task({ category_id: WORK }), ctx)).toBe('2026-11-09')
  })

  it('never proposes a date past the deadline', () => {
    const ctx = context()
    expect(realisticDate(task({ deadline: '2026-11-07' }), ctx)).toBe('2026-11-06')
  })

  it('flags a one-off two weeks overdue but not a fresh one', () => {
    const ctx = context({
      open: [task({ title: 'Old', due_date: '2026-10-20' }), task({ title: 'Recent', due_date: '2026-11-01' })],
    })
    const found = find(ctx, 'overdue')
    expect(found.map((s) => s.title)).toEqual(['“Old” is 17 days overdue'])
    expect(found[0].action).toEqual({ type: 'move_due_date', due_date: '2026-11-07' })
  })

  it('flags a repeat missed for two cycles without proposing a change', () => {
    const ctx = context({ open: [task({ title: 'Descale', recurrence: { freq: 'weekly', interval: 1 }, due_date: '2026-10-20' })] })
    const [s] = find(ctx, 'missed_repeat')
    expect(s.action).toBeNull()
    expect(s.severity).toBe(1)
  })

  it('mentions only the three furthest-behind repeats, so a backlog isn’t a flood', () => {
    const open = [10, 30, 20, 40, 15].map((late) =>
      task({ title: `Late ${late}`, recurrence: { freq: 'daily' }, due_date: addDays('2026-11-06', -late) }),
    )
    expect(find(context({ open }), 'missed_repeat').map((s) => s.title)).toEqual([
      '“Late 40” hasn\'t been done for a while',
      '“Late 30” hasn\'t been done for a while',
      '“Late 20” hasn\'t been done for a while',
    ])
  })

  it('leaves alone a daily task missed for a couple of days', () => {
    const ctx = context({ open: [task({ recurrence: { freq: 'daily' }, due_date: '2026-11-04' })] })
    expect(analyseTasks(ctx, BOTH).suggestions).toEqual([])
  })

  it('lists the oldest undated one-offs, at most three', () => {
    const open = [1, 2, 3, 4].map((i) => task({ title: `Idea ${i}`, created_at: `2026-0${i}-01T09:00:00Z` }))
    const found = find(context({ open }), 'undated')
    expect(found.map((s) => s.title)).toEqual(['“Idea 1” has no date', '“Idea 2” has no date', '“Idea 3” has no date'])
  })
})

describe('deadlines', () => {
  it('warns when a task is dated after its deadline', () => {
    const t = task({ title: 'Renew passport', due_date: '2026-11-20', deadline: '2026-11-12' })
    const [s] = find(context({ open: [t] }), 'deadline_risk')
    expect(s.severity).toBe(3)
    expect(s.action).toEqual({ type: 'move_due_date', due_date: '2026-11-10' })
  })

  it('warns when a task with a close deadline waits on an open one', () => {
    const blocker = task({ title: 'Get photos' })
    const t = task({ title: 'Renew passport', deadline: '2026-11-10', due_date: '2026-11-08', waiting_on_task_id: blocker.task_id })
    const [s] = find(context({ open: [blocker, t] }), 'blocked')
    expect(s.title).toBe('“Renew passport” is waiting on “Get photos”')
  })

  it('gives a task one suggestion even when several rules match', () => {
    const t = task({ due_date: '2026-11-20', deadline: '2026-11-12', delay_count: 5 })
    const all = analyseTasks(context({ open: [t] }), BOTH).suggestions.filter((s) => s.task_id === t.task_id)
    expect(all.map((s) => s.kind)).toEqual(['deadline_risk'])
  })

  it('says nothing about a waiting task with no close deadline', () => {
    const blocker = task()
    const t = task({ delay_count: 4, waiting_on_task_id: blocker.task_id })
    expect(analyseTasks(context({ open: [blocker, t] }), BOTH).suggestions).toEqual([])
  })
})

describe('duplicates', () => {
  it('matches the same words, plurals and filler aside', () => {
    expect(similarTitles('Clean the windows', 'clean windows')).toBe(true)
    expect(similarTitles('Book the dentist', 'Book a dentist appointment')).toBe(false)
    expect(similarTitles('Pay council tax', 'Pay the council tax bill')).toBe(true)
  })

  it('proposes archiving the newer of two matching tasks', () => {
    const older = task({ title: 'Fix the shower', created_at: '2026-10-01T09:00:00Z' })
    const newer = task({ title: 'fix shower', created_at: '2026-11-02T09:00:00Z' })
    const [s] = find(context({ open: [newer, older] }), 'duplicate')
    expect(s.task_id).toBe(newer.task_id)
    expect(s.action).toEqual({ type: 'archive_task' })
  })

  it('keeps two people’s own copies apart', () => {
    const open = [task({ title: 'Learn two Spanish words', list_id: ALEX_LIST }), task({ title: 'Learn two Spanish words', list_id: SAM_LIST })]
    expect(find(context({ open }), 'duplicate')).toEqual([])
  })
})

describe('repeat candidates', () => {
  it('turns gaps into a rule', () => {
    expect(inferRule(2)).toBeNull()
    expect(inferRule(4)?.label).toBe('every 4 days')
    expect(inferRule(13)?.rule).toEqual({ freq: 'weekly', interval: 2, afterDone: true })
    expect(inferRule(62)?.rule).toEqual({ freq: 'monthly', interval: 2, afterDone: true })
  })

  it('suggests a job for a one-off done three times', () => {
    const events = ['2026-09-18', '2026-10-02', '2026-10-16'].map((d) => done('Clean the oven', d, ALEX, { category_id: CLEANING }))
    const [s] = find(context({ events }), 'repeat')
    expect(s.title).toBe('Make “Clean the oven” a job every 2 weeks')
    expect(s.action).toMatchObject({
      type: 'create_task',
      list: 'joint',
      due_date: '2026-11-06',
      category_id: CLEANING,
      recurrence: { freq: 'weekly', interval: 2, afterDone: true },
    })
  })

  it('stays quiet while a matching task is open', () => {
    const events = ['2026-09-18', '2026-10-02', '2026-10-16'].map((d) => done('Clean the oven', d))
    expect(find(context({ events, open: [task({ title: 'Clean oven' })] }), 'repeat')).toEqual([])
  })

  it('ignores completions that were undone', () => {
    const events = ['2026-09-18', '2026-10-02', '2026-10-16'].map((d) => done('Clean the oven', d))
    events.push({ ...events[2], event_type: 'reopened', recorded_at: '2026-10-16T11:00:00Z' })
    expect(find(context({ events }), 'repeat')).toEqual([])
  })
})

describe('workload', () => {
  const lots = (who: string, title: string, count: number) =>
    Array.from({ length: count }, (_, i) => done(title, `2026-10-${String(12 + i).padStart(2, '0')}`, who, { is_recurring: true }))

  it('notes a lopsided month of joint jobs, by estimated time', () => {
    const events = [...lots(ALEX, 'Clean the bathroom', 8), ...lots(SAM, 'Take the bins out', 3)]
    const [s] = find(context({ events }), 'workload')
    expect(s.title).toBe('Alex did 89% of the joint jobs in the last 4 weeks')
    expect(s.reason).toContain('Alex about 4h, Sam about 30m (8 and 3 jobs)')
    expect(s.recipients).toEqual(BOTH)
  })

  it('leaves out people’s own jobs', () => {
    const events = [...lots(ALEX, 'Clean the bathroom', 8).map((e) => ({ ...e, list_id: ALEX_LIST })), ...lots(SAM, 'Bins', 3)]
    expect(find(context({ events }), 'workload')).toEqual([])
  })

  it('counts a job done together for both', () => {
    const events = lots(ALEX, 'Clean the kitchen', 10).map((e) => ({ ...e, also_completed_by: SAM }))
    expect(find(context({ events }), 'workload')).toEqual([])
  })

  it('estimates effort from the kind of job', () => {
    expect(estimateMinutes('Weekly shop')).toBe(45)
    expect(estimateMinutes('Change the sheets')).toBe(20)
    expect(estimateMinutes('Ring the bank')).toBe(15)
  })
})

describe('automation', () => {
  it('offers a task to set up a direct debit for a repeating payment', () => {
    const t = task({ title: 'Pay the window cleaner', recurrence: { freq: 'monthly' }, due_date: '2026-11-20' })
    const [s] = find(context({ open: [t] }), 'automate')
    expect(s.action).toEqual({ type: 'create_task', title: 'Set up a direct debit for: Pay the window cleaner', list: 'joint', due_date: '2026-11-07' })
  })

  it('leaves alone a task that only mentions bills', () => {
    const t = task({ title: 'Check bills & budget', recurrence: { freq: 'monthly' }, due_date: '2026-11-20' })
    expect(find(context({ open: [t] }), 'automate')).toEqual([])
  })
})

describe('who hears about what', () => {
  it('tells only the owner about their own task', () => {
    const t = task({ list_id: SAM_LIST, due_date: '2026-10-01' })
    const [s] = find(context({ open: [t] }), 'overdue')
    expect(s.recipients).toEqual([SAM])
  })

  it('treats an owned category as that person’s', () => {
    const t = task({ category_id: WORK, delay_count: 3, due_date: '2026-11-09' })
    expect(find(context({ open: [t] }), 'put_off')[0].recipients).toEqual([ALEX])
  })

  it('drops a suggestion about someone’s task when they have the agent off', () => {
    const t = task({ list_id: SAM_LIST, due_date: '2026-10-01' })
    expect(analyseTasks(context({ open: [t] }), [ALEX]).suggestions).toEqual([])
  })

  it('sends joint suggestions only to people who have it on', () => {
    const t = task({ due_date: '2026-10-01' })
    expect(analyseTasks(context({ open: [t] }), [SAM]).suggestions[0].recipients).toEqual([SAM])
  })

  it('says nothing to anyone when nobody has it on', () => {
    expect(analyseTasks(context({ open: [task({ due_date: '2026-10-01' })] }), []).suggestions).toEqual([])
  })
})

describe('weekly plan', () => {
  it('lists this week’s work and close deadlines, deadlines first, without daily routines', () => {
    const ctx = context({
      open: [
        task({ title: 'Mine', list_id: ALEX_LIST, due_date: '2026-11-08' }),
        task({ title: 'Theirs', list_id: SAM_LIST, due_date: '2026-11-08' }),
        task({ title: 'Deadline', due_date: '2026-11-25', deadline: '2026-11-15' }),
        task({ title: 'Daily', recurrence: { freq: 'daily' }, due_date: '2026-11-06' }),
        task({ title: 'Far', due_date: '2026-12-01' }),
        task({ title: 'Late', due_date: '2026-11-01', needs_both: true }),
      ],
    })
    const plan = weeklyPlan(ctx, { id: ALEX, name: 'Alex' })
    expect(plan.map((p) => p.title)).toEqual(['Deadline', 'Late', 'Mine'])
    expect(plan[1]).toMatchObject({ late: 5, together: true })
  })
})
