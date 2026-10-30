import { describe, expect, it } from 'vitest'
import { assignedTo, assignPatch, inView, JOINT, ownerOf, TOGETHER } from './owner'

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

describe('inView', () => {
  const see = (task: { category_id: string | null; list_id: string; needs_both?: boolean }) =>
    ['tim', 'sophie', TOGETHER].filter((view) => inView(task, view, categories, lists))

  it('shows a task only one of us does to that person', () => {
    expect(see({ category_id: 'c4', list_id: 'joint' })).toEqual(['tim'])
    expect(see({ category_id: null, list_id: 'tim-list' })).toEqual(['tim'])
  })
  it('shows a shared task to whichever of us could do it', () => {
    expect(see({ category_id: 'spanish', list_id: 'joint' })).toEqual(['tim', 'sophie'])
  })
  it('keeps a task that takes both of us on Together alone', () => {
    expect(see({ category_id: 'spanish', list_id: 'joint', needs_both: true })).toEqual([TOGETHER])
  })
})

describe('assignedTo', () => {
  it('reads a task back as a person, Together or Joint', () => {
    expect(assignedTo({ category_id: 'spanish', list_id: 'joint' }, categories, lists)).toBe(JOINT)
    expect(assignedTo({ category_id: 'spanish', list_id: 'joint', needs_both: true }, categories, lists)).toBe(TOGETHER)
    expect(assignedTo({ category_id: 'c4', list_id: 'joint' }, categories, lists)).toBe('tim')
  })
})

describe('assignPatch', () => {
  const allLists = [...lists, { id: 'sophie-list', kind: 'personal' as const, owner_id: 'sophie' }]
  const shared = { category_id: 'spanish' }

  it('puts a task on a person\'s own list', () => {
    expect(assignPatch('sophie', shared, categories, allLists)).toEqual({ list_id: 'sophie-list', assignee_id: 'sophie', needs_both: false })
  })
  it('puts Joint on the shared list, showing on both tabs but not Together', () => {
    const patch = assignPatch(JOINT, shared, categories, allLists)
    expect(patch).toEqual({ list_id: 'joint', assignee_id: null, needs_both: false })
    const task = { ...shared, list_id: patch.list_id!, needs_both: patch.needs_both }
    expect(['tim', 'sophie', TOGETHER].filter((v) => inView(task, v, categories, allLists))).toEqual(['tim', 'sophie'])
  })
  it('puts Together on the shared list, marked as taking both', () => {
    expect(assignPatch(TOGETHER, shared, categories, allLists)).toEqual({ list_id: 'joint', assignee_id: null, needs_both: true })
  })
  it('drops a category owned by someone else, but keeps the person\'s own', () => {
    expect(assignPatch('sophie', { category_id: 'c4' }, categories, allLists).category_id).toBeNull()
    expect(assignPatch(JOINT, { category_id: 'c4' }, categories, allLists).category_id).toBeNull()
    expect(assignPatch('tim', { category_id: 'c4' }, categories, allLists)).not.toHaveProperty('category_id')
  })
})
