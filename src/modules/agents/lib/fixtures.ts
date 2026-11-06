// Test data for the agent rules: a two-person household with made-up names.
import type { CompletionEvent, OpenTask, TaskContext } from '../../../../supabase/functions/_shared/agents/types.ts'

export const ALEX = 'a0000000-0000-0000-0000-000000000001'
export const SAM = 'b0000000-0000-0000-0000-000000000002'
export const JOINT_LIST = 'l-joint'
export const ALEX_LIST = 'l-alex'
export const SAM_LIST = 'l-sam'
export const WORK = 'c-work'
export const CLEANING = 'c-cleaning'

let n = 0

export function task(fields: Partial<OpenTask> = {}): OpenTask {
  n++
  return {
    occurrence_id: `o${n}`,
    task_id: `t${n}`,
    title: `Task ${n}`,
    list_id: JOINT_LIST,
    category_id: null,
    needs_both: false,
    priority: 'normal',
    importance_votes: 0,
    recurrence: null,
    due_date: null,
    due_time: null,
    deadline: null,
    delay_count: 0,
    waiting_on_task_id: null,
    created_by: ALEX,
    created_at: '2026-11-01T09:00:00Z',
    ...fields,
  }
}

export function done(title: string, date: string, by = ALEX, fields: Partial<CompletionEvent> = {}): CompletionEvent {
  n++
  return {
    occurrence_id: `done${n}`,
    task_id: `dt${n}`,
    event_type: 'completed',
    completed_by: by,
    also_completed_by: null,
    occurred_at: `${date}T10:00:00Z`,
    recorded_at: `${date}T10:00:00Z`,
    task_title: title,
    list_id: JOINT_LIST,
    category_id: null,
    category_name: null,
    is_recurring: false,
    ...fields,
  }
}

/** Friday 6 November 2026, 9am. */
export function context(fields: Partial<TaskContext> = {}): TaskContext {
  return {
    today: '2026-11-06',
    hour: 9,
    members: [
      { id: ALEX, name: 'Alex' },
      { id: SAM, name: 'Sam' },
    ],
    lists: [
      { id: JOINT_LIST, kind: 'joint', owner_id: null },
      { id: ALEX_LIST, kind: 'personal', owner_id: ALEX },
      { id: SAM_LIST, kind: 'personal', owner_id: SAM },
    ],
    categories: [
      { id: WORK, name: 'C4 Logistic', owner_id: ALEX },
      { id: CLEANING, name: 'Cleaning', owner_id: null },
    ],
    open: [],
    events: [],
    ...fields,
  }
}

export const BOTH = [ALEX, SAM]
