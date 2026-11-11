// League results from TT Leagues for the Table tennis page.
//
// POST { mode: 'refresh' }  (Authorization: Bearer <user JWT>)
//   -> { status: 'ok', day, records: Average[], tables: { league, divisionId, rows: Standing[] }[] }
//      records: this season's record in each league for every TT Leagues id
//      the household follows (each person's own, from tt_profile, and the
//      players they coach, from tt_players); tables: the league table of each
//      division a household member plays in. Today's records are saved as
//      snapshots (tt_save_snapshots, service role) to show development.
// POST { mode: 'search', q }
//   -> { status: 'ok', players: { ttUserId, name, where }[] }   (names containing every word of q)
// either -> { status: 'error', message }
//
// TT Leagues is public data; nothing about the household is sent to it (only
// the Tenant header naming the league). The ids followed are read as the
// caller, under RLS. The service role is used only for tt_save_snapshots.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import { corsHeaders, json, TtlCache, userClient } from '../_shared/http.ts'
import {
  type Average,
  cleanAverages,
  cleanStandings,
  LEAGUES,
  mainRecords,
  pickCompetition,
  searchPlayers,
  type Standing,
  TT_API,
} from '../_shared/tableTennis.ts'

const serviceClient = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

async function ttGet(tenant: string, path: string): Promise<unknown> {
  const res = await fetch(TT_API + path, { headers: { Tenant: tenant, 'User-Agent': 'life-household-app' }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`TT Leagues ${res.status}`)
  return res.json()
}

/** Runs `fn` over `items` a few at a time, so TT Leagues isn't sent fifty requests at once. */
async function inBatches<T, R>(items: readonly T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))))
  return out
}

type Division = { league: (typeof LEAGUES)[number]; id: number }

// Every division's averages, kept for 30 minutes so searching then refreshing doesn't fetch it all twice.
const cache = new TtlCache<{ divisions: Division[]; averages: Average[] }>(30 * 60_000)

async function allAverages(): Promise<{ divisions: Division[]; averages: Average[] }> {
  const hit = cache.get('all')
  if (hit) return hit
  const divisions = (
    await Promise.all(
      LEAGUES.map(async (league) => {
        const comp = pickCompetition(await ttGet(league.tenant, 'competitions'), league)
        if (!comp) return []
        const list = await ttGet(league.tenant, `competitions/${comp.id}/divisions`)
        return Array.isArray(list) ? list.filter((d) => typeof d?.id === 'number').map((d) => ({ league, id: d.id as number })) : []
      }),
    )
  ).flat()
  const averages = (
    await inBatches(divisions, 8, async (d) => cleanAverages(await ttGet(d.league.tenant, `divisions/${d.id}/averages`).catch(() => []), d.league.key, d.id))
  ).flat()
  const value = { divisions, averages }
  cache.set('all', value)
  return value
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { status: 'error', message: 'Method not allowed' }, 405)

  const supabase = await userClient(req)
  if (!supabase) return json(req, { status: 'error', message: 'Sign in again.' }, 401)

  let body: { mode?: string; q?: string }
  try {
    body = await req.json()
  } catch {
    return json(req, { status: 'error', message: 'Invalid request' }, 400)
  }

  let data: { divisions: Division[]; averages: Average[] }
  try {
    data = await allAverages()
  } catch {
    console.warn('table-tennis: TT Leagues could not be reached')
    return json(req, { status: 'error', message: 'TT Leagues could not be reached. Try again in a minute.' }, 502)
  }

  if (body.mode === 'search') {
    const q = typeof body.q === 'string' ? body.q.slice(0, 60) : ''
    return json(req, { status: 'ok', players: searchPlayers(data.averages, q) })
  }
  if (body.mode !== 'refresh') return json(req, { status: 'error', message: 'Invalid request' }, 400)

  // RLS: only the caller's household.
  const { data: user } = await supabase.auth.getUser()
  const { data: member } = await supabase.from('household_members').select('household_id').eq('user_id', user.user!.id).maybeSingle()
  if (!member) return json(req, { status: 'error', message: 'No household.' }, 403)
  const [profiles, players] = await Promise.all([
    supabase.from('tt_profile').select('tt_user_id').eq('household_id', member.household_id),
    supabase.from('tt_players').select('tt_user_id').eq('household_id', member.household_id),
  ])
  if (profiles.error || players.error) return json(req, { status: 'error', message: 'Could not load who to follow.' }, 500)

  const own = profiles.data.flatMap((p) => (p.tt_user_id ? [p.tt_user_id as string] : []))
  const followed = [...new Set([...own, ...players.data.map((p) => p.tt_user_id as string)])]
  const records = followed.flatMap((id) => mainRecords(data.averages, id))

  // League tables for the divisions household members play in.
  const ownDivisions = records.filter((r) => own.includes(r.ttUserId))
  const tables = await inBatches(ownDivisions, 4, async (r) => {
    const league = LEAGUES.find((l) => l.key === r.league)!
    const rows: Standing[] = cleanStandings(await ttGet(league.tenant, `divisions/${r.divisionId}/standings`).catch(() => []))
    return { league: r.league, divisionId: r.divisionId, rows }
  })

  const day = new Date().toISOString().slice(0, 10)
  const { error: saveError } = await serviceClient().rpc('tt_save_snapshots', {
    p_household_id: member.household_id,
    p_day: day,
    p_rows: records.map((r) => ({ tt_user_id: r.ttUserId, league: r.league, division: r.division, team: r.team, played: r.played, won: r.won, lost: r.lost })),
  })
  if (saveError) console.warn('table-tennis: snapshots not saved')

  return json(req, { status: 'ok', day, records, tables })
})
