import {
  AISLES,
  cleanItems,
  cleanPlan,
  cleanRecipes,
  openSlots,
  planDates,
  planInput,
  weekStartOf,
  mealKey,
  RECIPES_PER_CALL,
  recipesInput,
  weekMeals,
  withRecipes,
  isMonday,
  isSplit,
  MAX_ITEMS,
  type MealRow,
  mealsKey,
  plannedMeals,
  SHOPPING_SCHEMA,
  shoppingInput,
  weekDates,
  weekPlan,
} from '../../../../supabase/functions/_shared/meals.ts'

const WEEK = '2026-11-09' // a Monday
const TIM = 'tim'
const SOPHIE = 'sophie'
let n = 0
const meal = (day: string, slot: string, name: string, person_id: string | null = null): MealRow => ({ id: `m${++n}`, day, slot, person_id, name })

describe('the week', () => {
  it('only accepts a real Monday', () => {
    expect(isMonday(WEEK)).toBe(true)
    expect(isMonday('2026-11-10')).toBe(false)
    expect(isMonday('2026-02-30')).toBe(false)
    expect(isMonday('next week')).toBe(false)
  })

  it('runs Monday to Sunday, across a month end and a clock change', () => {
    expect(weekDates(WEEK)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'])
    expect(weekDates('2026-10-19')[6]).toBe('2026-10-25')
    expect(weekDates('2026-11-30')[6]).toBe('2026-12-06')
  })

  it('has 21 slots by default, empty ones included', () => {
    const plan = weekPlan(WEEK, [meal('2026-11-09', 'dinner', 'Chilli')])
    expect(plan).toHaveLength(21)
    expect(plan.filter((s) => s.shared)).toHaveLength(1)
    expect(plan[2]).toMatchObject({ day: '2026-11-09', slot: 'dinner', shared: { name: 'Chilli' } })
    expect(plan.some(isSplit)).toBe(false)
  })

  it('splits a slot once someone has their own meal in it, and ignores meals from other weeks', () => {
    const plan = weekPlan(WEEK, [
      meal('2026-11-10', 'lunch', 'Soup', TIM),
      meal('2026-11-10', 'lunch', 'Salad', SOPHIE),
      meal('2026-11-16', 'lunch', 'Next week'),
    ])
    const lunch = plan.find((s) => s.day === '2026-11-10' && s.slot === 'lunch')!
    expect(isSplit(lunch)).toBe(true)
    expect(lunch.personal.map((r) => r.name)).toEqual(['Soup', 'Salad'])
    expect(plan.filter((s) => s.shared || s.personal.length)).toHaveLength(1)
  })
})

describe('what Claude is sent', () => {
  it('feeds both of you from a shared slot and one person from each half of a split one', () => {
    const rows = [
      meal('2026-11-09', 'dinner', '  Chicken   curry '),
      meal('2026-11-10', 'lunch', 'Soup', TIM),
      meal('2026-11-10', 'lunch', 'Salad', SOPHIE),
    ]
    expect(plannedMeals(WEEK, rows)).toEqual([
      { day: 'Mon', slot: 'dinner', meal: 'Chicken curry', people: 2 },
      { day: 'Tue', slot: 'lunch', meal: 'Salad', people: 1 },
      { day: 'Tue', slot: 'lunch', meal: 'Soup', people: 1 },
    ])
  })

  it('counts the same meal typed by both as one meal for two, and a split slot wins over a leftover shared meal', () => {
    const rows = [
      meal('2026-11-11', 'dinner', 'Old shared meal'),
      meal('2026-11-11', 'dinner', 'Pasta', TIM),
      meal('2026-11-11', 'dinner', 'pasta', SOPHIE),
    ]
    expect(plannedMeals(WEEK, rows)).toEqual([{ day: 'Wed', slot: 'dinner', meal: 'Pasta', people: 2 }])
  })

  it('sends nothing but the day, slot, meal and number of people', () => {
    const sent = JSON.parse(shoppingInput(plannedMeals(WEEK, [meal('2026-11-10', 'lunch', 'Soup', TIM)])))
    expect(sent).toEqual({ meals: [{ day: 'Tue', slot: 'lunch', meal: 'Soup', people: 1 }] })
    expect(JSON.stringify(sent)).not.toContain(TIM)
  })

  it('offers exactly the aisles the database allows', () => {
    expect(SHOPPING_SCHEMA.properties.items.items.properties.aisle.enum).toEqual(AISLES.map((a) => a.key))
  })
})

describe('mealsKey', () => {
  const a = meal('2026-11-09', 'dinner', 'Chilli')
  const b = meal('2026-11-10', 'lunch', 'Soup', TIM)
  const c = meal('2026-11-10', 'lunch', 'Salad', SOPHIE)

  it('is the same whatever order the rows come in, and however the names are spaced or capitalised', () => {
    expect(mealsKey(WEEK, [c, a, b])).toBe(mealsKey(WEEK, [a, b, c]))
    expect(mealsKey(WEEK, [{ ...a, name: ' chilli ' }, b, c])).toBe(mealsKey(WEEK, [a, b, c]))
  })

  it('changes when a meal changes, is removed, or is split', () => {
    const key = mealsKey(WEEK, [a, b, c])
    expect(mealsKey(WEEK, [{ ...a, name: 'Stew' }, b, c])).not.toBe(key)
    expect(mealsKey(WEEK, [a, b])).not.toBe(key)
    expect(mealsKey(WEEK, [{ ...a, person_id: TIM }, b, c])).not.toBe(key)
  })
})

describe('cleanItems', () => {
  const answer = (items: unknown) => JSON.stringify({ items })

  it('keeps a plain list, tidying spaces', () => {
    expect(cleanItems(answer([{ name: ' Chicken  thighs ', quantity: '600g', aisle: 'meat_fish' }]))).toEqual([{ name: 'Chicken thighs', quantity: '600g', aisle: 'meat_fish' }])
  })

  it('is null when the answer is not a list', () => {
    expect(cleanItems('not json')).toBeNull()
    expect(cleanItems(JSON.stringify({ items: 'milk' }))).toBeNull()
    expect(cleanItems(JSON.stringify({}))).toBeNull()
  })

  it('drops links, markup, over-long names and repeats', () => {
    const items = cleanItems(
      answer([
        { name: 'Milk', quantity: '2 pints', aisle: 'dairy' },
        { name: 'milk', quantity: '1 pint', aisle: 'dairy' },
        { name: 'See https://example.com', quantity: '1', aisle: 'other' },
        { name: '<b>Eggs</b>', quantity: '6', aisle: 'dairy' },
        { name: 'x'.repeat(61), quantity: '1', aisle: 'other' },
        { name: 42, quantity: '1', aisle: 'other' },
        null,
      ]),
    )
    expect(items).toEqual([{ name: 'Milk', quantity: '2 pints', aisle: 'dairy' }])
  })

  it('puts an unknown aisle under other and blanks a quantity it does not trust', () => {
    expect(cleanItems(answer([{ name: 'Rice', quantity: 'q'.repeat(31), aisle: 'aisle 9' }]))).toEqual([{ name: 'Rice', quantity: '', aisle: 'other' }])
  })

  it(`stops at ${MAX_ITEMS} items`, () => {
    const many = Array.from({ length: MAX_ITEMS + 20 }, (_, i) => ({ name: `Item ${i}`, quantity: '1', aisle: 'other' }))
    expect(cleanItems(answer(many))).toHaveLength(MAX_ITEMS)
  })
})

describe('recipes', () => {
  const rows = [
    meal('2026-11-09', 'dinner', 'Chicken curry'),
    meal('2026-11-10', 'lunch', 'Soup', TIM),
    meal('2026-11-10', 'lunch', 'Salad', SOPHIE),
    meal('2026-11-12', 'dinner', ' chicken  CURRY '),
  ]

  it('lists each different meal of the week once, with every slot it is eaten in', () => {
    expect(weekMeals(WEEK, rows)).toEqual([
      { key: 'chicken curry', name: 'Chicken curry', when: [{ day: 'Mon', slot: 'dinner' }, { day: 'Thu', slot: 'dinner' }] },
      { key: 'salad', name: 'Salad', when: [{ day: 'Tue', slot: 'lunch' }] },
      { key: 'soup', name: 'Soup', when: [{ day: 'Tue', slot: 'lunch' }] },
    ])
  })

  it('sends Claude only the meal names and how many to cook for', () => {
    expect(JSON.parse(recipesInput(['Chicken curry', 'Soup'], 2))).toEqual({ serves: 2, meals: ['Chicken curry', 'Soup'] })
    expect(RECIPES_PER_CALL).toBeLessThanOrEqual(6)
  })

  const answer = (recipes: unknown) => JSON.stringify({ recipes })
  const curry = {
    meal: 'Chicken curry',
    cook: true,
    minutes: 45,
    ingredients: [{ item: 'Chicken thighs', quantity: '600g' }, { item: 'Onion', quantity: '1' }],
    steps: ['Fry the onion for 5 minutes until soft.', 'Add the chicken and cook until the juices run clear (under 75°C is not done: aim for > 75°C).'],
  }

  it('keeps a recipe for a meal that was asked about, under that meal\'s key', () => {
    expect(cleanRecipes(answer([curry]), [' Chicken  curry '])).toEqual([
      { key: 'chicken curry', name: 'Chicken curry', minutes: 45, ingredients: curry.ingredients, steps: curry.steps },
    ])
    expect(mealKey(' Chicken  CURRY ')).toBe('chicken curry')
  })

  it('ignores recipes nobody asked for and repeats', () => {
    expect(cleanRecipes(answer([curry, { ...curry, meal: 'Trifle' }, curry]), ['Chicken curry'])).toHaveLength(1)
  })

  it('keeps a meal with nothing to cook, with no steps, so it is not asked about again', () => {
    expect(cleanRecipes(answer([{ meal: 'Leftovers', cook: false, minutes: 0, ingredients: [], steps: [] }]), ['Leftovers'])).toEqual([
      { key: 'leftovers', name: 'Leftovers', minutes: null, ingredients: [], steps: [] },
    ])
  })

  it('drops a recipe whole rather than saving one with a step or ingredient missing', () => {
    const linked = { ...curry, steps: [...curry.steps, 'See https://example.com for the rest.'] }
    const marked = { ...curry, ingredients: [...curry.ingredients, { item: '<b>Rice</b>', quantity: '200g' }] }
    const empty = { ...curry, steps: [] }
    expect(cleanRecipes(answer([linked]), ['Chicken curry'])).toEqual([])
    expect(cleanRecipes(answer([marked]), ['Chicken curry'])).toEqual([])
    expect(cleanRecipes(answer([empty]), ['Chicken curry'])).toEqual([])
    expect(cleanRecipes('not json', ['Chicken curry'])).toBeNull()
  })

  it('blanks a time it does not trust', () => {
    expect(cleanRecipes(answer([{ ...curry, minutes: 100000 }]), ['Chicken curry'])![0].minutes).toBeNull()
  })

  it('gives the shopping list the saved recipe\'s ingredients, and nothing extra for meals without one', () => {
    const saved = [
      { meal_key: 'chicken curry', serves: 2, ingredients: curry.ingredients },
      { meal_key: 'soup', serves: 2, ingredients: [] },
    ]
    const sent = JSON.parse(shoppingInput(withRecipes(plannedMeals(WEEK, rows), saved))).meals
    expect(sent[0]).toEqual({ day: 'Mon', slot: 'dinner', meal: 'Chicken curry', people: 2, recipe: { serves: 2, ingredients: curry.ingredients } })
    expect(sent.find((m: { meal: string }) => m.meal === 'Soup')).toEqual({ day: 'Tue', slot: 'lunch', meal: 'Soup', people: 1 })
    expect(sent.find((m: { meal: string }) => m.meal === 'Salad')).not.toHaveProperty('recipe')
  })

  it('does not let a recipe change which meals a list was built from', () => {
    expect(mealsKey(WEEK, rows)).toBe(mealsKey(WEEK, [...rows].reverse()))
  })
})

describe('planning the next few days', () => {
  const FROM = '2026-11-13' // Friday: the four days run into next week

  it('lists the empty lunches and dinners someone is in for, with who and the note', () => {
    const open = openSlots(
      FROM,
      [TIM, SOPHIE],
      [
        { day: '2026-11-13', slot: 'dinner', person_id: SOPHIE, available: false },
        { day: '2026-11-14', slot: 'lunch', person_id: TIM, available: false },
        { day: '2026-11-14', slot: 'lunch', person_id: SOPHIE, available: false },
      ],
      [{ day: '2026-11-15', slot: 'dinner', note: '  something   slow  ' }],
      [{ id: '1', day: '2026-11-13', slot: 'lunch', person_id: null, name: 'Soup' }],
    )
    expect(open.map((s) => `${s.day} ${s.slot} ${s.eaters.join('+')}${s.note ? ` "${s.note}"` : ''}`)).toEqual([
      '2026-11-13 dinner tim',
      '2026-11-14 dinner tim+sophie',
      '2026-11-15 lunch tim+sophie',
      '2026-11-15 dinner tim+sophie "something slow"',
      '2026-11-16 lunch tim+sophie',
      '2026-11-16 dinner tim+sophie',
    ])
    expect([...new Set(planDates(FROM).map(weekStartOf))]).toEqual(['2026-11-09', '2026-11-16'])
  })

  it('sends Claude how many are eating, never who', () => {
    const open = openSlots(FROM, [TIM, SOPHIE], [{ day: FROM, slot: 'dinner', person_id: SOPHIE, available: false }], [], [])
    const input = planInput(open.slice(0, 2), [], ['Fish pie', 'fish pie ', 'Ramen'], ['Chilli'])
    expect(input).not.toMatch(/tim|sophie/)
    expect(JSON.parse(input)).toMatchObject({
      slots: [
        { date: FROM, weekday: 'Fri', slot: 'lunch', people: 2 },
        { date: FROM, weekday: 'Fri', slot: 'dinner', people: 1 },
      ],
      wanted: ['Fish pie', 'Ramen'],
      recently_eaten: ['Chilli'],
    })
  })

  it('keeps only open slots, one meal each, as a meal for both or one each for whoever is in', () => {
    const open = openSlots(FROM, [TIM, SOPHIE], [{ day: FROM, slot: 'dinner', person_id: SOPHIE, available: false }], [], [])
    const raw = JSON.stringify({
      meals: [
        { date: FROM, slot: 'lunch', meal: ' Leftovers ' },
        { date: FROM, slot: 'lunch', meal: 'Second go' },
        { date: FROM, slot: 'dinner', meal: 'Fish pie' },
        { date: '2026-12-25', slot: 'dinner', meal: 'Turkey' },
        { date: '2026-11-14', slot: 'dinner', meal: 'See https://example.com' },
      ],
    })
    expect(cleanPlan(raw, open, 2)).toEqual([
      { day: FROM, slot: 'lunch', person_id: null, name: 'Leftovers' },
      { day: FROM, slot: 'dinner', person_id: TIM, name: 'Fish pie' },
    ])
    expect(cleanPlan('not json', open, 2)).toBeNull()
  })
})
