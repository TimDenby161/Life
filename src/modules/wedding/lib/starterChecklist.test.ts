import { missingStarterTasks, STARTER_CHECKLIST } from './starterChecklist'

describe('starter checklist', () => {
  it('dates each task back from the wedding', () => {
    const tasks = missingStarterTasks([], '2028-09-16', '2026-10-01')
    expect(tasks).toHaveLength(STARTER_CHECKLIST.length)
    expect(tasks[0]).toEqual({ title: 'Agree the overall budget', due_date: '2026-10-16' })
    expect(tasks.find((t) => t.title === 'Give notice of marriage at the register office')?.due_date).toBe('2028-05-16')
  })

  it('moves dates already past to today', () => {
    const tasks = missingStarterTasks([], '2028-09-01', '2026-10-27')
    expect(tasks[0].due_date).toBe('2026-10-27')
    expect(tasks.find((t) => t.title === 'Shortlist and visit venues')?.due_date).toBe('2026-12-01')
  })

  it('skips tasks already on the checklist', () => {
    expect(missingStarterTasks([{ title: 'book the venue' }], '2028-09-01', '2026-10-01').some((t) => t.title === 'Book the venue')).toBe(false)
  })
})
