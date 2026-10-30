import { describe, expect, it } from 'vitest'
import { byScore, delayDaysFor, taskScore, topJobs } from './topJobs'

const today = '2026-10-30'
const categories = [
  { id: 'finance', name: 'Finance' },
  { id: 'spanish', name: 'Spanish' },
  { id: 'general', name: 'General' },
]

function occ(title: string, due_date: string | null, task: Partial<{ priority: string; category_id: string; recurrence: unknown; description: string; importance_votes: number }> = {}) {
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

  it('puts anything due today or overdue ahead of more important tasks due later', () => {
    const items = [
      occ('Renew the car insurance', '2026-10-31', { priority: 'high' }),
      occ('Sort the loft', today),
      occ('Clean the oven', '2026-09-01', { recurrence: { afterDone: true } }),
    ]
    expect(titles(topJobs(items, categories, today))).toEqual(['Sort the loft', 'Clean the oven', 'Renew the car insurance'])
  })

  it('lets a real deadline next week beat a chore due the week after', () => {
    const items = [
      occ('Clean the oven', '2026-11-12', { recurrence: { afterDone: true } }),
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

  it('moves a task up with up-votes and down with down-votes', () => {
    const items = [occ('Pay the bill', today), occ('Sort the loft', today, { importance_votes: 3 }), occ('Call the bank', today, { importance_votes: -2 })]
    expect(titles(topJobs(items, categories, today))).toEqual(['Sort the loft', 'Pay the bill', 'Call the bank'])
  })

  it('keeps tasks due today ahead of a heavily up-voted task due later', () => {
    const items = [occ('Sort the loft', '2026-11-05', { importance_votes: 10 }), occ('Sort the shed', today)]
    expect(titles(topJobs(items, categories, today))[0]).toBe('Sort the shed')
  })

  it('puts a task flagged Urgent first, even ahead of tasks due today', () => {
    const items = [occ('Pay the bill', today), occ('Sort the loft', '2026-11-20', { priority: 'urgent' }), occ('Sort the shed', null)]
    expect(titles(topJobs(items, categories, today))).toEqual(['Sort the loft', 'Pay the bill', 'Sort the shed'])
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

describe('end of the day', () => {
  const daily = { recurrence: { freq: 'daily' } }
  const score = (o: ReturnType<typeof occ>, hour: number) => taskScore(o, categories, today, hour)

  it('leaves a daily task alone until the evening, then climbs each hour', () => {
    const task = occ('Sort the loft', today, daily)
    expect([9, 16, 17, 20, 23].map((h) => score(task, h) - score(task, 9))).toEqual([0, 0, 10, 40, 70])
  })
  it('still counts a daily task left over from yesterday', () => {
    const task = occ('Sort the loft', '2026-10-29', daily)
    expect(score(task, 23) - score(task, 9)).toBe(70)
  })
  it('skips weekly tasks, every-other-day tasks and one-offs, and daily tasks due later', () => {
    const tasks = [
      occ('Sort the loft', today, { recurrence: { freq: 'weekly' } }),
      occ('Sort the loft', today, { recurrence: { freq: 'daily', interval: 2 } }),
      occ('Sort the loft', today),
      occ('Sort the loft', '2026-10-31', daily),
    ]
    for (const task of tasks) expect(score(task, 23)).toBe(score(task, 9))
  })
  it('lets a daily task overtake a bigger task late in the evening', () => {
    const items = [occ('Pay the bill', today), occ('Sort the loft', today, daily)]
    expect(titles(byScore(items, categories, today, 9))[0]).toBe('Pay the bill')
    expect(titles(byScore(items, categories, today, 23))[0]).toBe('Sort the loft')
  })
})

describe('delayDaysFor', () => {
  const after = (delay_count: number, title: string, task = {}) => delayDaysFor({ delay_count, ...occ(title, today, task) }, categories)

  it('backs off a normal task the more it is put off', () => {
    expect([0, 1, 2, 3].map((n) => after(n, 'Find a date for uncle Tim'))).toEqual([1, 2, 4, 7])
  })
  it('keeps something that sounds important or is flagged at one day', () => {
    expect(after(3, 'Renew the passport')).toBe(1)
    expect(after(3, 'Sort the loft', { priority: 'high' })).toBe(1)
    expect(after(3, 'Sort the loft', { priority: 'urgent' })).toBe(1)
  })
  it('lets votes overrule the wording and the flag', () => {
    expect(after(3, 'Sort the loft', { importance_votes: 1 })).toBe(1)
    expect(after(3, 'Renew the passport', { importance_votes: -1 })).toBe(7)
    expect(after(3, 'Sort the loft', { priority: 'high', importance_votes: -1 })).toBe(7)
  })
})
