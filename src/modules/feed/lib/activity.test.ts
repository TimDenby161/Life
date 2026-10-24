import { groupActivity, groupSummary } from './activity'

const e = (id: string, actor: string, type: string, at: string) => ({ id, actor_id: actor, event_type: type, summary: `${actor} ${type} ${id}`, created_at: at })

describe('groupActivity', () => {
  it('collapses bursts from the same person and keeps others separate', () => {
    const groups = groupActivity([
      e('1', 'tim', 'task.completed', '2026-10-22T10:00:00Z'),
      e('2', 'tim', 'task.completed', '2026-10-22T10:20:00Z'),
      e('3', 'tim', 'task.completed', '2026-10-22T10:45:00Z'),
      e('4', 'sophie', 'task.completed', '2026-10-22T11:00:00Z'),
      e('5', 'tim', 'task.completed', '2026-10-22T18:00:00Z'),
    ])
    expect(groups.map((g) => g.events.map((x) => x.id))).toEqual([['5'], ['4'], ['3', '2', '1']])
    expect(groupSummary(groups[2], 'Tim')).toBe('Tim completed 3 tasks')
    expect(groupSummary(groups[0], 'Tim')).toBe('tim task.completed 5')
  })
  it('does not merge different event types', () => {
    const groups = groupActivity([e('1', 'tim', 'task.created', '2026-10-22T10:00:00Z'), e('2', 'tim', 'task.completed', '2026-10-22T10:01:00Z')])
    expect(groups).toHaveLength(2)
  })
})
