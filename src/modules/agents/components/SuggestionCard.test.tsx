import { approveLabel } from './SuggestionCard'

describe('approveLabel', () => {
  it('names what approving does', () => {
    expect(approveLabel({ kind: 'x', task_id: null, action: { type: 'create_task', title: 'x', list: 'joint' } })).toBe('Add task')
    expect(approveLabel({ kind: 'x', task_id: null, action: { type: 'create_task', title: 'x', list: 'joint', recurrence: { freq: 'weekly' } } })).toBe('Add job')
    expect(approveLabel({ kind: 'x', task_id: 't', action: { type: 'archive_task' } })).toBe('Archive')
    expect(approveLabel({ kind: 'x', task_id: 't', action: { type: 'move_due_date', due_date: '2030-01-05' } })).toMatch(/^Move to /)
  })

  it('offers to turn an observation into a task, but not one about an existing task', () => {
    expect(approveLabel({ kind: 'x', task_id: null, action: null })).toBe('Add as task')
    expect(approveLabel({ kind: 'x', task_id: 't', action: null })).toBeNull()
    expect(approveLabel({ kind: 'workload', task_id: null, action: null })).toBeNull()
  })
})
