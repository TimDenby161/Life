// The goal-driven rules: events and limits in the Fitness Coach, Weight & Food,
// event coaching, savings pace, trip offers, language targets, side projects,
// friends, and the goal lines at the top of the briefing.
import type { CalEvent } from '../../../../supabase/functions/_shared/agents/calendar.ts'
import { analyseEvents, parseCareerConfig } from '../../../../supabase/functions/_shared/agents/career.ts'
import { addDays } from '../../../../supabase/functions/_shared/agents/dates.ts'
import { analyseSavings, type FinanceInput, type SavingsGoal } from '../../../../supabase/functions/_shared/agents/finance.ts'
import { analyseFitness, parseFitnessGoals, type Session } from '../../../../supabase/functions/_shared/agents/fitness.ts'
import { goalLines } from '../../../../supabase/functions/_shared/agents/goals.ts'
import { analyseTargets, parseLanguageTargets } from '../../../../supabase/functions/_shared/agents/languages.ts'
import { analyseFood, MEAL_PLAN_TASK, parseFoodGoals, reachBy, type Takeaway, type WeightReading } from '../../../../supabase/functions/_shared/agents/nutrition.ts'
import { analysePeople, nextBirthday, type Person } from '../../../../supabase/functions/_shared/agents/people.ts'
import { analyseProjects, parseProjectsConfig } from '../../../../supabase/functions/_shared/agents/projects.ts'
import { analyseTravel, type Trip } from '../../../../supabase/functions/_shared/agents/travel.ts'
import { ALEX, BOTH, context, SAM, task } from './fixtures'

const MONDAY = '2026-11-09'
const members = context().members

// ---------------------------------------------------------------------------
describe('Fitness Coach: events, limits and together', () => {
  const at = (date: string, description: string, user = ALEX): Session => ({ user_id: user, description, duration_minutes: 60, started_at: `${date}T18:00:00Z` })
  const goals = parseFitnessGoals({
    activities: [{ name: 'Table tennis', times: 2, max: true }, { name: 'Run', times: 1 }],
    events: [{ name: 'Graham Spicer 1★', date: '2026-11-15' }, { name: 'Bad', date: 'soon' }],
  })!

  it('reads events and limits, ignoring junk', () => {
    expect(goals.events).toEqual([{ name: 'Graham Spicer 1★', date: '2026-11-15' }])
    expect(goals.activities[0]).toMatchObject({ name: 'Table tennis', max: true })
  })

  it('tapers in the week before an event, with a light hit the day before', () => {
    const [s] = analyseFitness(MONDAY, members, [], [], [ALEX], () => goals)
    expect(s.kind).toBe('event_taper')
    expect(s.title).toBe('Graham Spicer 1★ on Sun 15 Nov')
    expect(s.action).toMatchObject({ title: 'Light hit before Graham Spicer 1★: 30 min, serves and receive', due_date: '2026-11-14' })
  })

  it('holds back conditioning and strength in the last three days', () => {
    const thu = '2026-11-12'
    const sessions = [at('2026-11-02', 'Table tennis'), at('2026-11-04', 'Table tennis'), at('2026-11-10', 'Padel')]
    const kinds = analyseFitness(thu, members, sessions, [], [ALEX], () => goals).map((s) => s.kind)
    expect(kinds).toContain('event_taper')
    expect(kinds).not.toContain('tt_conditioning')
    expect(kinds).not.toContain('add_strength')
  })

  it('suggests an easy day after the event', () => {
    expect(analyseFitness('2026-11-16', members, [], [], [ALEX], () => goals).map((s) => s.kind)).toContain('event_recovery')
  })

  it('notes going over an "at most" limit and never nags to reach it', () => {
    const fri = '2026-11-20'
    const three = ['2026-11-16', '2026-11-17', '2026-11-19'].map((d) => at(d, 'TT match'))
    const found = analyseFitness(fri, members, three, [], [ALEX], () => ({ ...goals, events: [] }))
    expect(found.find((s) => s.kind === 'over_limit')?.title).toBe('3 table tennis sessions this week')
    expect(analyseFitness(fri, members, [], [], [ALEX], () => ({ ...goals, events: [] })).map((s) => s.title)).not.toContain('No table tennis logged yet this week')
  })

  it('turns the same session still to do for both into one joint suggestion', () => {
    const fri = '2026-11-20'
    const run = parseFitnessGoals({ activities: [{ name: 'Run', times: 1 }] })
    const found = analyseFitness(fri, members, [], [], BOTH, () => run)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ kind: 'goal_together', recipients: [ALEX, SAM] })
    expect(found[0].action).toMatchObject({ title: 'Run together', list: 'joint', needs_both: true })
  })
})

// ---------------------------------------------------------------------------
describe('Weight & Food', () => {
  const goals = parseFoodGoals({ targetKg: 87, weeklyKg: 0.5, soloTakeaways: 0, sharedTakeaways: 1, mealPlanDay: 7 })!
  const daily = (from: string, days: number, start: number, perDay: number, user = ALEX): WeightReading[] =>
    Array.from({ length: days }, (_, i) => ({ user_id: user, date: addDays(from, i), kg: start + perDay * i }))
  const food = (today: string, weights: WeightReading[], takeaways: Takeaway[] = [], open = [] as ReturnType<typeof task>[], g = goals) =>
    analyseFood(today, members, weights, takeaways, open, [ALEX], (id) => (id === ALEX ? g : null))

  it('works out when a target is reached at a weekly rate', () => {
    expect(reachBy(MONDAY, 90.5, 87, 0.5)).toBe(addDays(MONDAY, 49))
    expect(reachBy(MONDAY, 90.5, 87, -0.2)).toBeNull()
  })

  it('reviews last week’s weight on Mondays, only for its owner', () => {
    // Down about 0.07 kg a day for five weeks.
    const weights = daily('2026-10-05', 35, 93, -0.07)
    const [s] = food(MONDAY, weights).filter((x) => x.kind === 'food_week')
    expect(s.recipients).toEqual([ALEX])
    expect(s.title).toMatch(/^90\.\d kg, down 0\.5 on the week before$/)
    expect(s.reason).toContain('kg to 87.0: at 0.5 kg a week that’s about')
    expect(s.reason).toContain('Takeaways: 0 on your own (limit 0), 0 together (limit 1).')
    expect(s.severity).toBe(1)
  })

  it('flags a week going the wrong way', () => {
    const [s] = food(MONDAY, daily('2026-10-05', 35, 90, 0.03)).filter((x) => x.kind === 'food_week')
    expect(s.severity).toBe(2)
    expect(s.reason).toContain('haven’t moved towards it yet')
  })

  it('asks for a weigh-in after a week without one', () => {
    const [s] = food('2026-11-12', daily('2026-10-28', 5, 91, 0)).filter((x) => x.kind === 'weigh_in')
    expect(s.action).toMatchObject({ title: 'Weigh in', list: 'personal' })
    expect(food('2026-11-12', daily('2026-10-28', 5, 91, 0), [], [task({ title: 'Weigh-in' })]).map((x) => x.kind)).not.toContain('weigh_in')
  })

  it('flags takeaways over the limits, on your own and together', () => {
    const t = (eaten_on: string, shared: boolean, user_id = ALEX): Takeaway => ({ user_id, eaten_on, shared })
    const found = food('2026-11-12', daily('2026-11-09', 4, 90, 0), [t('2026-11-10', false), t('2026-11-10', true, SAM), t('2026-11-11', true)])
    const limits = found.filter((s) => s.kind === 'takeaway_limit')
    expect(limits.map((s) => s.title)).toEqual(['1 takeaway on your own this week', '2 takeaways together this week'])
    // Sam's own takeaways don't count against Alex.
    expect(food('2026-11-12', [], [t('2026-11-10', false, SAM)]).map((s) => s.kind)).not.toContain('takeaway_limit')
  })

  it('adds a meal planning task on the planning day', () => {
    const [s] = food('2026-11-15', daily('2026-11-09', 6, 90, 0)).filter((x) => x.kind === 'meal_plan')
    expect(s.action).toMatchObject({ title: MEAL_PLAN_TASK, list: 'personal' })
    const both = analyseFood('2026-11-15', members, [], [], [], BOTH, () => goals).find((x) => x.kind === 'meal_plan')!
    expect(both).toMatchObject({ recipients: BOTH, action: { list: 'joint' } })
  })
})

// ---------------------------------------------------------------------------
describe('Career: event coaching', () => {
  const ev = (title: string, start: string, end = start, owner_id: string | null = SAM): CalEvent => ({ owner_id, title, start, end, allDay: start.length === 10 })
  const config = parseCareerConfig({ eventWords: ['Client', ' congress ', 1, 'x'] })
  const run = (today: string, events: CalEvent[]) => analyseEvents(today, events, BOTH, (id) => (id === SAM ? config : { eventWords: [] }))

  it('cleans the event words', () => {
    expect(config.eventWords).toEqual(['client', 'congress'])
  })

  it('suggests preparing openers for a matching event in the next three days, only to its owner', () => {
    const [s] = run(MONDAY, [ev('Pharma client dinner', '2026-11-11T19:00:00Z', '2026-11-11T22:00:00Z'), ev('Dentist', '2026-11-10T09:00:00Z')])
    expect(s).toMatchObject({ kind: 'event_prep', recipients: [SAM], title: 'Pharma client dinner on Wed 11 Nov: prepare three openers' })
    expect(s.action).toMatchObject({ due_date: '2026-11-10' })
    expect(run(MONDAY, [ev('Client day', '2026-11-20')])).toEqual([])
  })

  it('asks what went well the day after a multi-day event ends', () => {
    const [s] = run(MONDAY, [ev('ESC Congress', '2026-11-05', '2026-11-09')])
    expect(s).toMatchObject({ kind: 'event_reflect', title: 'How did ESC Congress go?' })
  })
})

// ---------------------------------------------------------------------------
describe('Finance: savings pace', () => {
  const input: FinanceInput = {
    today: MONDAY,
    members,
    accounts: [{ id: 'pot-acc', account_type: 'savings', ownership: 'joint', owner_id: null, opening_balance_minor: 0, opening_date: '2026-01-01' }],
    snapshots: [{ account_id: 'pot-acc', as_of: '2026-11-01', balance_minor: 8_000_00, source: 'manual', created_at: '2026-11-01T10:00:00Z' }],
    transactions: [],
  }
  const goal = (fields: Partial<SavingsGoal>): SavingsGoal => ({
    id: 'g', name: 'Wedding', target_minor: 20_000_00, target_date: '2028-07-01', account_id: null, manual_saved_minor: 0,
    pot_id: 'pot', sort_order: 0, ownership: 'joint', owner_id: null, created_at: '2026-11-01T00:00:00Z', ...fields,
  })

  it('funds pot items in order and gives the monthly amount to reach each', () => {
    const found = analyseSavings(input, [goal({}), goal({ id: 'h', name: 'Honeymoon', sort_order: 1, target_date: '2028-10-01' })], [{ id: 'pot', account_id: 'pot-acc' }], BOTH)
    expect(found.map((s) => s.title)).toEqual(['Wedding: £8,000 of £20,000', 'Honeymoon: £0 of £20,000'])
    expect(found[0].reason).toMatch(/^£[\d,]+ a month \(£[\d,]+ each\) reaches it by 1 Jul 2028\.$/)
    expect(found[0].severity).toBe(1)
  })

  it('flags a goal well behind a steady pace', () => {
    const late = goal({ manual_saved_minor: 0, pot_id: null, created_at: '2025-11-01T00:00:00Z' })
    const [s] = analyseSavings(input, [late], [], BOTH)
    expect(s.severity).toBe(2)
    expect(s.reason).toContain('behind a steady pace')
  })

  it('reminds only the owner of a personal goal, and skips goals without a date', () => {
    expect(analyseSavings(input, [goal({ pot_id: null, ownership: 'personal', owner_id: SAM })], [], BOTH)[0].recipients).toEqual([SAM])
    expect(analyseSavings(input, [goal({ target_date: null })], [{ id: 'pot', account_id: 'pot-acc' }], BOTH)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
describe('Travel: asking for offers', () => {
  const trip = (fields: Partial<Trip> = {}): Trip => ({
    id: 'ant', name: 'Antarctica honeymoon', owner_id: null, starts_on: '2029-01-10', ends_on: '2029-01-25', abroad: true,
    transport: 'todo', stay: 'todo', insurance: 'todo', time_off: 'todo', ...fields,
  })

  it('suggests emailing operators a year or more out, with an email to copy', () => {
    const [s] = analyseTravel('2027-09-01', [trip()], [], [], BOTH).filter((x) => x.kind === 'trip_deals')
    expect(s.dedupe_key).toBe('trip:ant:deals:early')
    expect(s.reason).toContain('“Hi, we’re planning Antarctica for two in January 2029, for our honeymoon.')
    expect(s.action).toMatchObject({ title: 'Email 3 operators about Antarctica honeymoon offers', list: 'joint' })
  })

  it('asks again closer to booking, and stops once travel is booked', () => {
    expect(analyseTravel('2028-03-01', [trip()], [], [], BOTH).find((x) => x.kind === 'trip_deals')?.dedupe_key).toBe('trip:ant:deals:again')
    expect(analyseTravel('2027-09-01', [trip({ transport: 'done' })], [], [], BOTH).map((x) => x.kind)).not.toContain('trip_deals')
    expect(analyseTravel(MONDAY, [trip()], [], [], BOTH).map((x) => x.kind)).not.toContain('trip_deals')
  })
})

// ---------------------------------------------------------------------------
describe('Language Coach: targets', () => {
  const targets = parseLanguageTargets({
    targets: [{ language: 'zh', by: '2028-03-01', label: 'China' }, { language: 'es', by: '2027-02-15', label: 'Guatemala' }, { language: 'fr', by: '2027-01-01' }],
  })

  it('reads targets for known languages only', () => {
    expect(targets.map((t) => t.language)).toEqual(['zh', 'es'])
  })

  it('gives a weekly topic for the language that comes first and keeps the other to reviews', () => {
    const [s] = analyseTargets(MONDAY, [ALEX], () => targets)
    expect(s.title).toMatch(/^Guatemala in 14 weeks: this week’s Spanish is /)
    expect(s.reason).toContain('Keep Mandarin to reviews until then.')
    expect(s.action).toMatchObject({ list: 'personal', due_date: MONDAY })
  })

  it('moves to the next target once the first has passed, with a monthly speaking nudge', () => {
    const found = analyseTargets('2027-03-01', [ALEX], () => targets)
    expect(found.map((s) => s.kind)).toEqual(['lang_topic', 'lang_speak'])
    expect(found[0].title).toMatch(/^China in 12 months: this week’s Mandarin is /)
  })

  it('runs through the topics in order in the last weeks, from the basics', () => {
    const topic = (today: string) => analyseTargets(today, [ALEX], () => targets)[0].title.split(' is ')[1]
    expect(topic('2026-11-23')).toBe('greetings and introducing yourself')
    expect(topic('2026-11-30')).toBe('numbers and prices')
    expect(topic('2027-02-08')).toBe('weather, plans and the day ahead')
  })
})

// ---------------------------------------------------------------------------
describe('Side Projects', () => {
  const config = parseProjectsConfig({ projects: [{ name: 'CornerFC', users: 12, goals: [50, 10, 20], updated_on: '2026-11-01' }], sponsorTeam: 'Colin Deaton' })

  it('suggests an experiment on Mondays with progress towards the next goal', () => {
    // The first Monday of the month also brings sponsors to try.
    const found = analyseProjects('2026-11-02', [], [ALEX], () => config)
    expect(found.map((s) => s.kind)).toEqual(['project_milestone', 'project_experiment', 'sponsor_pitch'])
    expect(found[0].title).toBe('CornerFC: 12 paid users')
    expect(found[1].reason).toMatch(/Now 12 of 20 paid users\.$/)
    expect(found[2].reason).toContain('Hi, I play for Colin Deaton')
  })

  it('asks for the count when it’s two weeks old, and stays quiet midweek', () => {
    const found = analyseProjects('2026-11-18', [], [ALEX], () => config)
    expect(found.map((s) => s.kind)).toEqual(['project_milestone', 'project_count'])
  })
})

// ---------------------------------------------------------------------------
describe('Friends', () => {
  const person = (fields: Partial<Person>): Person => ({
    id: 'p1', owner_id: SAM, name: 'Jess', birthday_month: null, birthday_day: null, see_every_weeks: null, last_seen_on: null, created_at: '2026-01-01T00:00:00Z', ...fields,
  })

  it('finds the next birthday, with 29 Feb on the 28th in other years', () => {
    expect(nextBirthday(MONDAY, 2, 29)).toBe('2027-02-28')
    expect(nextBirthday(MONDAY, 11, 9)).toBe(MONDAY)
    expect(nextBirthday(MONDAY, 11, 8)).toBe('2027-11-08')
  })

  it('reminds the owner a week ahead of a birthday, and both for a joint friend', () => {
    const [s] = analysePeople(MONDAY, [person({ birthday_month: 11, birthday_day: 14 })], [], BOTH)
    expect(s).toMatchObject({ kind: 'birthday', recipients: [SAM], title: 'Jess’s birthday is on Sat 14 Nov' })
    expect(s.action).toMatchObject({ title: 'Card or plan for Jess’s birthday', list: 'personal', due_date: '2026-11-11' })
    expect(analysePeople(MONDAY, [person({ owner_id: null, birthday_month: 11, birthday_day: 14 })], [], BOTH)[0]).toMatchObject({ recipients: BOTH, action: { list: 'joint' } })
  })

  it('suggests a meet-up when it’s been longer than you’d like, two at most each', () => {
    const people = ['a', 'b', 'c'].map((id, i) => person({ id, name: id, see_every_weeks: 4, last_seen_on: addDays(MONDAY, -40 - i) }))
    const found = analysePeople(MONDAY, people, [], BOTH)
    expect(found.map((s) => s.title)).toEqual(['6 weeks since you saw c', '6 weeks since you saw b'])
  })
})

// ---------------------------------------------------------------------------
describe('Briefing goal lines', () => {
  it('gives short lines: event, weight, projects, language and savings', () => {
    const lines = goalLines(MONDAY, {
      fitness: parseFitnessGoals({ events: [{ name: 'Graham Spicer 1★', date: '2026-11-15' }] }),
      food: parseFoodGoals({ targetKg: 87 }),
      weights: [{ user_id: ALEX, date: '2026-11-08', kg: 90.4 }],
      projects: parseProjectsConfig({ projects: [{ name: 'CornerFC', users: 0, goals: [10, 20, 50] }] }),
      languages: parseLanguageTargets({ targets: [{ language: 'es', by: '2027-02-15', label: 'Guatemala' }] }),
      savings: [{ name: 'Wedding', saved: 6_000_00, target: 20_000_00 }],
    })
    expect(lines).toEqual([
      { label: 'Graham Spicer 1★', value: '6 days' },
      { label: 'Weight', value: '90.4 → 87.0' },
      { label: 'CornerFC', value: '0/10 paid' },
      { label: 'Guatemala', value: 'Spanish · 3 months' },
      { label: 'Wedding', value: '£6,000/£20,000' },
    ])
  })
})
