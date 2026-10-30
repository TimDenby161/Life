import { describe, expect, it } from 'vitest'
import { splitShopping } from './shopping'

const today = '2026-10-30'
const categories = [
  { id: 'shop', name: 'Shopping' },
  { id: 'clean', name: 'Cleaning' },
]
const occ = (id: string, due_date: string | null, category_id: string | null = 'shop') => ({ id, due_date, task: { category_id } })
const ids = (items: { id: string }[]) => items.map((o) => o.id)

describe('splitShopping', () => {
  it('groups overdue, undated and soon-due shopping, whichever day it falls on', () => {
    const items = [occ('late', '2026-10-20'), occ('today', today), occ('sunday', '2026-11-01'), occ('tuesday', '2026-11-03'), occ('undated', null)]
    expect(ids(splitShopping(items, categories, today).shopping)).toEqual(['late', 'today', 'sunday', 'tuesday', 'undated'])
  })
  it('leaves shopping further off, and everything else, in the days', () => {
    const { shopping, rest } = splitShopping([occ('later', '2026-11-04'), occ('mop', today, 'clean'), occ('none', today, null)], categories, today)
    expect(shopping).toEqual([])
    expect(ids(rest)).toEqual(['later', 'mop', 'none'])
  })
  it('does nothing without a Shopping category', () => {
    const { shopping, rest } = splitShopping([occ('a', today, null)], [], today)
    expect(shopping).toEqual([])
    expect(ids(rest)).toEqual(['a'])
  })
})
