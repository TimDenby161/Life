// Wedding totals. Amounts are integer minor units.

type BudgetLike = { category: string; budget_minor: number; paid_minor: number }
type GuestLike = { invite: string; rsvp: string; plus_one: boolean }
type TaskLike = { done: boolean; due_date: string | null }

export type BudgetTotals = { budget: number; paid: number; remaining: number }

export function budgetTotals(items: readonly BudgetLike[]): BudgetTotals {
  const budget = items.reduce((t, i) => t + i.budget_minor, 0)
  const paid = items.reduce((t, i) => t + i.paid_minor, 0)
  return { budget, paid, remaining: Math.max(0, budget - paid) }
}

/** Budget lines grouped by category, biggest category first. */
export function byCategory<T extends BudgetLike>(items: readonly T[]): { category: string; items: T[]; totals: BudgetTotals }[] {
  const groups = new Map<string, T[]>()
  for (const i of items) groups.set(i.category, [...(groups.get(i.category) ?? []), i])
  return [...groups].map(([category, rows]) => ({ category, items: rows, totals: budgetTotals(rows) })).sort((a, b) => b.totals.budget - a.totals.budget)
}

/** People, not invitations: a guest with a plus-one counts as two. */
export function guestCounts(guests: readonly GuestLike[]) {
  const people = (gs: readonly GuestLike[]) => gs.reduce((t, g) => t + (g.plus_one ? 2 : 1), 0)
  return {
    invited: people(guests),
    day: people(guests.filter((g) => g.invite === 'day')),
    evening: people(guests.filter((g) => g.invite === 'evening')),
    coming: people(guests.filter((g) => g.rsvp === 'yes')),
    notComing: people(guests.filter((g) => g.rsvp === 'no')),
    awaiting: people(guests.filter((g) => g.rsvp === 'pending')),
  }
}

export function taskCounts(tasks: readonly TaskLike[], today: string) {
  const open = tasks.filter((t) => !t.done)
  return { done: tasks.length - open.length, open: open.length, overdue: open.filter((t) => t.due_date && t.due_date < today).length }
}
