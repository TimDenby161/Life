import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { byScore, delayDaysFor, isOutOfHours, subtaskScore, taskScore, topJobs } from './topJobs'

const today = '2026-10-30'
const categories = [
  { id: 'finance', name: 'Finance' },
  { id: 'spanish', name: 'Spanish' },
  { id: 'general', name: 'General' },
  { id: 'c4', name: 'C4 Logistics' },
  { id: 'cleaning', name: 'Cleaning' },
  { id: 'other', name: 'Other' },
]

// The score moves with the time of day, so pin these to a quiet morning hour.
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-30T10:00:00'))
})
afterAll(() => {
  vi.useRealTimers()
})

function occ(title: string, due_date: string | null, task: Partial<{ priority: string; category_id: string; recurrence: unknown; description: string; importance_votes: number; deadline: string }> = {}) {
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

  it('orders purely by score, whatever the date', () => {
    const items = [
      occ('Renew the car insurance', '2026-10-31', { priority: 'high' }),
      occ('Sort the loft', today),
      occ('Clean the oven', '2026-09-01', { recurrence: { afterDone: true } }),
    ]
    expect(titles(topJobs(items, categories, today))).toEqual(['Renew the car insurance', 'Sort the loft', 'Clean the oven'])
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
    const tomorrow = '2026-10-31'
    const lesson = occ('Do ten minutes', tomorrow, { category_id: 'spanish' })
    expect(titles(topJobs([lesson, occ('Do the thing', tomorrow)], categories, today))[0]).toBe('Do the thing')
  })

  it('moves a task up with up-votes and down with down-votes', () => {
    const items = [occ('Pay the bill', today), occ('Sort the loft', today, { importance_votes: 4 }), occ('Call the bank', today, { importance_votes: -2 })]
    expect(titles(topJobs(items, categories, today))).toEqual(['Sort the loft', 'Pay the bill', 'Call the bank'])
  })

  it('lets enough up-votes lift a task due later above one due today', () => {
    const items = [occ('Sort the loft', '2026-11-05', { importance_votes: 7 }), occ('Sort the shed', today)]
    expect(titles(topJobs(items, categories, today))[0]).toBe('Sort the loft')
  })

  it('counts Urgent as points, not a place at the top', () => {
    const items = [occ('Pay the bill', today), occ('Sort the loft', '2026-11-20', { priority: 'urgent' })]
    expect(titles(topJobs(items, categories, today))).toEqual(['Pay the bill', 'Sort the loft'])
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
    expect([9, 16, 17, 20, 22, 23].map((h) => score(task, h))).toEqual([25, 25, 35, 70, 100, 115])
  })
  it('gets a low daily task to 100 by 10pm', () => {
    const stretch = occ('Stretch', today, { recurrence: { freq: 'daily', afterDone: true } })
    expect(score(stretch, 22)).toBeGreaterThanOrEqual(100)
  })
  it('keeps a daily task that is already over the minimum', () => {
    expect(score(occ('Pay the bill', today, { ...daily, priority: 'urgent' }), 22)).toBe(165)
  })
  it('still counts a daily task left over from yesterday', () => {
    const task = occ('Sort the loft', '2026-10-29', daily)
    expect(score(task, 22)).toBe(100)
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
    const items = [occ('Fix the shed', today, { recurrence: { freq: 'weekly' } }), occ('Sort the loft', today, daily)]
    expect(titles(byScore(items, categories, today, 9))[0]).toBe('Fix the shed')
    expect(titles(byScore(items, categories, today, 23))[0]).toBe('Sort the loft')
  })
})

describe('time of day', () => {
  const gain = (category_id: string | null, hour: number) => {
    const task = occ('Sort the loft', today, category_id ? { category_id } : {})
    return taskScore(task, categories, today, hour) - taskScore(task, categories, today, 3)
  }

  it('raises work jobs from 8am until 5pm', () => {
    expect([7, 8, 16, 17].map((h) => gain('c4', h))).toEqual([0, 40, 40, 0])
  })
  it('raises cleaning, other and uncategorised jobs from 12 until 2pm', () => {
    expect([11, 12, 13, 14].map((h) => gain('cleaning', h))).toEqual([0, 30, 30, 0])
    expect(gain('other', 13)).toBe(30)
    expect(gain(null, 13)).toBe(30)
  })
  it('leaves other categories alone', () => {
    expect([9, 13].map((h) => gain('general', h))).toEqual([0, 0])
  })
  it('hides work jobs at the weekend, without the work boost', () => {
    const task = occ('Sort the loft', today, { category_id: 'c4' })
    const saturday = '2026-10-31'
    const sunday = '2026-11-01'
    expect(isOutOfHours(task.task, categories, 10, saturday)).toBe(true)
    expect(isOutOfHours(task.task, categories, 10, sunday)).toBe(true)
    expect(isOutOfHours(task.task, categories, 10, '2026-11-02')).toBe(false)
    expect(taskScore(task, categories, saturday, 10)).toBeLessThan(taskScore(task, categories, today, 10))
  })
  it('hides work jobs outside work hours only', () => {
    const task = (category_id: string) => occ('Sort the loft', today, { category_id }).task
    expect([7, 8, 16, 17, 23].map((h) => isOutOfHours(task('c4'), categories, h, today))).toEqual([true, false, false, true, true])
    expect(isOutOfHours(task('cleaning'), categories, 23)).toBe(false)
  })
})

describe('ties', () => {
  it('puts whatever has been waiting longest first', () => {
    const items = [
      { ...occ('A newer task', today), created_at: '2026-10-29T10:00:00Z' },
      { ...occ('Z older task', today), created_at: '2026-10-20T10:00:00Z' },
    ]
    expect(titles(byScore(items, categories, today, 10))).toEqual(['Z older task', 'A newer task'])
  })
})

describe('due dates', () => {
  const score = (due: string, task = {}) => taskScore(occ('Sort the loft', due, task), categories, today, 10)

  it('brings a one-off task to 100 on its due date, after a week of climbing', () => {
    const days = ['2026-11-06', '2026-11-03', '2026-10-31', today]
    expect(days.map((d) => score(d))).toEqual([30, 60, 90, 100])
  })
  it('keeps climbing a little once overdue', () => {
    expect(score('2026-10-20')).toBe(110)
  })
  it('never lets a one-off fall below 100 on the day', () => {
    expect(score(today, { importance_votes: -3 })).toBe(100)
    expect(taskScore(occ('Wipe the sink', today), categories, today, 10)).toBe(100)
  })
  it('adds importance on top', () => {
    expect(taskScore(occ('Pay the bill', today), categories, today, 10)).toBe(130)
  })
  it('lowers a task the further off it is', () => {
    expect(['2026-11-20', '2026-12-25', '2027-01-30', '2027-04-30'].map((d) => score(d))).toEqual([4, -20, -30, -45])
  })
  it('puts a nearer task above a distant one, whatever its wording', () => {
    const items = [occ('Confirm timings and final payments with suppliers', '2028-08-01'), occ('Book the venue', '2027-01-01')]
    expect(titles(topJobs(items, categories, today))[0]).toBe('Book the venue')
  })
  it('scores a repeating job on how far through its cycle it is', () => {
    const everyThreeWeeks = { recurrence: { freq: 'weekly', interval: 3 } }
    expect(['2026-11-20', '2026-11-09', '2026-10-31', today, '2026-10-20'].map((d) => score(d, everyThreeWeeks))).toEqual([-11, 14, 78, 85, 95])
  })
  it('does not let a six-monthly job climb weeks ahead', () => {
    expect(score('2026-11-19', { recurrence: { freq: 'monthly', interval: 6 } })).toBe(-11)
  })
  it('counts a longer cycle further along than a short one with the same days left', () => {
    expect(score('2026-11-02', { recurrence: { freq: 'monthly', interval: 2 } })).toBeGreaterThan(score('2026-11-02', { recurrence: { freq: 'weekly' } }))
  })
  it('still puts a one-off due today above a repeating job due today', () => {
    expect(score(today)).toBeGreaterThan(score(today, { recurrence: { freq: 'weekly' } }))
  })
})

describe('hard deadlines', () => {
  const score = (deadline: string, due: string | null = '2026-12-25') => taskScore(occ('Sort the loft', due, { deadline }), categories, today, 10)

  it('climbs towards 200 over the last week', () => {
    const days = ['2026-11-06', '2026-11-03', '2026-10-31', today]
    expect(days.map((d) => score(d))).toEqual([55, 115, 175, 195])
  })
  it('passes 195 once missed', () => {
    expect(score('2026-10-29')).toBe(200)
  })
  it('does nothing earlier than that', () => {
    const plain = taskScore(occ('Sort the loft', '2026-12-25'), categories, today, 10)
    expect(score('2026-11-07')).toBe(plain)
  })
  it('never lowers a score that is already higher', () => {
    const task = occ('Pay the bill', today, { priority: 'urgent', deadline: '2026-11-06' })
    expect(taskScore(task, categories, today, 10)).toBe(180)
  })
  it('ignores a due date delayed past the deadline', () => {
    expect(score(today, '2026-11-20')).toBe(195)
  })
  it('keeps delays to one day', () => {
    expect(delayDaysFor({ delay_count: 3, ...occ('Sort the loft', today, { deadline: '2026-11-28' }) }, categories)).toBe(1)
  })
})

describe('birthdays', () => {
  const score = (title: string, due: string, task = {}) => taskScore(occ(title, due, task), categories, today, 10)

  it('sits around 100 a week out and climbs to 195 on the day', () => {
    const days = ['2026-11-06', '2026-11-03', '2026-10-31', today]
    expect(days.map((d) => score('Buy birthday present for Mum', d))).toEqual([97, 139, 181, 195])
  })
  it('counts presents and gifts too', () => {
    expect(score('Presents', '2026-11-06')).toBe(97)
    expect(score('Gift for Toby', '2026-11-06')).toBe(97)
  })
  it('climbs gradually from two weeks out', () => {
    expect(score('Presents', '2026-11-07')).toBe(83)
    expect(score('Presents', '2026-11-10')).toBe(41)
  })
  it('does nothing earlier than two weeks out', () => {
    expect(score('Buy birthday present for Mum', '2026-11-20')).toBe(score('Sort the loft', '2026-11-20') + 15)
  })
  it('uses the deadline when there is one', () => {
    expect(score('Presents', '2026-12-25', { deadline: '2026-11-06' })).toBe(97)
  })
  it('leaves other deadlines climbing from lower down', () => {
    expect(score('Sort the loft', '2026-12-25', { deadline: '2026-11-06' })).toBe(55)
  })
})

describe('subtasks', () => {
  const sub = (due_date: string | null, is_done = false) => ({ is_done, due_date })
  const presents = (subtasks: ReturnType<typeof sub>[]) => ({ ...occ('Presents', '2026-11-20'), task: { ...occ('Presents', '2026-11-20').task, subtasks } })
  const score = (subtasks: ReturnType<typeof sub>[]) => taskScore(presents(subtasks), categories, today, 10)

  it('scores each subtask on its own date', () => {
    const task = presents([])
    expect(subtaskScore(task, sub(today), categories, today, 10)).toBe(195)
    expect(subtaskScore(task, sub('2026-11-06'), categories, today, 10)).toBe(97)
  })
  it('falls back to the task date without one', () => {
    expect(subtaskScore(presents([]), sub(null), categories, today, 10)).toBe(taskScore(presents([]), categories, today, 10))
  })
  it('gives the task the highest subtask score, not a total', () => {
    expect(score([sub(today), sub('2026-11-06'), sub('2026-11-06')])).toBe(195)
  })
  it('drops to the next one once the highest is ticked', () => {
    expect(score([sub(today, true), sub('2026-11-06'), sub('2026-11-03')])).toBe(139)
  })
  it('holds subtasks back once the task has been delayed', () => {
    const task = { ...presents([sub(today)]), delay_count: 1, due_date: '2026-11-06' }
    expect(taskScore(task, categories, today, 10)).toBe(97)
  })
  it('keeps a later subtask date after a delay', () => {
    const task = { ...presents([sub('2026-11-06')]), delay_count: 1, due_date: '2026-10-31' }
    expect(taskScore(task, categories, today, 10)).toBe(97)
  })
  it('goes back to its own score when every subtask is done', () => {
    expect(score([sub(today, true)])).toBe(taskScore(presents([]), categories, today, 10))
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
