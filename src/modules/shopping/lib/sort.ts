import { daysBetween, type ISODate } from '@/lib/dates'

type Sortable = { name: string; need_by: string | null; bought_at: string | null; created_at: string }

/**
 * Splits the list into things with a deadline (soonest first), things that are
 * just on the list (oldest first) and what's been bought (latest first).
 */
export function splitWants<T extends Sortable>(rows: T[]) {
  const open = rows.filter((r) => !r.bought_at)
  return {
    dated: open.filter((r) => r.need_by).sort((a, b) => a.need_by!.localeCompare(b.need_by!) || a.name.localeCompare(b.name)),
    whenever: open.filter((r) => !r.need_by).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    bought: rows.filter((r) => r.bought_at).sort((a, b) => b.bought_at!.localeCompare(a.bought_at!)),
  }
}

/** Past its deadline, or due within `soonDays`. */
export function urgency(needBy: ISODate, today: ISODate, soonDays = 7): 'late' | 'soon' | null {
  if (needBy < today) return 'late'
  return daysBetween(today, needBy) <= soonDays ? 'soon' : null
}

type ChecklistItem = { id: string; title: string; is_done: boolean; done_at: string | null; due_date: string | null; created_at: string }

/** A Shoppinglist checklist item in the same shape as a want, so both sort together. */
export function fromChecklist<T extends ChecklistItem>(item: T) {
  return {
    source: 'list' as const,
    id: item.id,
    name: item.title,
    need_by: item.due_date,
    // Ticked before done_at was kept: still bought, just with no time.
    bought_at: item.is_done ? (item.done_at ?? item.created_at) : null,
    created_at: item.created_at,
    item,
  }
}
