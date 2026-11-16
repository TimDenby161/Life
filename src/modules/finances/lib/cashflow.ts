// Cashflow: the regular money in and out, as monthly amounts. Pure; amounts are
// integer minor units. A yearly amount counts as a twelfth a month.

export type CashflowLike = { direction: string; amount_minor: number; every: string }

/** What an item comes to a month. */
export const perMonth = (item: Pick<CashflowLike, 'amount_minor' | 'every'>): number =>
  item.every === 'year' ? Math.round(item.amount_minor / 12) : item.amount_minor

export type CashflowTotals = { in: number; out: number; left: number }

export function cashflowTotals(items: readonly CashflowLike[]): CashflowTotals {
  let inn = 0
  let out = 0
  for (const i of items) {
    if (i.direction === 'in') inn += perMonth(i)
    else out += perMonth(i)
  }
  return { in: inn, out, left: inn - out }
}
