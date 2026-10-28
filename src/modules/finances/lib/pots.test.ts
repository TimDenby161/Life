import { fundPot, move, nextTarget } from './pots'

const items = [
  { id: 'italy', target_minor: 150_000 },
  { id: 'cornwall', target_minor: 80_000 },
  { id: 'japan', target_minor: 400_000 },
]

describe('fundPot', () => {
  it('funds items one at a time, in order', () => {
    const pot = fundPot(200_000, items)
    expect(pot.items.map((i) => [i.id, i.funded, i.status])).toEqual([
      ['italy', 150_000, 'funded'],
      ['cornwall', 50_000, 'funding'],
      ['japan', 0, 'waiting'],
    ])
    expect(pot).toMatchObject({ needed: 630_000, spare: 0, shortfall: 430_000 })
  })

  it('marks the first unfunded item as the one being saved for, even with nothing in it', () => {
    expect(fundPot(150_000, items).items.map((i) => i.status)).toEqual(['funded', 'funding', 'waiting'])
    expect(fundPot(0, items).items.map((i) => i.status)).toEqual(['funding', 'waiting', 'waiting'])
  })

  it('reports money left once everything is funded', () => {
    const pot = fundPot(700_000, items)
    expect(pot.items.every((i) => i.status === 'funded')).toBe(true)
    expect(pot).toMatchObject({ spare: 70_000, shortfall: 0 })
  })

  it('treats an overdrawn account as empty', () => {
    expect(fundPot(-5_000, items)).toMatchObject({ spare: 0, shortfall: 630_000 })
  })

  it('handles an empty pot', () => {
    expect(fundPot(12_345, [])).toEqual({ items: [], needed: 0, spare: 12_345, shortfall: 0 })
  })
})

describe('move', () => {
  it('swaps an item with its neighbour', () => {
    expect(move(items, 2, -1)).toEqual(['italy', 'japan', 'cornwall'])
    expect(move(items, 0, 1)).toEqual(['cornwall', 'italy', 'japan'])
  })
  it('does nothing past either end', () => {
    expect(move(items, 0, -1)).toEqual(['italy', 'cornwall', 'japan'])
    expect(move(items, 2, 1)).toEqual(['italy', 'cornwall', 'japan'])
  })
})

describe('nextTarget', () => {
  const items = [
    { id: 'venue', target_minor: 500_000 },
    { id: 'rings', target_minor: 200_000 },
  ]

  it('is the first item not yet funded, with how much of it is covered', () => {
    expect(nextTarget(650_000, items)).toMatchObject({ item: { id: 'rings', funded: 150_000 }, pct: 75 })
    expect(nextTarget(0, items)).toMatchObject({ item: { id: 'venue' }, pct: 0 })
  })

  it('rounds down, so 100% only once it is funded', () => {
    expect(nextTarget(699_999, items).pct).toBe(99)
  })

  it('has no item once everything is funded, or with no items', () => {
    expect(nextTarget(800_000, items)).toEqual({ item: null, pct: 100 })
    expect(nextTarget(100, [])).toEqual({ item: null, pct: 0 })
  })
})
