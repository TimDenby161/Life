import type { ISODate } from '@/lib/dates'
import { supabase, type Tables, type TablesInsert, type TablesUpdate } from '@/lib/supabase'
import { fetchAllPages, unwrap } from '@/lib/utils'

export type TaskList = Tables<'task_lists'>
export type TaskCategory = Tables<'task_categories'>
export type TaskRoom = Tables<'task_rooms'>
export type Task = Tables<'tasks'>
export type TaskOccurrence = Tables<'task_occurrences'>
export type CompletionEvent = Tables<'task_completion_events'>
export type Priority = 'low' | 'normal' | 'high' | 'urgent'

const OCCURRENCE_WITH_TASK = '*, task:tasks!inner(*, subtasks:task_subtasks(id, is_done))'

export type OccurrenceWithTask = Awaited<ReturnType<typeof fetchOpenOccurrences>>[number]

export const taskKeys = {
  all: ['tasks'] as const,
  lists: ['tasks', 'lists'] as const,
  categories: ['tasks', 'categories'] as const,
  rooms: ['tasks', 'rooms'] as const,
  open: ['tasks', 'open'] as const,
  done: ['tasks', 'done'] as const,
  detail: (taskId: string) => ['tasks', 'detail', taskId] as const,
  events: ['tasks', 'events'] as const,
  statsOccurrences: ['tasks', 'stats-occurrences'] as const,
  jobs: ['tasks', 'jobs'] as const,
}

export async function fetchTaskLists() {
  return unwrap(await supabase.from('task_lists').select('*').order('sort_order'))
}

export async function fetchTaskCategories() {
  return unwrap(await supabase.from('task_categories').select('*').order('name'))
}

export async function fetchTaskRooms() {
  return unwrap(await supabase.from('task_rooms').select('*').order('sort_order').order('name'))
}

export async function createRoom(householdId: string, name: string, sortOrder: number) {
  return unwrap(await supabase.from('task_rooms').insert({ household_id: householdId, name, sort_order: sortOrder }).select('*').single())
}

export async function fetchOpenOccurrences() {
  return unwrap(
    await supabase
      .from('task_occurrences')
      .select(OCCURRENCE_WITH_TASK)
      .eq('status', 'open')
      .is('task.archived_at', null)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('due_time', { ascending: true, nullsFirst: true })
      .limit(1000),
  )
}

export async function fetchRecentlyDone(sinceISO: string) {
  return unwrap(
    await supabase
      .from('task_occurrences')
      .select(OCCURRENCE_WITH_TASK)
      .eq('status', 'done')
      .gte('completed_at', sinceISO)
      .is('task.archived_at', null)
      .order('completed_at', { ascending: false })
      .limit(100),
  )
}

export async function fetchTaskDetail(taskId: string) {
  const [task, subtasks, comments, events, open] = await Promise.all([
    supabase.from('tasks').select('*').eq('id', taskId).maybeSingle(),
    supabase.from('task_subtasks').select('*').eq('task_id', taskId).order('sort_order').order('created_at'),
    supabase.from('task_comments').select('*').eq('task_id', taskId).order('created_at'),
    supabase
      .from('task_completion_events')
      .select('*')
      .eq('task_id', taskId)
      .order('recorded_at', { ascending: false })
      .limit(50),
    supabase.from('task_occurrences').select('*').eq('task_id', taskId).eq('status', 'open').maybeSingle(),
  ])
  return {
    task: unwrap(task),
    subtasks: unwrap(subtasks),
    comments: unwrap(comments),
    events: unwrap(events),
    openOccurrence: open.error ? null : open.data,
  }
}

export async function fetchCompletionEvents() {
  return fetchAllPages<CompletionEvent>((from, to) =>
    supabase.from('task_completion_events').select('*').order('recorded_at').order('id').range(from, to),
  )
}

export type StatsOccurrence = Awaited<ReturnType<typeof fetchStatsOccurrences>>[number]

/** Occurrences relevant to statistics: everything due since `from`, plus all open work. */
export async function fetchStatsOccurrences(from: ISODate) {
  const select =
    'id, task_id, due_date, status, assignee_id, completed_by, completed_at, created_at, task:tasks!inner(title, category_id, list_id, recurrence, archived_at)'
  return fetchAllPages((a, b) =>
    supabase.from('task_occurrences').select(select).or(`due_date.gte.${from},status.eq.open`).order('id').range(a, b),
  )
}

export type Job = Awaited<ReturnType<typeof fetchJobs>>[number]

/** Jobs with their open occurrence and latest completion. */
export async function fetchJobs() {
  return unwrap(
    await supabase
      .from('tasks')
      .select('*, open:task_occurrences(id, due_date, assignee_id), done:task_occurrences(completed_at, completed_by)')
      .eq('recurrence->>afterDone', 'true')
      .is('archived_at', null)
      .eq('open.status', 'open')
      .eq('done.status', 'done')
      .order('completed_at', { referencedTable: 'done', ascending: false })
      .limit(1, { referencedTable: 'done' })
      .order('title'),
  )
}

export type TaskInput = Pick<
  TablesInsert<'tasks'>,
  | 'list_id'
  | 'title'
  | 'description'
  | 'assignee_id'
  | 'category_id'
  | 'priority'
  | 'due_date'
  | 'due_time'
  | 'recurrence'
  | 'last_done_on'
  | 'room_id'
>

export async function createTask(householdId: string, input: TaskInput) {
  return unwrap(
    await supabase
      .from('tasks')
      .insert({ ...input, household_id: householdId })
      .select('*')
      .single(),
  )
}

export async function updateTask(id: string, patch: TablesUpdate<'tasks'>) {
  return unwrap(await supabase.from('tasks').update(patch).eq('id', id).select('*').single())
}

export async function deleteTask(id: string) {
  unwrap(await supabase.from('tasks').delete().eq('id', id))
}

export async function completeOccurrence(args: { occurrenceId: string; completedBy?: string; note?: string }) {
  return unwrap(
    await supabase.rpc('complete_task_occurrence', {
      p_occurrence_id: args.occurrenceId,
      p_completed_by: args.completedBy,
      p_note: args.note,
    }),
  )
}

export async function skipOccurrence(occurrenceId: string) {
  return unwrap(await supabase.rpc('skip_task_occurrence', { p_occurrence_id: occurrenceId }))
}

export async function reopenOccurrence(occurrenceId: string) {
  return unwrap(await supabase.rpc('reopen_task_occurrence', { p_occurrence_id: occurrenceId }))
}

/** Credits a completed occurrence to someone else, or to two people (recorded as a new history event). */
export async function setCompletedBy(occurrenceId: string, personId: string, alsoPersonId: string | null) {
  return unwrap(
    await supabase.rpc('set_task_occurrence_completed_by', {
      p_occurrence_id: occurrenceId,
      p_completed_by: personId,
      p_also_completed_by: alsoPersonId ?? undefined,
    }),
  )
}

/** Reschedules a single occurrence (e.g. bins moved for a bank holiday). */
export async function moveOccurrence(id: string, dueDate: string) {
  unwrap(await supabase.from('task_occurrences').update({ due_date: dueDate }).eq('id', id))
}

export async function addSubtask(householdId: string, taskId: string, title: string, sortOrder: number) {
  unwrap(await supabase.from('task_subtasks').insert({ household_id: householdId, task_id: taskId, title, sort_order: sortOrder }))
}

export async function setSubtaskDone(id: string, isDone: boolean) {
  unwrap(await supabase.from('task_subtasks').update({ is_done: isDone }).eq('id', id))
}

export async function deleteSubtask(id: string) {
  unwrap(await supabase.from('task_subtasks').delete().eq('id', id))
}

export async function addComment(householdId: string, taskId: string, body: string) {
  unwrap(await supabase.from('task_comments').insert({ household_id: householdId, task_id: taskId, body }))
}

export async function deleteComment(id: string) {
  unwrap(await supabase.from('task_comments').delete().eq('id', id))
}

export async function createCategory(householdId: string, name: string, color: string) {
  return unwrap(await supabase.from('task_categories').insert({ household_id: householdId, name, color }).select('*').single())
}

/** Its tasks stay, without a category. */
export async function deleteCategory(id: string) {
  unwrap(await supabase.from('task_categories').delete().eq('id', id))
}

/** Its jobs stay, without a room. */
export async function deleteRoom(id: string) {
  unwrap(await supabase.from('task_rooms').delete().eq('id', id))
}

/** The database reassigns the category's tasks to a new owner. */
export async function setCategoryOwner(id: string, ownerId: string | null) {
  unwrap(await supabase.from('task_categories').update({ owner_id: ownerId }).eq('id', id))
}
