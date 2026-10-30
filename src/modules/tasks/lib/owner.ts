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
