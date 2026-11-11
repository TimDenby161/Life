// Table tennis leagues on TT Leagues: which leagues the app follows, how the
// current season is found in each, and the checks on what the API sends back.
// Pure (no Deno, no imports) so the app and the table-tennis function share it.
//
// TT Leagues serves every league from one API, picked by a Tenant header. A
// player has the same id (userId) in every league, so one id follows them
// across Sutton, Thames Valley and the British leagues.

export const TT_API = 'https://ttleagues-api.azurewebsites.net/api/'

export type LeagueKey = 'sutton' | 'thames_valley' | 'british' | 'jbl_boys' | 'jbl_girls'

export type League = {
  key: LeagueKey
  label: string
  tenant: string
  /** The season's competition (not its cups); the newest that matches is used. */
  competition: RegExp
  /** Leagues Tim plays in, shown on Playing; the junior leagues are only followed for coaching. */
  playing: boolean
}

export const LEAGUES: League[] = [
  { key: 'sutton', label: 'Sutton & District', tenant: 'sdttl.ttleagues.com', competition: /^season\b/i, playing: true },
  { key: 'thames_valley', label: 'Thames Valley', tenant: 'thamesvalley.ttleagues.com', competition: /\bseason\b/i, playing: true },
  { key: 'british', label: 'British League', tenant: 'british.ttleagues.com', competition: /^senior british club league/i, playing: true },
  { key: 'jbl_boys', label: 'JBL Boys', tenant: 'british.ttleagues.com', competition: /^youth british club league \(boys/i, playing: false },
  { key: 'jbl_girls', label: 'JBL Girls', tenant: 'british.ttleagues.com', competition: /^youth british club league \(girls/i, playing: false },
]

export const leagueByKey = (key: string) => LEAGUES.find((l) => l.key === key)

/** The current season's competition: the newest whose name matches (cups and old seasons don't). */
export function pickCompetition(comps: unknown, league: League): { id: number; name: string } | null {
  if (!Array.isArray(comps)) return null
  const matches = comps.filter(
    (c): c is { id: number; name: string } => !!c && typeof c.id === 'number' && typeof c.name === 'string' && league.competition.test(c.name.trim()) && !/\bcup\b/i.test(c.name),
  )
  return matches.reduce<{ id: number; name: string } | null>((best, c) => (!best || c.id > best.id ? c : best), null)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const text = (v: unknown, max = 120) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const count = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 100000 ? v : 0)

/** One player's record in a division this season. */
export type Average = {
  league: LeagueKey
  ttUserId: string
  name: string
  division: string
  divisionId: number
  team: string
  club: string
  played: number
  won: number
  lost: number
}

/** A division's averages as rows we trust: a real player id and plain text; anything else is dropped. */
export function cleanAverages(raw: unknown, league: LeagueKey, divisionId: number): Average[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((a) => {
    if (!a || typeof a.userId !== 'string' || !UUID.test(a.userId)) return []
    const name = text(a.name)
    if (!name) return []
    return [{
      league,
      ttUserId: a.userId.toLowerCase(),
      name,
      division: text(a.division),
      divisionId,
      team: text(a.teamFullName ?? a.team),
      club: text(a.club),
      played: count(a.played),
      won: count(a.won),
      lost: count(a.loss),
    }]
  })
}

/** A row of a division's league table. */
export type Standing = { position: number; team: string; played: number; won: number; drawn: number; lost: number; points: number }

export function cleanStandings(raw: unknown): Standing[] {
  if (!Array.isArray(raw)) return []
  return raw
    .flatMap((s) => {
      const team = text(s?.fullName ?? s?.name)
      if (!team || /^bye\b/i.test(team)) return []
      return [{ position: count(s.position), team, played: count(s.played), won: count(s.won), drawn: count(s.drawn), lost: count(s.lost), points: typeof s.points === 'number' ? s.points : 0 }]
    })
    .sort((a, b) => a.position - b.position)
}

/**
 * A person's averages, one per league: where they've played most (a player can
 * turn out for more than one team, or as a reserve in another division).
 */
export function mainRecords(averages: readonly Average[], ttUserId: string): Average[] {
  const id = ttUserId.toLowerCase()
  const best = new Map<LeagueKey, Average>()
  for (const a of averages) {
    if (a.ttUserId !== id) continue
    const hit = best.get(a.league)
    if (!hit || a.played > hit.played) best.set(a.league, a)
  }
  return LEAGUES.flatMap((l) => (best.has(l.key) ? [best.get(l.key)!] : []))
}

/** Players whose name contains every word typed, each once with their leagues, best matches first. */
export function searchPlayers(averages: readonly Average[], query: string, max = 20): { ttUserId: string; name: string; where: string[] }[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length >= 2)
  if (!words.length) return []
  const found = new Map<string, { ttUserId: string; name: string; where: string[] }>()
  for (const a of averages) {
    const name = a.name.toLowerCase()
    if (!words.every((w) => name.includes(w))) continue
    const hit = found.get(a.ttUserId) ?? { ttUserId: a.ttUserId, name: a.name, where: [] }
    const label = `${leagueByKey(a.league)?.label ?? a.league} · ${a.team}`
    if (!hit.where.includes(label)) hit.where.push(label)
    found.set(a.ttUserId, hit)
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, max)
}

/** Win rate as a whole percentage, or null before any games. */
export const winRate = (won: number, played: number) => (played > 0 ? Math.round((won / played) * 100) : null)
