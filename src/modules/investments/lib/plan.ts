// Turns holdings and settings into a list of trades. Amounts are pence.
//
// * Holdings marked "sell" are sold in full.
// * The wedding amount is set aside as cash (less any cash already held).
// * Everything else with a target is the long-term mix: the money left over
//   is shared out by target, and each holding is bought or trimmed to match.
// * Until the wedding amount is decided, holdings with a 0% target are left
//   alone, since they are where the wedding cash would come from.

export type PlanHolding = {
  ticker: string
  name: string
  asset_class: string
  value_minor: number
  target_pct: number | null
  action: string
  reason: string | null
}

export type PlanSettings = { monthly_minor: number; wedding_minor: number | null }

export type Step =
  | { kind: 'sell' | 'trim' | 'buy'; ticker: string; amount: number; reason?: string | null }
  | { kind: 'cash'; amount: number }
  | { kind: 'review'; ticker: string; reason: string | null }
  | { kind: 'wedding-unset' }
  | { kind: 'targets'; total: number }

/** Trades smaller than this aren't worth the bother. */
export const MIN_TRADE = 2500

const pounds = (minor: number) => Math.round(minor / 100) * 100

export function mix(holdings: PlanHolding[]) {
  const by = (c: string) => holdings.filter((h) => h.asset_class === c).reduce((s, h) => s + h.value_minor, 0)
  const total = holdings.reduce((s, h) => s + h.value_minor, 0)
  return { total, shares: by('shares'), bonds: by('bonds'), cash: by('cash') }
}

export function plan(holdings: PlanHolding[], settings: PlanSettings) {
  const steps: Step[] = []
  const sells = holdings.filter((h) => h.action === 'sell' && h.value_minor > 0)
  const core = holdings.filter((h) => h.action !== 'sell' && h.target_pct !== null)
  const targetTotal = core.reduce((s, h) => s + h.target_pct!, 0)
  if (core.length && targetTotal !== 100) steps.push({ kind: 'targets', total: targetTotal })

  const weddingSet = settings.wedding_minor !== null
  if (!weddingSet) steps.push({ kind: 'wedding-unset' })
  const active = core.filter((h) => weddingSet || h.target_pct! > 0)
  const activeTotal = active.reduce((s, h) => s + h.target_pct!, 0)

  const proceeds = sells.reduce((s, h) => s + h.value_minor, 0)
  const available = active.reduce((s, h) => s + h.value_minor, 0) + proceeds
  const cashHeld = holdings.filter((h) => h.asset_class === 'cash' && h.action !== 'sell').reduce((s, h) => s + h.value_minor, 0)
  const cashNeeded = weddingSet ? Math.min(available, Math.max(0, settings.wedding_minor! - cashHeld)) : 0
  const pool = available - cashNeeded

  const trades = active.map((h) => ({
    h,
    delta: pounds((activeTotal ? (pool * h.target_pct!) / activeTotal : 0) - h.value_minor),
  }))

  const byAmount = (a: { amount: number }, b: { amount: number }) => b.amount - a.amount
  steps.push(...sells.map((h) => ({ kind: 'sell' as const, ticker: h.ticker, amount: h.value_minor, reason: h.reason })).sort(byAmount))
  steps.push(...trades.filter((t) => t.delta <= -MIN_TRADE).map((t) => ({ kind: 'trim' as const, ticker: t.h.ticker, amount: -t.delta })).sort(byAmount))
  if (cashNeeded >= MIN_TRADE) steps.push({ kind: 'cash', amount: pounds(cashNeeded) })
  steps.push(...trades.filter((t) => t.delta >= MIN_TRADE).map((t) => ({ kind: 'buy' as const, ticker: t.h.ticker, amount: t.delta })).sort(byAmount))
  steps.push(...holdings.filter((h) => h.action === 'review').map((h) => ({ kind: 'review' as const, ticker: h.ticker, reason: h.reason })))

  const monthly = active
    .filter((h) => h.target_pct! > 0)
    .map((h) => ({ ticker: h.ticker, amount: pounds((settings.monthly_minor * h.target_pct!) / activeTotal) }))
    .sort(byAmount)

  return { steps, monthly }
}
