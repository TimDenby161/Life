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
//   {"mode":"news-save", "key", "items":[{ref, short}]}
//                                -> one-line versions of the day's headlines
//
// Tabs: each person with "AI picks my top jobs" on (and the Chief of Staff on)
// gets their own; Together is picked when anyone has it on. Shortlists hold job
// titles, categories, dates and flags, and busy times without event titles.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'
import { isAway } from '../_shared/agents/calendar.ts'
import { localNow } from '../_shared/agents/dates.ts'
import { cleanHeadlines, HEADLINES_PROMPT, headlinesInput } from '../_shared/agents/headlines.ts'
import { type Candidate, candidatesFor, cleanPicks, goodDayToAsk, MAX_PICKS, planBudget, PRIORITIES_PROMPT, prioritiesInput, TOGETHER, workBudget } from '../_shared/agents/priorities.ts'
import type { Member, TaskContext } from '../_shared/agents/types.ts'
import { type AgentPrefs, dayWindows, loadCalendar, loadContext, loadNews, loadPrefs, travelRules } from './context.ts'

type Household = { id: string; timezone: string }
export type Tab = Member | typeof TOGETHER

const hhmm = (p: { hour: number; minute: number }) => `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
export const tabId = (tab: Tab) => (tab === TOGETHER ? TOGETHER : tab.id)

/** The tabs to pick for in this household. Together is skipped while either of you is away: those jobs need you both there. */
export function tabsFor(ctx: TaskContext, prefs: AgentPrefs): Tab[] {
  const wanted = ctx.members.filter((m) => prefs.aiPriorities.has(m.id) && prefs.enabled('chief_of_staff').includes(m.id))
  const someoneAway = ctx.members.some((m) => isAway(ctx.calendar ?? [], m.id, ctx.today, ctx.timezone ?? 'Europe/London'))
  return wanted.length ? [...wanted, ...(someoneAway ? [] : [TOGETHER])] : []
}

/** The routine answers with task ids, so a job finished meanwhile can't shift which pick means what. */
const shortlist = (ctx: TaskContext, tab: Tab): Candidate[] => candidatesFor(ctx, tab).map((c) => ({ ...c, ref: c.task_id }))

async function contextFor(db: SupabaseClient, household: Household, now: Date, prefs?: AgentPrefs) {
  const { date, hour } = localNow(now, household.timezone)
  const ctx = await loadContext(db, household.id, date, hour)
  ctx.timezone = household.timezone
  const p = prefs ?? (await loadPrefs(db, household.id))
  ctx.travel = travelRules(ctx, p)
  ctx.window = dayWindows(ctx, p)
  ctx.calendar = await loadCalendar(db, household.id, date).catch(() => [])
  return ctx
}

/** Checks picks against the tab's shortlist now, keeps what fits the day's free time, and saves them for today. */
export async function savePicks(db: SupabaseClient, householdId: string, ctx: TaskContext, tab: Tab, raw: string, candidates = shortlist(ctx, tab)) {
  const picks = cleanPicks(raw, candidates, planBudget(ctx, tab, ctx.hour * 60), workBudget(ctx, tab, ctx.hour * 60), goodDayToAsk(ctx.today))
  if (!picks?.length) return 0
  const saved = await db.rpc('agent_save_picks', { p_household_id: householdId, p_view: tabId(tab), p_day: ctx.today, p_picks: picks })
  if (saved.error) throw new Error(saved.error.message)
  return picks.length
}

export async function routineInput(db: SupabaseClient, now: Date) {
  const { data: households, error } = await db.from('households').select('id, timezone')
  if (error) throw new Error(error.message)
  const tabs: { key: string; name: string; input: unknown }[] = []
  const news: { key: string; headlines: unknown }[] = []
  for (const household of (households ?? []) as Household[]) {
    const { date } = localNow(now, household.timezone)
    const headlines = await loadNews(db, household.id)
    if (headlines.length) news.push({ key: `${household.id}:news:${date}`, headlines: headlinesInput(headlines) })
    const prefs = await loadPrefs(db, household.id)
    if (!prefs.aiPriorities.size) continue
    const ctx = await contextFor(db, household, now, prefs)
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
    news_instructions: HEADLINES_PROMPT,
    news_answer: { mode: 'news-save', key: '<the news key>', items: [{ ref: '<headline ref>', short: '<at most 40 characters>' }] },
    news,
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
  return saved ? { status: 'ok', saved } : { status: 'error', message: 'None of those picks are on the shortlist and fit the free time.' }
}

/** One-line headlines, checked against the feed as it is now, saved for today. */
export async function routineSaveNews(db: SupabaseClient, body: { key?: unknown; items?: unknown }, now: Date) {
  const [householdId, kind, date] = typeof body.key === 'string' ? body.key.split(':') : []
  if (!householdId || kind !== 'news' || !date) return { status: 'error', message: 'Unknown key.' }
  const { data: household, error } = await db.from('households').select('id, timezone').eq('id', householdId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!household) return { status: 'error', message: 'Unknown key.' }
  if (localNow(now, (household as Household).timezone).date !== date) return { status: 'error', message: 'Those headlines are from another day.' }
  const items = cleanHeadlines(body.items, await loadNews(db, householdId))
  if (!items.length) return { status: 'error', message: 'None of those match today’s headlines.' }
  const saved = await db.rpc('agent_save_headlines', { p_household_id: householdId, p_day: date, p_items: items })
  if (saved.error) throw new Error(saved.error.message)
  return { status: 'ok', saved: items.length }
}
