import { addDaysISO, type ISODate } from '@/lib/dates'
import type { TaskCategory } from '../api'

/** Shopping gets done in one trip: anything undated, late or due within `days` belongs together. */
export function splitShopping<T extends { due_date: string | null; task: { category_id: string | null } }>(
  items: T[],
  categories: Pick<TaskCategory, 'id' | 'name'>[],
  today: ISODate,
  days = 4,
) {
  const shoppingId = categories.find((c) => c.name.toLowerCase() === 'shopping')?.id
  const last = addDaysISO(today, days)
  const isShopping = (o: T) => Boolean(shoppingId) && o.task.category_id === shoppingId && (!o.due_date || o.due_date <= last)
  return { shopping: items.filter(isShopping), rest: items.filter((o) => !isShopping(o)) }
}
