import { describe, expect, it } from 'vitest'
import { topJobs } from './topJobs'

const today = '2026-10-30'
const categories = [
  { id: 'finance', name: 'Finance' },
  { id: 'spanish', name: 'Spanish' },
  { id: 'general', name: 'General' },
]

function occ(title: string, due_date: string | null, task: Partial<{ priority: string; category_id: string; recurrence: unknown; description: string }> = {}) {
  return { due_date, due_time: null, task: { title, priority: 'normal', category_id: null, recurrence: null, ...task } }
}
const titles = (items: { task: { title: string } }[]) => items.map((o) => o.task.title)

describe('topJobs', () => {
  it('returns at most five', () => {
    const items = Array.from({ length: 8 }, (_, i) => occ(`Task ${i}`, today))
    expect(topJobs(items, categories, today)).toHaveLength(5)
  })

  it('puts an important-sounding task ahead of a chore due the same day', () => {
    const items = [occ('Wipe the skirting boards', today), occ('Pay the council tax', today)]
    expect(titles(topJobs(items, categories, today))[0]).toBe('Pay the council tax')
  })

  it('puts a task due soon ahead of the same task due later', () => {
    const items = [occ('Book the venue', '2026-11-20'), occ('Book the dentist', '2026-10-31')]
    expect(titles(topJobs(items, categories, today))[0]).toBe('Book the dentist')
  })

  it('lets a real deadline next week beat a long-overdue repeating chore', () => {
    const items = [
      occ('Clean the oven', '2026-09-01', { recurrence: { afterDone: true } }),
      occ('Renew the car insurance', '2026-11-05'),
    ]
    expect(titles(topJobs(items, categories, today))[0]).toBe('Renew the car insurance')
  })

  it('counts the priority flag', () => {
    const items = [occ('Sort the loft', today), occ('Sort the shed', today, { priority: 'urgent' })]
    expect(titles(topJobs(items, categories, today))[0]).toBe('Sort the shed')
  })

  it('reads the category and description as well as the title', () => {
    const items = [
      occ('Look at the numbers', today, { category_id: 'general' }),
      occ('Look at the pension', today, { category_id: 'finance' }),
      occ('Look at the letter', today, { description: 'From the solicitor' }),
    ]
    expect(titles(topJobs(items, categories, today))).toEqual(['Look at the letter', 'Look at the pension', 'Look at the numbers'])
    const lesson = occ('Do ten minutes', today, { category_id: 'spanish' })
    expect(titles(topJobs([lesson, occ('Do the thing', today)], categories, today))[0]).toBe('Do the thing')
  })

  it('does not match words inside other words', () => {
    const items = [occ('Find the notebook and motor', today), occ('Book the plumber', today)]
    expect(titles(topJobs(items, categories, today))[0]).toBe('Book the plumber')
  })

  it('treats something about to expire as important, but not expired food', () => {
    const items = [occ('Remove expired food', today), occ('Railcard expires', today), occ('Sort the loft', today)]
    expect(titles(topJobs(items, categories, today))).toEqual(['Railcard expires', 'Remove expired food', 'Sort the loft'])
  })

  it('keeps a far-off important task behind normal work due today', () => {
    const items = [occ('Pay the annual bill', '2027-02-01'), occ('Sort the loft', today)]
    expect(titles(topJobs(items, categories, today))[0]).toBe('Sort the loft')
  })

  it('still ranks undated tasks, and breaks ties by date then title', () => {
    const items = [occ('Pay Beth back', null), occ('Sort the loft', '2027-02-01')]
    expect(titles(topJobs(items, categories, today))[0]).toBe('Pay Beth back')
    const tied = [occ('B task', today), occ('A task', today)]
    expect(titles(topJobs(tied, categories, today))).toEqual(['A task', 'B task'])
  })
})
