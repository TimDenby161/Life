import { briefingFor, busyStretches, clashes, headline } from '../../../../supabase/functions/_shared/agents/chiefOfStaff.ts'
import { analyseTasks } from '../../../../supabase/functions/_shared/agents/taskManager.ts'
import { ALEX, ALEX_LIST, BOTH, context, done, SAM, SAM_LIST, task } from './fixtures'

const NOW = new Date('2026-11-06T09:00:00Z')
const alex = { id: ALEX, name: 'Alex' }

function brief(ctx: ReturnType<typeof context>, kind: 'daily' | 'weekly' = 'daily', enabled = BOTH) {
  return briefingFor(ctx, analyseTasks(ctx, enabled), alex, kind, NOW)
}

describe('daily briefing', () => {
  it('counts what is due and overdue in my view, leaving out the partner’s own and daily routines', () => {
    const ctx = context({
      open: [
        task({ due_date: '2026-11-06' }),
        task({ due_date: '2026-11-06', list_id: ALEX_LIST }),
        task({ due_date: '2026-11-06', list_id: SAM_LIST }),
        task({ due_date: '2026-11-02' }),
        task({ due_date: '2026-11-06', recurrence: { freq: 'daily' } }),
        task({ due_date: '2026-11-05', needs_both: true }),
      ],
    })
    const { content, period_key, recipient_id } = brief(ctx)
    expect(content).toMatchObject({ dueToday: 2, overdue: 2, together: 1 })
    expect(period_key).toBe('2026-11-06')
    expect(recipient_id).toBe(ALEX)
  })

  it('lists deadlines in the next two weeks, soonest first', () => {
    const ctx = context({
      open: [
        task({ title: 'Later', deadline: '2026-11-18' }),
        task({ title: 'Soon', deadline: '2026-11-09' }),
        task({ title: 'Far', deadline: '2026-12-30' }),
      ],
    })
    expect((brief(ctx).content.deadlines as { title: string }[]).map((d) => d.title)).toEqual(['Soon', 'Later'])
  })

  it('says what the partner finished in the last day, joint jobs only', () => {
    const ctx = context({
      events: [
        done('Hoover', '2026-11-05', SAM, { recorded_at: '2026-11-05T18:00:00Z' }),
        done('Own thing', '2026-11-05', SAM, { recorded_at: '2026-11-05T18:00:00Z', list_id: SAM_LIST }),
        done('Old', '2026-11-01', SAM),
      ],
    })
    expect(brief(ctx).content.partnerDone).toEqual({ name: 'Sam', count: 1, titles: ['Hoover'] })
  })

  it('lists tasks the partner added for me or for both of us', () => {
    const ctx = context({
      open: [
        task({ title: 'For both', created_by: SAM, created_at: '2026-11-06T07:00:00Z' }),
        task({ title: 'My own', created_by: ALEX, created_at: '2026-11-06T07:00:00Z' }),
        task({ title: 'Theirs', list_id: SAM_LIST, created_by: SAM, created_at: '2026-11-06T07:00:00Z' }),
      ],
    })
    expect(brief(ctx).content.added).toEqual([expect.objectContaining({ title: 'For both', by: 'Sam' })])
  })

  it('passes on my top Task Manager suggestions, most serious first', () => {
    const ctx = context({
      open: [task({ title: 'Passport', due_date: '2026-11-20', deadline: '2026-11-12' }), task({ title: 'Loft', due_date: '2026-10-01' })],
    })
    const titles = (brief(ctx).content.suggestions as { title: string }[]).map((s) => s.title)
    expect(titles).toEqual(['“Passport” is set for after its deadline', '“Loft” is 36 days overdue'])
  })

  it('has no suggestions for me when my Task Manager is off', () => {
    const ctx = context({ open: [task({ due_date: '2026-10-01' })] })
    expect(brief(ctx, 'daily', [SAM]).content.suggestions).toEqual([])
  })
})

describe('conflicts', () => {
  it('finds three fixed dates within three days', () => {
    const busy = busyStretches(
      [task({ title: 'A', deadline: '2026-11-10' }), task({ title: 'B', due_date: '2026-11-11' }), task({ title: 'C', deadline: '2026-11-12' }), task({ title: 'D', deadline: '2026-11-20' })],
      '2026-11-06',
    )
    expect(busy).toEqual([{ from: '2026-11-10', to: '2026-11-12', titles: ['A', 'B', 'C'] }])
  })

  it('ignores repeating jobs’ dates', () => {
    const jobs = [10, 10, 11].map((d) => task({ recurrence: { freq: 'weekly' }, due_date: `2026-11-${d}` }))
    expect(busyStretches(jobs, '2026-11-06')).toEqual([])
  })

  it('finds two tasks at the same time', () => {
    const found = clashes([task({ title: 'Dentist', due_date: '2026-11-09', due_time: '10:00:00' }), task({ title: 'Call', due_date: '2026-11-09', due_time: '10:00:00' })], '2026-11-06')
    expect(found).toEqual([{ date: '2026-11-09', time: '10:00', titles: ['Dentist', 'Call'] }])
  })
})

describe('headline', () => {
  const base = { date: '2026-11-06', dueToday: 0, overdue: 0, deadlines: [], busy: [] }
  it('is calm when there is nothing', () => expect(headline(base)).toBe('Nothing due today.'))
  it('leads with what is due', () =>
    expect(headline({ ...base, dueToday: 2, overdue: 1, deadlines: [{ task_id: 't', title: 'Passport', deadline: '2026-11-09' }] })).toBe(
      '2 due today, 1 overdue, “Passport” has a deadline Mon 9 Nov.',
    ))
})

describe('weekly briefing', () => {
  it('adds the week plan and the workload, keyed by ISO week', () => {
    const ctx = context({ today: '2026-11-09', open: [task({ title: 'This week', due_date: '2026-11-12' })] })
    const b = briefingFor(ctx, analyseTasks(ctx, BOTH), alex, 'weekly', NOW)
    expect(b.period_key).toBe('2026-W46')
    expect((b.content.plan as { title: string }[]).map((p) => p.title)).toEqual(['This week'])
    expect(b.content.workload).toMatchObject({ days: 28 })
  })
})
