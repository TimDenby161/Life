// Savings pots: one account's balance funds a pot's items in order, each in
// full before the next gets anything. All amounts are integer minor units.

export type PotItem = { id: string; target_minor: number }

export type FundStatus = 'funded' | 'funding' | 'waiting'

export type FundedItem<T extends PotItem> = T & { funded: number; status: FundStatus }

export type FundedPot<T extends PotItem> = {
  items: FundedItem<T>[]
  /** Sum of every item's target. */
  needed: number
  /** Money left after every item is funded. */
  spare: number
  /** How much more the pot needs to fund every item. */
  shortfall: number
}

export function fundPot<T extends PotItem>(balance: number, items: readonly T[]): FundedPot<T> {
  let left = Math.max(0, balance)
  const funded = items.map((item): FundedItem<T> => {
    const amount = Math.min(left, item.target_minor)
    left -= amount
    const status: FundStatus = amount >= item.target_minor ? 'funded' : amount > 0 ? 'funding' : 'waiting'
    return Object.assign({}, item, { funded: amount, status })
  })
  // The first item still short is the one being saved for, even at £0.
  const next = funded.find((i) => i.status !== 'funded')
  if (next) (next as { status: FundStatus }).status = 'funding'
  const needed = items.reduce((t, i) => t + i.target_minor, 0)
  return { items: funded, needed, spare: left, shortfall: Math.max(0, needed - Math.max(0, balance)) }
}

/**
 * The item a pot is saving for now (the first not fully funded) and the whole
 * percentage of it covered, rounded down so 100% only means funded. Null item
 * means every item is funded (or the pot has none).
 */
export function nextTarget<T extends PotItem>(balance: number, items: readonly T[]): { item: FundedItem<T> | null; pct: number } {
  const item = fundPot(balance, items).items.find((i) => i.status !== 'funded') ?? null
  if (!item) return { item, pct: items.length ? 100 : 0 }
  return { item, pct: Math.min(100, Math.floor((item.funded / item.target_minor) * 100)) }
}

/** Moves the item at `index` up (-1) or down (+1); returns ids in the new order. */
export function move<T extends { id: string }>(items: readonly T[], index: number, by: -1 | 1): string[] {
  const ids = items.map((i) => i.id)
  const to = index + by
  if (to < 0 || to >= ids.length) return ids
  ;[ids[index], ids[to]] = [ids[to], ids[index]]
  return ids
}
