import { describe, expect, it } from 'vitest'
import { waitingChoices, waitingOnTitle } from './waiting'

const open = (task_id: string, title: string, task = {}) => ({ task_id, task: { title, ...task } })

describe('waitingOnTitle', () => {
  const tasks = [open('pots', 'Revolut Pots Joint')]

  it('names the task while it is still open', () => {
    expect(waitingOnTitle({ waiting_on_task_id: 'pots' }, tasks)).toBe('Revolut Pots Joint')
  })
  it('frees the task once the other is done', () => {
    expect(waitingOnTitle({ waiting_on_task_id: 'gone' }, tasks)).toBeNull()
  })
  it('leaves other tasks alone', () => {
    expect(waitingOnTitle({ waiting_on_task_id: null }, tasks)).toBeNull()
    expect(waitingOnTitle({}, tasks)).toBeNull()
  })
})

describe('waitingChoices', () => {
  it('offers open one-offs, not itself, repeating tasks or one waiting on it', () => {
    const tasks = [
      open('me', 'Cancel Revolut'),
      open('pots', 'Revolut Pots Joint'),
      open('bins', 'Bins out', { recurrence: { freq: 'weekly' } }),
      open('after', 'Tell Sophie', { waiting_on_task_id: 'me' }),
      open('a', 'A task'),
    ]
    expect(waitingChoices('me', tasks).map((o) => o.task_id)).toEqual(['a', 'pots'])
  })
})
