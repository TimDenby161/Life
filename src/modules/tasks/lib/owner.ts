import type { TaskCategory, TaskList } from '../api'

/**
 * The one person a task (or job) only ever belongs to: the owner of its
 * category, else of its personal list. Null means joint, even when it is
 * assigned to someone.
 */
export function ownerOf(
  task: { category_id: string | null; list_id: string | null },
  categories: Pick<TaskCategory, 'id' | 'owner_id'>[],
  lists: Pick<TaskList, 'id' | 'kind' | 'owner_id'>[],
): string | null {
  const category = categories.find((c) => c.id === task.category_id)
  if (category?.owner_id) return category.owner_id
  const list = lists.find((l) => l.id === task.list_id)
  return list?.kind === 'personal' ? list.owner_id : null
}

export const TOGETHER = 'together'
export const JOINT = 'joint'

/**
 * The three ways of looking at tasks: what one person could do (theirs, plus
 * shared tasks that don't take both of us), or TOGETHER for what takes both.
 */
export function inView(
  task: { category_id: string | null; list_id: string | null; needs_both?: boolean },
  view: string,
  categories: Pick<TaskCategory, 'id' | 'owner_id'>[],
  lists: Pick<TaskList, 'id' | 'kind' | 'owner_id'>[],
) {
  if (task.needs_both) return view === TOGETHER
  const owner = ownerOf(task, categories, lists)
  return view !== TOGETHER && (owner === null || owner === view)
}

/** Who a task is assigned to: a person, TOGETHER, or JOINT for either of us. */
export function assignedTo(
  task: { category_id: string | null; list_id: string | null; needs_both?: boolean },
  categories: Pick<TaskCategory, 'id' | 'owner_id'>[],
  lists: Pick<TaskList, 'id' | 'kind' | 'owner_id'>[],
) {
  return task.needs_both ? TOGETHER : (ownerOf(task, categories, lists) ?? JOINT)
}

/** The task changes that assign it. A category owned by someone else would pull it back, so that goes. */
export function assignPatch(
  assignment: string,
  task: { category_id: string | null },
  categories: Pick<TaskCategory, 'id' | 'owner_id'>[],
  lists: Pick<TaskList, 'id' | 'kind' | 'owner_id'>[],
) {
  const shared = assignment === JOINT || assignment === TOGETHER
  const list = lists.find((l) => (shared ? l.kind === 'joint' : l.kind === 'personal' && l.owner_id === assignment))
  const owner = categories.find((c) => c.id === task.category_id)?.owner_id
  return {
    list_id: list?.id,
    assignee_id: shared ? null : assignment,
    needs_both: assignment === TOGETHER,
    ...(owner && owner !== assignment ? { category_id: null } : {}),
  }
}
