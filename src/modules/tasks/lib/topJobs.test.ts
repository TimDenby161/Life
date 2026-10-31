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
      occ('Clean the oven', '2026-11-20', { recurrence: { afterDone: true } }),
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
    expect([9, 16, 17, 20, 22, 23].map((h) => score(task, h))).toEqual([25, 25, 35, 70, 100, 100])
  })
  it('gets a low daily task to 100 by 10pm', () => {
    const stretch = occ('Stretch', today, { recurrence: { freq: 'daily', afterDone: true } })
    expect(score(stretch, 22)).toBeGreaterThanOrEqual(100)
  })
  it('holds a daily task due today at 100', () => {
    expect(score(occ('Pay the bill', today, { ...daily, priority: 'urgent' }), 22)).toBe(100)
  })
  it('still counts a daily task left over from yesterday', () => {
    const task = occ('Sort the loft', '2026-10-29', daily)
    expect(score(task, 22)).toBe(101)
  })
  it('puts a daily task left undone past 100, climbing each day', () => {
    const stretch = (due: string) => occ('Stretch', due, { recurrence: { freq: 'daily', afterDone: true } })
    expect(score(stretch('2026-10-29'), 9)).toBe(101)
    expect(score(stretch('2026-10-25'), 9)).toBe(105)
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
    const task = occ('Sort the loft', '2026-11-03', category_id ? { category_id } : {})
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
    const task = occ('Sort the loft', '2026-11-02', { category_id: 'c4' })
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

describe('the morning weigh-in', () => {
  const weighIn = (due: string) => occ('Weigh In', due, { recurrence: { freq: 'daily', afterDone: true } })

  it('tops the list from 7am until it is done', () => {
    const items = [occ('Pay the bill', '2026-10-01', { priority: 'urgent' }), weighIn(today)]
    expect(titles(byScore(items, categories, today, 7))[0]).toBe('Weigh In')
    expect(titles(byScore(items, categories, today, 21))[0]).toBe('Weigh In')
  })
  it('stays hidden before 7am', () => {
    expect(isOutOfHours(weighIn(today).task, categories, 6, today)).toBe(true)
    expect(isOutOfHours(weighIn(today).task, categories, 7, today)).toBe(false)
  })
  it('goes back down once done and next due tomorrow', () => {
    expect(taskScore(weighIn('2026-10-31'), categories, today, 8)).toBeLessThan(100)
  })
})

describe('zero', () => {
  const repeating = { recurrence: { freq: 'monthly', interval: 6 } }
  const done = (due: string, task = {}) => ({ ...occ('Rotate the mattress', due, task), generated_from: 'earlier' })

  it('gives a job just done, or in the first half of its cycle, a score of 0', () => {
    expect(taskScore(done('2027-04-20', repeating), categories, today, 10)).toBe(0)
    expect(taskScore(done('2027-02-01', repeating), categories, today, 10)).toBe(0)
  })
  it('counts a hand-set last done date as done', () => {
    const task = occ('Rotate the mattress', '2027-04-20', { ...repeating, last_done_on: '2026-10-20' } as object)
    expect(taskScore(task, categories, today, 10)).toBe(0)
  })
  it('never scores a job that has never been done at 0', () => {
    expect(taskScore(occ('Rotate the mattress', '2027-04-20', repeating), categories, today, 10)).toBe(1)
  })
  it('never scores a one-off at 0, however far off', () => {
    expect(taskScore(occ('Book the venue', '2028-08-01'), categories, today, 10)).toBe(1)
  })
  it('still orders tasks tied on 1 by date', () => {
    const items = [occ('Book the florist', '2028-08-01'), occ('Book the venue', '2027-01-01')]
    expect(titles(byScore(items, categories, today, 10))[0]).toBe('Book the venue')
  })
  it('never goes below 0', () => {
    const task = done('2027-01-01', { ...repeating, priority: 'low', importance_votes: -9 })
    expect(taskScore(task, categories, today, 10)).toBe(0)
  })
  it('drops a daily task to 0 once done until it next comes due', () => {
    const task = done('2026-10-31', { recurrence: { freq: 'daily', afterDone: true } })
    expect(taskScore(task, categories, today, 10)).toBe(0)
  })
})

describe('the 100 cap', () => {
  const score = (due: string, task = {}) => taskScore(occ('Pay the bill', due, task), categories, today, 10)

  it('holds everything at 100 or below until its date has passed', () => {
    expect(score(today, { priority: 'urgent', importance_votes: 5 })).toBe(100)
    expect(score('2026-10-31', { priority: 'urgent', importance_votes: 5 })).toBe(100)
  })
  it('lets a task past its date go higher, and keep climbing', () => {
    expect(score('2026-10-20')).toBe(140)
    expect(score('2026-08-01')).toBe(220)
  })
  it('still ranks tasks tied at 100 by what sits underneath', () => {
    const items = [occ('Sort the loft', today), occ('Pay the bill', today, { priority: 'urgent' })]
    expect(titles(byScore(items, categories, today, 10))[0]).toBe('Pay the bill')
  })
  it('leaves the climb to a hard deadline or birthday above 100', () => {
    expect(score('2026-12-25', { deadline: today })).toBe(195)
    expect(taskScore(occ('Presents', today), categories, today, 10)).toBe(195)
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
    expect(taskScore(occ('Pay the bill', '2026-11-03'), categories, today, 10)).toBe(90)
  })
  it('settles a distant task at 1, not below', () => {
    expect(['2026-11-20', '2026-12-25', '2027-01-30', '2027-04-30'].map((d) => score(d))).toEqual([4, 1, 1, 1])
  })
  it('puts a nearer task above a distant one, whatever its wording', () => {
    const items = [occ('Confirm timings and final payments with suppliers', '2028-08-01'), occ('Book the venue', '2027-01-01')]
    expect(titles(topJobs(items, categories, today))[0]).toBe('Book the venue')
  })
  it('scores a repeating job on how far through its cycle it is', () => {
    const fourWeekly = { recurrence: { freq: 'weekly', interval: 4 } }
    expect(['2026-11-27', '2026-11-13', '2026-11-06', '2026-10-31', today].map((d) => score(d, fourWeekly))).toEqual([1, 1, 10, 71, 85])
  })
  it('does not let a six-monthly job climb weeks ahead', () => {
    const task = { recurrence: { freq: 'monthly', interval: 6 } }
    expect(score('2027-03-01', task)).toBe(1)
    expect(score('2026-11-19', task)).toBeLessThan(score('2026-11-03'))
  })
  it('counts a longer cycle further along than a short one with the same days left', () => {
    expect(score('2026-11-02', { recurrence: { freq: 'monthly', interval: 2 } })).toBeGreaterThan(score('2026-11-02', { recurrence: { freq: 'weekly' } }))
  })
  it('puts a repeating job past its date over 100', () => {
    expect(score('2026-10-29', { recurrence: { freq: 'weekly' } })).toBe(101)
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
    expect(taskScore(task, categories, today, 10)).toBe(100)
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
