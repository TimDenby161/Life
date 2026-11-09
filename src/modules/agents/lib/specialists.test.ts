import { addDays } from '../../../../supabase/functions/_shared/agents/dates.ts'
import { analyseFitness, matchesActivity, parseFitnessGoals, type Session, TT_DRILLS } from '../../../../supabase/functions/_shared/agents/fitness.ts'
import { analyseHousehold, UPKEEP } from '../../../../supabase/functions/_shared/agents/household.ts'
import { analyseLanguages, type Progress } from '../../../../supabase/functions/_shared/agents/languages.ts'
import { formatPounds } from '../../../../supabase/functions/_shared/agents/types.ts'
import { analyseWedding, type WeddingInput } from '../../../../supabase/functions/_shared/agents/wedding.ts'
import { ALEX, BOTH, context, done, SAM, task } from './fixtures'

const TODAY = '2026-11-06'

describe('money', () => {
  it('shows pounds without pence unless there are some', () => {
    expect(formatPounds(125_000)).toBe('£1,250')
    expect(formatPounds(1_250)).toBe('£12.50')
  })
})

// ---------------------------------------------------------------------------
describe('Wedding Planner', () => {
  const base = (fields: Partial<WeddingInput> = {}): WeddingInput => ({
    today: TODAY,
    date: '2028-06-17',
    categoryId: 'c-wedding',
    budget: [],
    suppliers: [],
    guests: [],
    checklist: { open: [], done: 0 },
    ...fields,
  })
  const item = (fields: Partial<WeddingInput['budget'][number]>) => ({
    id: 'b1', name: 'Photographer', category: 'Photos', budget_minor: 200_000, paid_minor: 0, due_date: null, supplier_id: null, ...fields,
  })
  const kinds = (w: WeddingInput) => analyseWedding(w, BOTH).map((s) => s.kind)

  it('asks for the date when there isn’t one, with a task to set it', () => {
    const [s] = analyseWedding(base({ date: null }), BOTH)
    expect(s.kind).toBe('set_date')
    expect(s.action).toMatchObject({ type: 'create_task', title: 'Set the wedding date', list: 'joint', category_id: 'c-wedding' })
  })

  it('flags a payment due within 30 days, urgent within a week, with the amount left', () => {
    const w = base({
      budget: [item({ due_date: '2026-11-10', paid_minor: 50_000, supplier_id: 's1' })],
      suppliers: [{ id: 's1', role: 'Photographer', name: 'Lens & Light' }],
    })
    const [s] = analyseWedding(w, BOTH).filter((x) => x.kind === 'payment')
    expect(s.severity).toBe(3)
    expect(s.title).toBe('Photographer payment due Tue 10 Nov')
    expect(s.reason).toContain('£1,500 left to pay to Lens & Light')
    expect(s.action).toMatchObject({ type: 'create_task', title: 'Pay Photographer', due_date: '2026-11-10' })
  })

  it('leaves paid-off, far-off and already-tasked payments alone', () => {
    const w = base({
      budget: [item({ id: 'a', due_date: '2026-11-10', paid_minor: 200_000 }), item({ id: 'b', name: 'Venue', due_date: '2027-03-01' }), item({ id: 'c', name: 'Cake', due_date: '2026-11-20' })],
      checklist: { open: [task({ title: 'Pay Cake' })], done: 0 },
    })
    expect(kinds(w)).not.toContain('payment')
  })

  it('points out budget lines with no supplier, at most three', () => {
    const budget = ['A', 'B', 'C', 'D'].map((n, i) => item({ id: n, name: n, due_date: addDays(TODAY, 30 + i) }))
    const found = analyseWedding(base({ date: null, budget }), BOTH).filter((s) => s.kind === 'supplier')
    expect(found.map((s) => s.title)).toEqual(['No supplier for A yet', 'No supplier for B yet', 'No supplier for C yet'])
  })

  it('notes an overspend without offering a task', () => {
    const [s] = analyseWedding(base({ budget: [item({ paid_minor: 210_000, supplier_id: 's' })] }), BOTH).filter((x) => x.kind === 'over_budget')
    expect(s.reason).toBe('Paid £2,100 against £2,000 budgeted, £100 over.')
    expect(s.action).toBeNull()
  })

  it('chases RSVPs only close to the day', () => {
    const guests = [{ rsvp: 'pending' }, { rsvp: 'yes' }, { rsvp: 'pending' }]
    expect(kinds(base({ guests }))).not.toContain('rsvp')
    const [s] = analyseWedding(base({ guests, date: addDays(TODAY, 40) }), BOTH).filter((x) => x.kind === 'rsvp')
    expect(s.title).toBe('2 guests haven’t replied')
    expect(s.severity).toBe(3)
  })

  it('writes a monthly summary', () => {
    const w = base({
      budget: [item({ paid_minor: 50_000, supplier_id: 's' })],
      guests: [{ rsvp: 'pending' }],
      checklist: { open: [task({ due_date: '2026-11-20' }), task({ due_date: '2026-10-01' })], done: 3 },
    })
    const [s] = analyseWedding(w, BOTH).filter((x) => x.kind === 'wedding_summary')
    expect(s.dedupe_key).toBe('wedding:summary:2026-11')
    expect(s.title).toBe('Wedding: 3 of 5 checklist items done, 589 days to go')
    expect(s.reason).toBe('1 due in the next 30 days, 1 overdue. £500 of £2,000 paid. 1 of 1 guests still to reply.')
  })

  it('goes to everyone who has it on, and nobody otherwise', () => {
    expect(analyseWedding(base({ date: null }), [SAM])[0].recipients).toEqual([SAM])
    expect(analyseWedding(base({ date: null }), [])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
describe('Language Coach', () => {
  const study = [
    { user_id: ALEX, language: 'zh', active: true },
    { user_id: SAM, language: 'es', active: true },
  ]
  const word = (fields: Partial<Progress>): Progress => ({
    user_id: ALEX, language: 'zh', item: '你好', learned_on: '2026-10-01', due_on: '2026-11-10', interval_days: 8, lapses: 0, last_reviewed_on: TODAY, ...fields,
  })

  it('flags a review pile-up', () => {
    const progress = Array.from({ length: 22 }, (_, i) => word({ item: `w${i}`, due_on: '2026-11-01' }))
    const [s] = analyseLanguages(TODAY, study, progress, BOTH)
    expect(s).toMatchObject({ kind: 'reviews_due', title: '22 Mandarin reviews waiting', recipients: [ALEX] })
  })

  it('lists words that keep slipping and offers a revision task', () => {
    const progress = [word({ item: '谢谢', lapses: 3, interval_days: 1 }), word({ item: '再见', lapses: 2, interval_days: 3 }), word({ item: '好', lapses: 4, interval_days: 20 })]
    const [s] = analyseLanguages(TODAY, study, progress, BOTH)
    expect(s.title).toBe('2 Mandarin words keep slipping')
    expect(s.action).toEqual({ type: 'create_task', title: 'Revise Mandarin: 谢谢, 再见', list: 'personal', due_date: TODAY })
  })

  it('notices a language left alone', () => {
    const progress = [word({ user_id: SAM, language: 'es', item: 'hola', learned_on: '2026-10-20', last_reviewed_on: '2026-10-30' })]
    const [s] = analyseLanguages(TODAY, study, progress, BOTH)
    expect(s).toMatchObject({ kind: 'lang_stalled', title: 'No Spanish for 7 days', recipients: [SAM] })
  })

  it('ignores languages someone has stopped, and people who have it off', () => {
    const progress = [word({ due_on: '2026-01-01', last_reviewed_on: '2026-01-01', learned_on: '2026-01-01' })]
    expect(analyseLanguages(TODAY, [{ ...study[0], active: false }], progress, BOTH)).toEqual([])
    expect(analyseLanguages(TODAY, study, progress, [SAM])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
describe('Fitness Coach', () => {
  const session = (daysAgo: number, description: string, minutes = 60, user = ALEX): Session => ({
    user_id: user, description, duration_minutes: minutes, started_at: `${addDays(TODAY, -daysAgo)}T18:00:00Z`,
  })
  const run = (sessions: Session[], open = [] as ReturnType<typeof task>[]) => analyseFitness(TODAY, context().members, sessions, open, BOTH)
  // A steady month: table tennis twice a week, gym once.
  const steady = [3, 6, 10, 13, 17, 20, 24, 27, 31, 34].map((d) => session(d, d % 2 ? 'Table tennis league match' : 'Table tennis club night', 90))
    .concat([5, 12, 19, 26].map((d) => session(d, 'Gym: squats and press-ups', 45)))

  it('says nothing without any logged sessions', () => {
    expect(run([])).toEqual([])
  })

  it('suggests this week’s table tennis conditioning when training is steady', () => {
    const found = run(steady)
    expect(found.map((s) => s.kind)).toEqual(['add_mobility', 'tt_conditioning'])
    const drill = found[1].action as { title: string }
    expect(TT_DRILLS).toContain(drill.title)
    expect(found.every((s) => s.recipients.length === 1 && s.recipients[0] === ALEX)).toBe(true)
  })

  it('advises recovery after a big jump in load, and adds nothing else', () => {
    const big = [...steady.filter((s) => s.started_at < `${addDays(TODAY, -6)}`), ...[0, 1, 2, 3, 4].map((d) => session(d, 'Table tennis training camp', 150))]
    const found = run(big)
    expect(found[0].kind).toBe('training_load')
    expect(found[0].action).toMatchObject({ title: 'Recovery: 20 min mobility and easy stretching', list: 'personal' })
    expect(found.map((s) => s.kind)).not.toContain('tt_conditioning')
  })

  it('suggests a rest day after six days in a row', () => {
    const streak = [0, 1, 2, 3, 4, 5].map((d) => session(d, 'Run', 30))
    expect(run(streak).map((s) => s.kind)).toContain('rest_day')
  })

  it('asks for strength when there’s been none, explosive for table tennis players', () => {
    const noGym = steady.filter((s) => !s.description.startsWith('Gym'))
    const [s] = run(noGym)
    expect(s.kind).toBe('add_strength')
    expect((s.action as { title: string }).title).toMatch(/^Explosive strength for table tennis/)
  })

  it('notes a gap for someone who usually trains, without saying they didn’t exercise', () => {
    const lapsed = [6, 8, 10, 12, 14, 16].map((d) => session(d, 'Yoga', 45)).concat(session(9, 'Gym session', 45))
    const gap = run(lapsed).find((s) => s.kind === 'get_moving')!
    expect(gap.title).toBe('Nothing logged for 6 days')
  })

  it('doesn’t add a task that’s already on the list', () => {
    const noGym = steady.filter((s) => !s.description.startsWith('Gym'))
    const open = [task({ title: 'Explosive strength for table tennis: 3 × 5 squat jumps, 3 × 8 split squats, 3 × 10 calf raises' })]
    expect(run(noGym, open).map((s) => s.kind)).not.toContain('add_strength')
  })

  it('only coaches people who have it on', () => {
    expect(analyseFitness(TODAY, context().members, steady, [], [SAM])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
describe('Household Coordinator', () => {
  const rooms = [{ id: 'r1', name: 'Kitchen' }, { id: 'r2', name: 'Balcony' }]

  it('suggests the most important missing upkeep as joint jobs, three at a time', () => {
    const found = analyseHousehold(context(), [], BOTH)
    expect(found.map((s) => s.dedupe_key)).toEqual(['household:smoke_alarms', 'household:boiler', 'household:extractor'])
    expect(found[0].action).toEqual({ type: 'create_task', title: 'Test the smoke alarms', list: 'joint', due_date: '2026-11-07', recurrence: { freq: 'monthly', interval: 1, afterDone: true } })
  })

  it('skips anything already on the list or done recently, by its words', () => {
    const ctx = context({ open: [task({ title: 'Test smoke alarm' })], events: [done('Boiler service', '2026-09-01')] })
    expect(analyseHousehold(ctx, [], BOTH).map((s) => s.dedupe_key)).toEqual(['household:extractor', 'household:washing_machine', 'household:dishwasher'])
  })

  it('names rooms with no jobs', () => {
    const ctx = context({ open: UPKEEP.map((u) => task({ title: u.title, room_id: 'r1' })) })
    const found = analyseHousehold(ctx, rooms, BOTH)
    expect(found.map((s) => s.title)).toEqual(['No jobs for the Balcony'])
  })
})

// ---------------------------------------------------------------------------
describe('Fitness Coach with goals', () => {
  // Friday 6 Nov 2026; the week started Monday 2 Nov.
  const goals = parseFitnessGoals({
    activeDays: 6,
    activities: [{ name: 'Table tennis', times: 1 }, { name: 'Padel', times: 1 }, { name: 'Run', times: 1, optional: true }],
  })!
  const at = (date: string, description: string, minutes = 60): Session => ({ user_id: ALEX, description, duration_minutes: minutes, started_at: `${date}T18:00:00Z` })
  const coach = (sessions: Session[], today = TODAY, open = [] as ReturnType<typeof task>[]) =>
    analyseFitness(today, context().members, sessions, open, BOTH, (id) => (id === ALEX ? goals : null)).filter((s) => s.recipients[0] === ALEX)

  it('reads goals from settings, ignoring junk', () => {
    expect(goals).toEqual({ activeDays: 6, activities: [{ name: 'Table tennis', times: 1, optional: false, max: false }, { name: 'Padel', times: 1, optional: false, max: false }, { name: 'Run', times: 1, optional: true, max: false }], events: [] })
    expect(parseFitnessGoals({})).toBeNull()
    expect(parseFitnessGoals({ activeDays: 9, activities: [{ name: '', times: 1 }, { name: 'Swim', times: 0 }, 'x'] })).toBeNull()
  })

  it('counts sessions by their words and aliases', () => {
    expect(matchesActivity('TT league match', 'Table tennis')).toBe(true)
    expect(matchesActivity('Parkrun', 'Run')).toBe(true)
    expect(matchesActivity('Padel with Sam', 'padel')).toBe(true)
    expect(matchesActivity('Running club', 'Padel')).toBe(false)
  })

  it('nudges a weekly activity not done by Thursday, but not optional ones', () => {
    const week = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'].map((d, i) => at(d, i === 0 ? 'Table tennis club night' : 'Gym and stretching'))
    const found = coach(week)
    expect(found.map((s) => s.title)).toContain('No padel logged yet this week')
    expect(found.find((s) => s.kind === 'goal_activity')!.action).toMatchObject({ title: 'Padel session', due_date: '2026-11-07' })
    expect(found.map((s) => s.title).join()).not.toMatch(/run/i)
  })

  it('doesn’t nudge early in the week', () => {
    expect(coach([at('2026-11-02', 'Gym')], '2026-11-03').map((s) => s.kind)).not.toContain('goal_activity')
  })

  it('notices active days falling behind the goal', () => {
    const found = coach([at('2026-11-02', 'Table tennis'), at('2026-11-04', 'Padel')])
    expect(found.find((s) => s.kind === 'goal_pace')).toMatchObject({ title: '2 active days logged so far this week', action: { title: '20 min walk or mobility' } })
  })

  it('reviews last week on Monday', () => {
    const lastWeek = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'].map((d, i) => at(d, i === 0 ? 'Table tennis' : i === 1 ? 'Parkrun' : 'Gym'))
    const review = coach(lastWeek, '2026-11-09').find((s) => s.kind === 'fitness_week')!
    expect(review.title).toBe('Last week: 5 of 6 active days')
    expect(review.reason).toBe('Table tennis 1 of 1 ✓, padel 0 of 1, run 1 (optional).')
  })

  it('aims for a rest day after seven in a row, not six, when the goal is almost every day', () => {
    const six = [0, 1, 2, 3, 4, 5].map((d) => at(addDays(TODAY, -d), 'Gym', 30))
    expect(coach(six).map((s) => s.kind)).not.toContain('rest_day')
    expect(coach([...six, at(addDays(TODAY, -6), 'Padel', 30)]).map((s) => s.kind)).toContain('rest_day')
  })
})

describe('Wedding Planner with only the month known', () => {
  const w = (today: string): WeddingInput => ({
    today, date: '2028-09-01', dateApprox: true, categoryId: 'c', budget: [], suppliers: [], guests: [{ rsvp: 'pending' }],
    checklist: { open: [task({ due_date: '2027-01-01' })], done: 2 },
  })

  it('talks in months, not an exact countdown', () => {
    const [s] = analyseWedding(w(TODAY), BOTH)
    expect(s.title).toBe('Wedding: 2 of 3 checklist items done, about 22 months to go')
  })

  it('asks to fix the exact day within a year', () => {
    expect(analyseWedding(w(TODAY), BOTH).map((s) => s.kind)).not.toContain('set_date')
    const found = analyseWedding(w('2027-10-01'), BOTH).find((s) => s.kind === 'set_date')!
    expect(found.title).toBe('Time to fix the exact wedding date')
    expect(found.reason).toContain('around September 2028')
  })

  it('doesn’t chase RSVPs against a guessed day', () => {
    expect(analyseWedding(w('2028-07-01'), BOTH).map((s) => s.kind)).not.toContain('rsvp')
  })
})
