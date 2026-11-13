import { type AreaInput, type AreaSource, areaFacts, cleanIdeas, MAX_IDEA_CHARS, MAX_PER_AREA, MAX_PER_DAY, planAreas, planGoals, TOGETHER } from '../../../../supabase/functions/_shared/agents/ideas.ts'

const TODAY = '2026-11-13'
const TIM = 'tim'
const SOPHIE = 'sophie'
const empty: AreaSource = {
  savings: [], wedding: { date: null, dateApprox: false, venues: 0, guests: 0 }, trips: [], wants: [], checklist: [], people: [],
  languages: [], coaching: [], hustles: [], mealsPlanned: 0, openIdeas: [], goals: [],
}
const plan = (who: string) => ({ for: who, who, goals: [], facts: [], open_jobs: [], open_tasks_you_added: [] })
const offered: AreaInput[] = [
  { area: 'people', label: 'People', plans: [plan(TIM), plan(SOPHIE), plan(TOGETHER)] },
  { area: 'table_tennis', label: 'Table tennis', plans: [plan(TIM)] },
  { area: 'shopping', label: 'Shopping', plans: [plan(TOGETHER)] },
]

describe('daily tasks: Claude’s answer', () => {
  it('keeps tidy tasks for offered areas and plans, any number up to the caps', () => {
    const ideas = cleanIdeas(
      [
        { area: 'people', for: TIM, title: '  Choose a gift for   Jess’s birthday 🎁 ', minutes: 20 },
        { area: 'people', for: TIM, title: 'Book a table for Sam’s leaving drinks', minutes: 300 },
        { area: 'people', for: SOPHIE, title: 'Message Amy about Saturday' },
        { area: 'people', for: TOGETHER, title: 'Pick a date to have Jo and Dan round' },
        { area: 'table_tennis', for: SOPHIE, title: 'Not her area' },
        { area: 'finance', for: TIM, title: 'Area not offered' },
        { area: 'shopping', for: TOGETHER, title: 'ok' },
        'not even an object',
      ],
      offered,
    )
    expect(ideas).toEqual([
      { area: 'people', for: TIM, title: 'Choose a gift for Jess’s birthday', minutes: 20 },
      { area: 'people', for: TIM, title: 'Book a table for Sam’s leaving drinks', minutes: 45 },
      { area: 'people', for: SOPHIE, title: 'Message Amy about Saturday', minutes: 15 },
      { area: 'people', for: TOGETHER, title: 'Pick a date to have Jo and Dan round', minutes: 15 },
    ])
    expect(cleanIdeas([], offered)).toEqual([])
    expect(cleanIdeas({ items: [] }, offered)).toEqual([])
  })

  it('caps each plan per area and per day, and drops repeats', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ area: i < 5 ? 'people' : 'table_tennis', for: TIM, title: `Task number ${i}` }))
    const ideas = cleanIdeas([...many, { area: 'people', for: SOPHIE, title: 'Task number 0' }, { area: 'people', for: SOPHIE, title: 'task NUMBER 0' }], offered)
    const tims = ideas.filter((i) => i.for === TIM)
    expect(tims.filter((i) => i.area === 'people')).toHaveLength(MAX_PER_AREA)
    expect(tims.length).toBeLessThanOrEqual(MAX_PER_DAY)
    expect(ideas.filter((i) => i.for === SOPHIE)).toHaveLength(1)
    const [long] = cleanIdeas([{ area: 'people', for: TIM, title: 'x'.repeat(200) }], offered)
    expect(long.title).toHaveLength(MAX_IDEA_CHARS)
  })
})

describe('daily tasks: what each plan works from', () => {
  it('gives each person their picked areas, and Together what either picked bar the solo ones', () => {
    const { person, together } = planAreas({ [TIM]: ['people', 'table_tennis', 'languages'], [SOPHIE]: ['people', 'wedding'] })
    expect(person[TIM]).toEqual(['table_tennis', 'people', 'languages'])
    expect(together).toEqual(['wedding', 'people', 'languages'])
  })

  it('gives each plan its own goals and the open tasks added before', () => {
    const src = {
      goals: [
        { owner_id: TIM, area: 'holidays', goal: 'Tim plans the holidays' },
        { owner_id: null, area: 'holidays', goal: 'Guatemala Feb 2027' },
        { owner_id: SOPHIE, area: 'meals', goal: 'Plan meals' },
      ],
      openIdeas: [
        { assignee_id: TIM, needs_both: false, ai_area: 'holidays', title: 'Check passport dates' },
        { assignee_id: null, needs_both: true, ai_area: 'holidays', title: 'Choose Guatemala dates together' },
      ],
    }
    expect(planGoals(src, 'holidays', TIM)).toEqual({ goals: ['Tim plans the holidays'], open_tasks_you_added: ['Check passport dates'] })
    expect(planGoals(src, 'holidays', TOGETHER)).toEqual({ goals: ['Guatemala Feb 2027'], open_tasks_you_added: ['Choose Guatemala dates together'] })
    expect(planGoals(src, 'holidays', SOPHIE)).toEqual({ goals: [], open_tasks_you_added: [] })
  })

  it('gives each area plain facts: theirs and shared things only, nothing about health', () => {
    const facts = areaFacts(
      {
        ...empty,
        savings: [{ name: 'Wedding', owner_id: null, target_date: '2028-06-01' }, { name: 'Sophie’s car', owner_id: SOPHIE, target_date: null }],
        wedding: { date: '2028-06-01', dateApprox: true, venues: 3, guests: 0 },
        trips: [{ name: 'Central America', owner_id: null, starts_on: '2027-02-27', ends_on: '2027-03-14', confirmed: true }],
        wants: [{ name: 'Kettle', owner_id: TIM, need_by: '2026-11-20' }, { name: 'Her boots', owner_id: SOPHIE, need_by: '2026-11-15' }],
        checklist: [{ title: 'Milk', due_date: null }],
        people: [
          { name: 'Jess', owner_id: TIM, birthday_month: 11, birthday_day: 20, see_every_weeks: null, last_seen_on: null },
          { name: 'Sam', owner_id: null, birthday_month: null, birthday_day: null, see_every_weeks: 4, last_seen_on: '2026-09-01' },
        ],
        languages: [{ user_id: TIM, language: 'Spanish', active: true }],
        coaching: [{ user_id: TIM, day: '2026-11-11' }],
        hustles: [{ user_id: TIM, name: 'CornerFC' }],
        mealsPlanned: 4,
      },
      TIM,
      TODAY,
    )
    expect(facts.finance).toEqual(['Savings goals: Wedding (by 1 Jun 2028)'])
    expect(facts.wedding).toEqual(['Wedding: around Jun 2028', 'Venues saved: 3', 'Guests on the list: 0'])
    expect(facts.holidays).toEqual(['Central America: 27 Feb 2027 to 14 Mar 2027 (going)'])
    expect(facts.shopping).toEqual(['On the shopping list: 2', 'Needed soonest: Kettle (20 Nov)'])
    expect(facts.people).toEqual(['Jess: birthday 20 Nov', 'Not seen for a while: Sam'])
    expect(facts.languages).toEqual(['Studying: Spanish'])
    expect(facts.table_tennis).toEqual(['Last coaching session logged: 11 Nov'])
    expect(facts.health.join(' ')).not.toMatch(/\d/)
  })
})
