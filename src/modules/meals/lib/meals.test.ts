import {
  AISLES,
  cleanItems,
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
