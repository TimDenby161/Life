import { AREA_KEYS, type AreaSource, areaFacts, areasFree, cleanIdeas, MAX_IDEA_CHARS } from '../../../../supabase/functions/_shared/agents/ideas.ts'

const TODAY = '2026-11-13'
const TIM = 'tim'
const SOPHIE = 'sophie'
const empty: AreaSource = {
  goals: [], wedding: { date: null, dateApprox: false, venues: 0, guests: 0 }, trips: [], wants: [], checklist: [], people: [],
  languages: [], coaching: [], hustles: [], mealsPlanned: 0, openIdeas: [],
}

describe('daily ideas: Claude’s answer', () => {
  it('keeps one tidy idea per offered area', () => {
    const ideas = cleanIdeas(
      [
        { area: 'people', title: '  Choose a gift for   Jess’s birthday 🎁 ', minutes: 20 },
        { area: 'people', title: 'A second one for the same area' },
        { area: 'finance', title: 'Set up a savings goal for the honeymoon', minutes: 300 },
        { area: 'health', title: 'Not offered today' },
        { area: 'languages', title: 'ok' },
        { area: 'nonsense', title: 'Not an area' },
        'not even an object',
      ],
      ['people', 'finance', 'languages'],
    )
    expect(ideas).toEqual([
      { area: 'people', title: 'Choose a gift for Jess’s birthday', minutes: 20 },
      { area: 'finance', title: 'Set up a savings goal for the honeymoon', minutes: 45 },
    ])
    expect(cleanIdeas({ items: [] }, AREA_KEYS)).toEqual([])
  })

  it('cuts long titles and defaults the minutes', () => {
    const [idea] = cleanIdeas([{ area: 'meals', title: 'x'.repeat(200) }], AREA_KEYS)
    expect(idea.title).toHaveLength(MAX_IDEA_CHARS)
    expect(idea.minutes).toBe(15)
  })
})

describe('daily ideas: which areas and what Claude is told', () => {
  it('offers no new idea in an area while one of theirs is open there', () => {
    const src = { openIdeas: [{ assignee_id: TIM, ai_area: 'people' }, { assignee_id: SOPHIE, ai_area: 'finance' }] }
    expect(areasFree(src, TIM)).not.toContain('people')
    expect(areasFree(src, TIM)).toContain('finance')
    expect(areasFree(src, TIM)).toHaveLength(9)
  })

  it('gives each area plain facts: theirs and shared things only, and nothing about health', () => {
    const facts = areaFacts(
      {
        ...empty,
        goals: [{ name: 'Wedding', owner_id: null, target_date: '2028-06-01' }, { name: 'Sophie’s car', owner_id: SOPHIE, target_date: null }],
        wedding: { date: '2028-06-01', dateApprox: true, venues: 3, guests: 0 },
        trips: [{ name: 'Central America', owner_id: null, starts_on: '2027-02-27', ends_on: '2027-03-14', confirmed: true }],
        wants: [{ name: 'Kettle', owner_id: TIM, need_by: '2026-11-20' }, { name: 'Her boots', owner_id: SOPHIE, need_by: '2026-11-15' }],
        checklist: [{ title: 'Milk', due_date: null }],
        people: [
          { name: 'Jess', owner_id: TIM, birthday_month: 11, birthday_day: 20, see_every_weeks: null, last_seen_on: null },
          { name: 'Sam', owner_id: null, birthday_month: null, birthday_day: null, see_every_weeks: 4, last_seen_on: '2026-09-01' },
          { name: 'Her friend', owner_id: SOPHIE, birthday_month: 11, birthday_day: 14, see_every_weeks: null, last_seen_on: null },
        ],
        languages: [{ user_id: TIM, language: 'Spanish', active: true }, { user_id: SOPHIE, language: 'French', active: true }],
        coaching: [{ user_id: TIM, day: '2026-11-04' }, { user_id: TIM, day: '2026-11-11' }],
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
    expect(facts.side_hustles).toEqual(['Side hustles: CornerFC'])
    expect(facts.meals).toEqual(['Meals planned for the next 7 days: 4'])
    expect(facts.health.join(' ')).not.toMatch(/\d/)
  })

  it('says when an area is empty, so the idea can be setting it up', () => {
    const facts = areaFacts(empty, TIM, TODAY)
    expect(facts.finance).toEqual(['No savings goals set up in the app yet'])
    expect(facts.people).toEqual(['No friends or family in the app yet'])
    expect(facts.shopping).toEqual(['The shopping list is empty'])
  })
})
