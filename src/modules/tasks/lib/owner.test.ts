import { describe, expect, it } from 'vitest'
import { ownerOf } from './owner'

const lists = [
  { id: 'joint', kind: 'joint' as const, owner_id: null },
  { id: 'tim-list', kind: 'personal' as const, owner_id: 'tim' },
]
const categories = [
  { id: 'c4', owner_id: 'tim' },
  { id: 'spanish', owner_id: null },
]

describe('ownerOf', () => {
  it('gives an owned category to its owner, whatever the list', () => {
    expect(ownerOf({ category_id: 'c4', list_id: 'joint' }, categories, lists)).toBe('tim')
  })
  it('gives a personal-list task to the list owner', () => {
    expect(ownerOf({ category_id: 'spanish', list_id: 'tim-list' }, categories, lists)).toBe('tim')
  })
  it('treats a joint-list task in a shared category as joint', () => {
    expect(ownerOf({ category_id: 'spanish', list_id: 'joint' }, categories, lists)).toBeNull()
    expect(ownerOf({ category_id: null, list_id: 'joint' }, categories, lists)).toBeNull()
  })
})
