// The morning Claude routine's doorway (a scheduled Claude Code routine, run on
// the household's Claude subscription instead of an API key). Both calls need
// the x-priorities-secret header (PRIORITIES_SECRET).
//
//   {"mode":"priorities-input"}  -> each opted-in person's shortlist and the
//                                   judging instructions
//   {"mode":"priorities-save", "key", "picks":[{ref, why}]}
//                                -> today's picks onto their briefing, after
//                                   checking each is one of their open jobs
//
// The shortlist is the same as for the API path: job titles, categories, dates
// and flags, and busy times without event titles.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'
import { localNow } from '../_shared/agents/dates.ts'
import { type Candidate, candidatesFor, cleanPicks, MAX_PICKS, PRIORITIES_PROMPT, prioritiesInput } from '../_shared/agents/priorities.ts'
import type { Member, TaskContext } from '../_shared/agents/types.ts'
import { loadCalendar, loadContext, loadPrefs } from './context.ts'

type Household = { id: string; timezone: string }

const hhmm = (p: { hour: number; minute: number }) => `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`

/** The routine answers with task ids, so a job finished meanwhile can't shift which pick means what. */
const shortlist = (ctx: TaskContext, member: Member): Candidate[] => candidatesFor(ctx, member).map((c) => ({ ...c, ref: c.task_id }))

async function contextFor(db: SupabaseClient, household: Household, now: Date) {
  const { date, hour } = localNow(now, household.timezone)
  const ctx = await loadContext(db, household.id, date, hour)
  ctx.timezone = household.timezone
  ctx.calendar = await loadCalendar(db, household.id, date).catch(() => [])
  return ctx
}

/** Everyone who has AI priorities and the Chief of Staff on, with today's shortlist. */
export async function routineInput(db: SupabaseClient, now: Date) {
  const { data: households, error } = await db.from('households').select('id, timezone')
  if (error) throw new Error(error.message)
  const people: { key: string; name: string; input: unknown }[] = []
  for (const household of (households ?? []) as Household[]) {
    const prefs = await loadPrefs(db, household.id)
    const wanted = prefs.enabled('chief_of_staff').filter((id) => prefs.aiPriorities.has(id))
    if (!wanted.length) continue
    const ctx = await contextFor(db, household, now)
    const time = hhmm(localNow(now, household.timezone))
    for (const member of ctx.members.filter((m) => wanted.includes(m.id))) {
      const candidates = shortlist(ctx, member)
      if (!candidates.length) continue
      const partner = ctx.members.find((m) => m.id !== member.id)
      people.push({ key: `${household.id}:${member.id}:${ctx.today}`, name: member.name, input: JSON.parse(prioritiesInput(ctx, member, partner, candidates, time)) })
    }
  }
  return {
    status: 'ok',
    instructions: `${PRIORITIES_PROMPT} Each job's ref is its id: answer with those refs, at most ${MAX_PICKS}.`,
    answer: { mode: 'priorities-save', key: '<the person’s key>', picks: [{ ref: '<job ref>', why: '<at most 12 words>' }] },
    people,
  }
}

/** One person's picks, checked against their shortlist now, saved onto today's briefing. */
export async function routineSave(db: SupabaseClient, body: { key?: unknown; picks?: unknown }, now: Date) {
  const [householdId, userId, date] = typeof body.key === 'string' ? body.key.split(':') : []
  if (!householdId || !userId || !date) return { status: 'error', message: 'Unknown key.' }
  const { data: household, error } = await db.from('households').select('id, timezone').eq('id', householdId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!household) return { status: 'error', message: 'Unknown key.' }
  const ctx = await contextFor(db, household as Household, now)
  if (ctx.today !== date) return { status: 'error', message: 'That shortlist is from another day.' }
  const member = ctx.members.find((m) => m.id === userId)
  if (!member) return { status: 'error', message: 'Unknown key.' }
  const picks = cleanPicks(JSON.stringify({ picks: body.picks }), shortlist(ctx, member))
  if (!picks?.length) return { status: 'error', message: 'None of those picks are on the shortlist.' }
  const saved = await db.rpc('agent_set_top_picks', { p_household_id: householdId, p_user_id: userId, p_date: date, p_top: picks })
  if (saved.error) throw new Error(saved.error.message)
  return saved.data ? { status: 'ok', saved: picks.length } : { status: 'error', message: 'No briefing for today yet.' }
}
