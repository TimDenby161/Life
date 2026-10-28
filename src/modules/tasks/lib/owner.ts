import type { TaskCategory, TaskList } from '../api'

/**
 * The one person a task (or job) only ever belongs to: the owner of its
 * category, else of its personal list. Null means joint, even when it is
 * assigned to someone.
 */
export function ownerOf(
  task: { category_id: string | null; list_id: string },
  categories: Pick<TaskCategory, 'id' | 'owner_id'>[],
  lists: Pick<TaskList, 'id' | 'kind' | 'owner_id'>[],
): string | null {
  const category = categories.find((c) => c.id === task.category_id)
  if (category?.owner_id) return category.owner_id
  const list = lists.find((l) => l.id === task.list_id)
  return list?.kind === 'personal' ? list.owner_id : null
}
