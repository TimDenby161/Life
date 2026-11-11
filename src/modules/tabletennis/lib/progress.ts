import { addDaysISO } from '@/lib/dates'
import { winRate } from '../../../../supabase/functions/_shared/tableTennis.ts'

type Snap = { tt_user_id: string; league: string; day: string; played: number; won: number }

/**
 * How a player's record in a league has moved: against the snapshot from about
 * `days` ago (or the oldest there is, if newer). Null until there is an older
 * snapshot with fewer games, so a first look shows no change rather than a false one.
 */
export function progressSince(
  snaps: readonly Snap[],
  ttUserId: string,
  league: string,
  now: { played: number; won: number },
  today: string,
  days = 28,
): { since: string; games: number; wins: number; ratePoints: number } | null {
  const mine = snaps.filter((s) => s.tt_user_id === ttUserId && s.league === league && s.day < today).sort((a, b) => a.day.localeCompare(b.day))
  if (!mine.length) return null
  const target = addDaysISO(today, -days)
  const base = mine.filter((s) => s.day <= target).at(-1) ?? mine[0]
  const games = now.played - base.played
  if (games <= 0) return null
  const before = winRate(base.won, base.played)
  const after = winRate(now.won, now.played)
  return { since: base.day, games, wins: now.won - base.won, ratePoints: before === null || after === null ? 0 : after - before }
}

type Session = { employer_id: string; amount_minor: number | null; paid_on: string | null }

/** What each employer owes: the total of sessions not yet paid, and how many. */
export function owedByEmployer(sessions: readonly Session[]): Map<string, { amount: number; count: number }> {
  const out = new Map<string, { amount: number; count: number }>()
  for (const s of sessions) {
    if (s.paid_on) continue
    const hit = out.get(s.employer_id) ?? { amount: 0, count: 0 }
    hit.amount += s.amount_minor ?? 0
    hit.count += 1
    out.set(s.employer_id, hit)
  }
  return out
}
