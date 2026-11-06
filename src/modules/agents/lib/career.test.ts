import { analyseCareer, type Goal } from '../../../../supabase/functions/_shared/agents/career.ts'
import { ALEX, BOTH, SAM } from './fixtures'

const TODAY = '2026-11-06' // a Friday
const goal = (fields: Partial<Goal> = {}): Goal => ({
  id: 'g1',
  user_id: ALEX,
  title: 'Pass the APM exam',
  target_date: null,
  review_days: 14,
  last_reviewed_on: '2026-11-01',
  created_at: '2026-10-01T09:00:00Z',
  done_at: null,
  ...fields,
})
const samGoal = goal({ id: 'g2', user_id: SAM, title: 'Learn Python' })

describe('Career', () => {
  it('says nothing while a goal is on track', () => {
    expect(analyseCareer(TODAY, [goal(), samGoal], BOTH)).toEqual([])
  })

  it('asks for a check-in after the review period, only to the owner', () => {
    const out = analyseCareer(TODAY, [goal({ last_reviewed_on: '2026-10-23' }), samGoal], BOTH)
    expect(out).toMatchObject([
      {
        dedupe_key: 'career:g1:review:2026-10-23',
        kind: 'goal_review',
        severity: 1,
        title: 'Check in on “Pass the APM exam”',
        recipients: [ALEX],
        action: { type: 'create_task', title: 'Review progress: Pass the APM exam', list: 'personal', due_date: '2026-11-07' },
      },
    ])
    expect(out[0].reason).toMatch(/^Last check-in 14 days ago\./)
  })

  it('counts from when the goal was added if it has never been checked in on', () => {
    const [s] = analyseCareer(TODAY, [goal({ last_reviewed_on: null }), samGoal], BOTH)
    expect(s.reason).toMatch(/^Added 36 days ago, no check-in yet\./)
  })

  it('flags a target date within four weeks', () => {
    const [s] = analyseCareer(TODAY, [goal({ target_date: '2026-11-20' }), samGoal], BOTH)
    expect(s).toMatchObject({ kind: 'goal_soon', severity: 2, title: '“Pass the APM exam” is due in 2 weeks', action: { title: 'Next step: Pass the APM exam' } })
  })

  it('asks what to do about a missed target', () => {
    const [s] = analyseCareer(TODAY, [goal({ target_date: '2026-11-01' }), samGoal], BOTH)
    expect(s).toMatchObject({ dedupe_key: 'career:g1:late:2026-11-01', kind: 'goal_late', title: '“Pass the APM exam” was due 1 Nov 2026', action: null })
  })

  it('ignores finished goals, and nudges someone with none to add one', () => {
    const out = analyseCareer(TODAY, [goal({ done_at: '2026-11-02T10:00:00Z', target_date: '2026-11-01' })], BOTH)
    expect(out).toMatchObject([{ dedupe_key: `career:start:${SAM}`, kind: 'career_start', recipients: [SAM] }])
  })

  it('only covers people who have it on', () => {
    expect(analyseCareer(TODAY, [], [ALEX])).toMatchObject([{ recipients: [ALEX] }])
    expect(analyseCareer(TODAY, [], [])).toEqual([])
  })
})
