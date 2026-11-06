// AI top-job picks, per Top jobs tab, saved to ai_picks for the household.
//
// The morning Claude routine (a scheduled Claude Code routine on the
// household's Claude subscription) uses two calls, both needing the
// x-priorities-secret header (PRIORITIES_SECRET):
//
//   {"mode":"priorities-input"}  -> each tab's shortlist and the instructions
//   {"mode":"priorities-save", "key", "picks":[{ref, why, where}]}
//                                -> that tab's picks, after checking each is
//                                   one of its open jobs
//
// Tabs: each person with "AI picks my top jobs" on (and the Chief of Staff on)
// gets their own; Together is picked when anyone has it on. Shortlists hold job
// titles, categories, dates and flags, and busy times without event titles.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'
import { localNow } from '../_shared/agents/dates.ts'
import { type Candidate, candidatesFor, cleanPicks, MAX_PICKS, PRIORITIES_PROMPT, prioritiesInput, TOGETHER } from '../_shared/agents/priorities.ts'
import type { Member, TaskContext } from '../_shared/agents/types.ts'
import { type AgentPrefs, loadCalendar, loadContext, loadPrefs } from './context.ts'

type Household = { id: string; timezone: string }
export type Tab = Member | typeof TOGETHER

const hhmm = (p: { hour: number; minute: number }) => `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
export const tabId = (tab: Tab) => (tab === TOGETHER ? TOGETHER : tab.id)

/** The tabs to pick for in this household. */
export function tabsFor(ctx: TaskContext, prefs: AgentPrefs): Tab[] {
  const wanted = ctx.members.filter((m) => prefs.aiPriorities.has(m.id) && prefs.enabled('chief_of_staff').includes(m.id))
  return wanted.length ? [...wanted, TOGETHER] : []
}

/** The routine answers with task ids, so a job finished meanwhile can't shift which pick means what. */
const shortlist = (ctx: TaskContext, tab: Tab): Candidate[] => candidatesFor(ctx, tab).map((c) => ({ ...c, ref: c.task_id }))

async function contextFor(db: SupabaseClient, household: Household, now: Date) {
  const { date, hour } = localNow(now, household.timezone)
  const ctx = await loadContext(db, household.id, date, hour)
  ctx.timezone = household.timezone
  ctx.calendar = await loadCalendar(db, household.id, date).catch(() => [])
  return ctx
}

/** Checks picks against the tab's shortlist now and saves them for today. */
export async function savePicks(db: SupabaseClient, householdId: string, ctx: TaskContext, tab: Tab, raw: string, candidates = shortlist(ctx, tab)) {
  const picks = cleanPicks(raw, candidates)
  if (!picks?.length) return 0
  const saved = await db.rpc('agent_save_picks', { p_household_id: householdId, p_view: tabId(tab), p_day: ctx.today, p_picks: picks })
  if (saved.error) throw new Error(saved.error.message)
  return picks.length
}

export async function routineInput(db: SupabaseClient, now: Date) {
  const { data: households, error } = await db.from('households').select('id, timezone')
  if (error) throw new Error(error.message)
  const tabs: { key: string; name: string; input: unknown }[] = []
  for (const household of (households ?? []) as Household[]) {
    const prefs = await loadPrefs(db, household.id)
    if (!prefs.aiPriorities.size) continue
    const ctx = await contextFor(db, household, now)
    const time = hhmm(localNow(now, household.timezone))
    for (const tab of tabsFor(ctx, prefs)) {
      const candidates = shortlist(ctx, tab)
      if (!candidates.length) continue
      tabs.push({
        key: `${household.id}:${tabId(tab)}:${ctx.today}`,
        name: tab === TOGETHER ? 'Together' : tab.name,
        input: JSON.parse(prioritiesInput(ctx, tab, candidates, time)),
      })
    }
  }
  return {
    status: 'ok',
    instructions: `${PRIORITIES_PROMPT} Each job's ref is its id: answer with those refs, at most ${MAX_PICKS}.`,
    answer: { mode: 'priorities-save', key: '<the tab’s key>', picks: [{ ref: '<job ref>', why: '<at most 12 words>', where: 'home | anywhere' }] },
    // "people" is what the routine's prompt reads; each entry is one Top jobs tab.
    people: tabs,
  }
}

export async function routineSave(db: SupabaseClient, body: { key?: unknown; picks?: unknown }, now: Date) {
  const [householdId, view, date] = typeof body.key === 'string' ? body.key.split(':') : []
  if (!householdId || !view || !date) return { status: 'error', message: 'Unknown key.' }
  const { data: household, error } = await db.from('households').select('id, timezone').eq('id', householdId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!household) return { status: 'error', message: 'Unknown key.' }
  const ctx = await contextFor(db, household as Household, now)
  if (ctx.today !== date) return { status: 'error', message: 'That shortlist is from another day.' }
  const tab: Tab | undefined = view === TOGETHER ? TOGETHER : ctx.members.find((m) => m.id === view)
  if (!tab) return { status: 'error', message: 'Unknown key.' }
  const saved = await savePicks(db, householdId, ctx, tab, JSON.stringify({ picks: body.picks }))
  return saved ? { status: 'ok', saved } : { status: 'error', message: 'None of those picks are on the shortlist.' }
}
