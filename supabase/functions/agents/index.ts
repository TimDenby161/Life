// The agent dispatcher. Two ways in:
//
//   Scheduled  POST {"mode":"scheduled"} with header x-agents-secret, sent hourly
//              by pg_cron (agents_dispatch). Runs whatever is due in every
//              household, plus queued event runs and failed runs with retries left.
//   On demand  POST {"agent":"task_manager"|"chief_of_staff"} with the person's
//              JWT, from "Run now" in the AI Hub. Rate-limited to one run per
//              agent per household per ten minutes.
//   -> { status: 'ok' | 'recent' | 'error', message? }
//   Routine    POST {"mode":"priorities-input"|"priorities-save"|"news-save"} with header
//              x-priorities-secret, from the morning Claude routine (routine.ts).
//   Push       POST {"mode":"push-key"} or {"mode":"push-test"} with the person's
//              JWT: the public key their browser subscribes with, and a test
//              notification to their own devices.
//
// Agents only read (context.ts, always scoped by household) and write through
// agent_claim_run / agent_finish_run, which touch agent tables only. Nothing
// here changes tasks, money or anything else. After a scheduled briefing the
// headline goes to the phones of people who turned notifications on (notify.ts).
//
// Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (provided by Supabase),
// AGENT_CRON_SECRET, and optionally ANTHROPIC_API_KEY, AGENT_LLM_MODEL,
// AGENT_LLM_MONTHLY_BUDGET_USD, ALLOWED_ORIGINS, GOOGLE_SERVICE_ACCOUNT_JSON
// (the calendar, shared with calendar-events), and VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY, VAPID_SUBJECT for notifications, PRIORITIES_SECRET for the
// morning Claude routine.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'
import { briefingFor, type PendingSuggestion } from '../_shared/agents/chiefOfStaff.ts'
import { isoWeekday, localNow } from '../_shared/agents/dates.ts'
import { analyseCareer, analyseEvents, parseCareerConfig } from '../_shared/agents/career.ts'
import { analyseFinance, analyseSavings, savedSoFar } from '../_shared/agents/finance.ts'
import { analyseFitness, HISTORY_DAYS, parseFitnessGoals } from '../_shared/agents/fitness.ts'
import { type GoalLine, goalLines } from '../_shared/agents/goals.ts'
import { analyseHousehold } from '../_shared/agents/household.ts'
import { analyseLanguages, analyseTargets, parseLanguageTargets } from '../_shared/agents/languages.ts'
import { analyseFood, parseFoodGoals } from '../_shared/agents/nutrition.ts'
import { analysePeople } from '../_shared/agents/people.ts'
import { analyseProjects, parseProjectsConfig } from '../_shared/agents/projects.ts'
import { analyseLifeAdmin } from '../_shared/agents/lifeAdmin.ts'
import { monthlyBudgetMicroUsd } from '../_shared/agents/llm.ts'
import { candidatesFor, prioritiesInput } from '../_shared/agents/priorities.ts'
import { agentById, LIVE_AGENTS } from '../_shared/agents/registry.ts'
import { agentDue, chiefOfStaffDue, manualKey } from '../_shared/agents/schedule.ts'
import { analyseTasks } from '../_shared/agents/taskManager.ts'
import { analyseTravel } from '../_shared/agents/travel.ts'
import type { BriefingDraft, SuggestionDraft, TaskContext } from '../_shared/agents/types.ts'
import { analyseWedding } from '../_shared/agents/wedding.ts'
import { corsHeaders, json, userClient } from '../_shared/http.ts'
import {
  type AgentPrefs,
  loadCalendar,
  loadContext,
  loadFinance,
  loadGoals,
  loadLanguages,
  loadPeople,
  loadPrefs,
  loadRenewals,
  loadRooms,
  loadSavings,
  loadSessions,
  loadTakeaways,
  loadTrips,
  loadWedding,
  loadWeights,
} from './context.ts'
import { notifyBriefings, notifyTest, vapidFromEnv } from './notify.ts'
import { pickPriorities } from './priorities.ts'
import { routineInput, routineSave, routineSaveNews, savePicks, tabsFor } from './routine.ts'
import { noUsage, type Usage, writeSummary } from './summary.ts'

type Trigger = 'scheduled' | 'event' | 'manual'
type Household = { id: string; timezone: string }

const serviceClient = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

/** Error text for the run log: short, and with quoted values removed in case they hold data. */
const safeError = (e: unknown) => (e instanceof Error ? e.message : 'Unknown error').replace(/"[^"]*"/g, '"…"').slice(0, 200)

function sameSecret(a: string, b: string) {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

async function llmSpentThisMonth(db: SupabaseClient, householdId: string, now: Date) {
  const monthStart = `${now.toISOString().slice(0, 7)}-01T00:00:00Z`
  const { data, error } = await db
    .from('agent_runs')
    .select('llm_cost_micro_usd')
    .eq('household_id', householdId)
    .gte('created_at', monthStart)
  if (error) throw new Error(error.message)
  return (data ?? []).reduce((sum: number, r: { llm_cost_micro_usd: number }) => sum + Number(r.llm_cost_micro_usd), 0)
}

/** A specialist's suggestions: what each agent reads beyond the task context, then its rules. */
async function specialist(db: SupabaseClient, householdId: string, agentId: string, ctx: TaskContext, prefs: AgentPrefs): Promise<SuggestionDraft[]> {
  const enabled = prefs.enabled(agentId)
  switch (agentId) {
    case 'task_manager':
      return analyseTasks(ctx, enabled).suggestions
    case 'wedding':
      return analyseWedding(await loadWedding(db, householdId, ctx), enabled)
    case 'language_coach': {
      const { study, progress } = await loadLanguages(db, householdId)
      return [
        ...analyseLanguages(ctx.today, study, progress, enabled),
        ...analyseTargets(ctx.today, enabled, (id) => parseLanguageTargets(prefs.config('language_coach', id))),
      ]
    }
    case 'health_coach':
      return analyseFitness(ctx.today, ctx.members, await loadSessions(db, householdId, ctx.today, HISTORY_DAYS), ctx.open, enabled, (id) =>
        parseFitnessGoals(prefs.config('health_coach', id)),
      )
    case 'household':
      return analyseHousehold(ctx, await loadRooms(db, householdId), enabled)
    case 'life_admin':
      return analyseLifeAdmin(ctx.today, await loadRenewals(db, householdId), ctx.open, enabled)
    case 'travel': {
      const [trips, renewals] = await Promise.all([loadTrips(db, householdId, ctx.today), loadRenewals(db, householdId)])
      return analyseTravel(ctx.today, trips, renewals, ctx.open, enabled)
    }
    case 'career':
      return [
        ...analyseCareer(ctx.today, await loadGoals(db, householdId), enabled),
        ...analyseEvents(ctx.today, ctx.calendar ?? [], enabled, (id) => parseCareerConfig(prefs.config('career', id)), ctx.timezone),
      ]
    case 'finance': {
      const [finance, savings] = await Promise.all([loadFinance(db, householdId), loadSavings(db, householdId)])
      const input = { today: ctx.today, members: ctx.members, ...finance }
      return [...analyseFinance(input, enabled), ...analyseSavings(input, savings.goals, savings.pots, enabled)]
    }
    case 'nutrition': {
      const [weights, takeaways] = await Promise.all([loadWeights(db, householdId, ctx.today, 60), loadTakeaways(db, householdId, ctx.today)])
      return analyseFood(ctx.today, ctx.members, weights, takeaways, ctx.open, enabled, (id) => parseFoodGoals(prefs.config('nutrition', id)))
    }
    case 'side_projects':
      return analyseProjects(ctx.today, ctx.open, enabled, (id) => parseProjectsConfig(prefs.config('side_projects', id)))
    case 'friends':
      return analysePeople(ctx.today, await loadPeople(db, householdId), ctx.open, enabled)
    default:
      throw new Error(`No runner for ${agentId}`)
  }
}

/**
 * Each person's goal lines for the briefing, from the goals they've set with
 * the other agents. A failure here leaves the briefing without goals rather
 * than stopping it.
 */
async function goalsLoader(db: SupabaseClient, householdId: string, ctx: TaskContext, prefs: AgentPrefs): Promise<(userId: string) => GoalLine[]> {
  try {
    const [weights, finance, savings] = await Promise.all([loadWeights(db, householdId, ctx.today, 14), loadFinance(db, householdId), loadSavings(db, householdId)])
    const saved = savedSoFar({ today: ctx.today, members: ctx.members, ...finance }, savings.goals, savings.pots)
    return (userId) => {
      // Only goals whose agent this person has on.
      const on = (agentId: string) => prefs.enabled(agentId).includes(userId)
      return goalLines(ctx.today, {
        fitness: on('health_coach') ? parseFitnessGoals(prefs.config('health_coach', userId)) : null,
        food: on('nutrition') ? parseFoodGoals(prefs.config('nutrition', userId)) : null,
        weights: weights.filter((w) => w.user_id === userId),
        projects: on('side_projects') ? parseProjectsConfig(prefs.config('side_projects', userId)) : { projects: [], sponsorTeam: null },
        languages: on('language_coach') ? parseLanguageTargets(prefs.config('language_coach', userId)) : [],
        savings: on('finance')
          ? savings.goals
              .filter((g) => g.target_date && g.target_date > ctx.today && (g.ownership !== 'personal' || g.owner_id === userId))
              .flatMap((g) => {
                const have = saved.get(g.id)
                return have === null || have === undefined || have >= g.target_minor ? [] : [{ name: g.name, saved: have, target: g.target_minor }]
              })
          : [],
      })
    }
  } catch {
    console.warn('agents: goals unavailable')
    return () => []
  }
}

/**
 * Claims and runs one agent for one household. Returns false if the run key was
 * already dealt with (another tick, an earlier press, or out of retries).
 */
async function runAgent(
  db: SupabaseClient,
  household: Household,
  agentId: string,
  runKey: string,
  trigger: Trigger,
  prefs: AgentPrefs,
  now: Date,
  options: { kind?: 'daily' | 'weekly'; onlyFor?: string; requestedBy?: string } = {},
): Promise<boolean> {
  const claim = await db.rpc('agent_claim_run', {
    p_household_id: household.id,
    p_agent_id: agentId,
    p_run_key: runKey,
    p_trigger: trigger,
    p_requested_by: options.requestedBy ?? null,
  })
  if (claim.error) throw new Error(claim.error.message)
  const runId = claim.data as string | null
  if (!runId) return false

  try {
    const { date, hour } = localNow(now, household.timezone)
    const ctx = await loadContext(db, household.id, date, hour)
    ctx.timezone = household.timezone
    // Only these plan around the calendar. A calendar problem never stops the run.
    if (agentId === 'task_manager' || agentId === 'chief_of_staff' || agentId === 'career') {
      ctx.calendar = await loadCalendar(db, household.id, date).catch(() => {
        console.warn('agents: calendar unavailable')
        return []
      })
    }
    const tm = analyseTasks(ctx, prefs.enabled('task_manager'))
    const briefings: BriefingDraft[] = []
    const usage: Usage = noUsage()
    const suggestions = agentId === 'chief_of_staff' ? [] : await specialist(db, household.id, agentId, ctx, prefs)

    if (agentId === 'chief_of_staff') {
      // Every agent's open suggestions, written by the specialists earlier in this tick.
      const pending = await db
        .from('agent_suggestions')
        .select('dedupe_key, title, severity, recipients')
        .eq('household_id', household.id)
        .eq('status', 'pending')
      if (pending.error) throw new Error(pending.error.message)
      const kind = options.kind ?? (isoWeekday(date) === 1 ? 'weekly' : 'daily')
      const budget = { spent: await llmSpentThisMonth(db, household.id, now), limit: monthlyBudgetMicroUsd(Deno.env.get('AGENT_LLM_MONTHLY_BUDGET_USD')) }
      const goalsFor = await goalsLoader(db, household.id, ctx, prefs)
      for (const member of ctx.members) {
        if (!prefs.enabled('chief_of_staff').includes(member.id)) continue
        if (options.onlyFor && options.onlyFor !== member.id) continue
        if (kind === 'daily' && !options.onlyFor && prefs.schedule('chief_of_staff', member.id) !== 'daily') continue
        const briefing = briefingFor(ctx, tm, member, kind, now, pending.data as PendingSuggestion[], goalsFor(member.id))
        if (prefs.aiSummaries.has(member.id)) {
          const result = await writeSummary(member.name, briefing.content as Parameters<typeof writeSummary>[1], budget)
          briefing.ai_summary = result.summary
          usage.input_tokens += result.usage.input_tokens
          usage.output_tokens += result.usage.output_tokens
          usage.cost_micro_usd += result.usage.cost_micro_usd
          budget.spent += result.usage.cost_micro_usd
        }
        briefings.push(briefing)
      }
      // With an API key (instead of the morning routine), the scheduled run picks each tab's top jobs.
      if (trigger === 'scheduled' && Deno.env.get('ANTHROPIC_API_KEY')) {
        const local = localNow(now, household.timezone)
        const time = `${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}`
        for (const tab of tabsFor(ctx, prefs)) {
          const candidates = candidatesFor(ctx, tab)
          if (!candidates.length) continue
          const result = await pickPriorities(prioritiesInput(ctx, tab, candidates, time), budget)
          if (result.raw) await savePicks(db, household.id, ctx, tab, result.raw, candidates)
          usage.input_tokens += result.usage.input_tokens
          usage.output_tokens += result.usage.output_tokens
          usage.cost_micro_usd += result.usage.cost_micro_usd
          budget.spent += result.usage.cost_micro_usd
        }
      }
    }

    const done = await db.rpc('agent_finish_run', {
      p_run_id: runId,
      p_error: null,
      p_suggestions: suggestions,
      p_briefings: briefings,
      p_usage: usage,
    })
    if (done.error) throw new Error(done.error.message)
    // A briefing someone asked for in the app doesn't need to buzz their phone too.
    if (trigger === 'scheduled' && briefings.length) {
      await notifyBriefings(db, household.id, briefings, prefs.briefingPush, now).catch(() => console.warn('agents: notifications failed'))
    }
  } catch (e) {
    await db.rpc('agent_finish_run', { p_run_id: runId, p_error: safeError(e) })
    console.warn(`agents: ${agentId} failed for a household`)
  }
  return true
}

/** Hourly: due runs for every household, plus queued events and retries. */
async function runScheduled(db: SupabaseClient, now: Date) {
  const { data: households, error } = await db.from('households').select('id, timezone')
  if (error) throw new Error(error.message)
  let ran = 0
  for (const household of (households ?? []) as Household[]) {
    const prefs = await loadPrefs(db, household.id)
    const { date, hour } = localNow(now, household.timezone)

    // Task completions queue event runs; failed ones get up to three attempts.
    const { data: pending } = await db
      .from('agent_runs')
      .select('agent_id, run_key, trigger')
      .eq('household_id', household.id)
      .in('status', ['queued', 'failed', 'running'])
      .lt('attempts', 3)
      .gte('created_at', new Date(now.getTime() - 86_400_000).toISOString())
    for (const run of (pending ?? []) as { agent_id: string; run_key: string; trigger: Trigger }[]) {
      if (run.trigger === 'manual' || agentById(run.agent_id)?.status !== 'live') continue
      if (await runAgent(db, household, run.agent_id, run.run_key, run.trigger, prefs, now)) ran++
    }

    // Specialists first (Task Manager leading), so the briefing sees their fresh suggestions.
    for (const agent of LIVE_AGENTS) {
      const due = agentDue(agent.cadence, date, hour)
      if (due && (await runAgent(db, household, agent.id, due.runKey, 'scheduled', prefs, now))) ran++
    }

    const schedules = prefs.enabled('chief_of_staff').map((id) => prefs.schedule('chief_of_staff', id))
    const cosDue = chiefOfStaffDue(date, hour, schedules)
    if (cosDue && (await runAgent(db, household, 'chief_of_staff', cosDue.runKey, 'scheduled', prefs, now, { kind: cosDue.kind }))) ran++
  }
  return ran
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { status: 'error', message: 'Use POST.' }, 405)
  const now = new Date()
  const body = (await req.json().catch(() => ({}))) as { mode?: string; agent?: string }

  if (body.mode === 'scheduled') {
    const secret = Deno.env.get('AGENT_CRON_SECRET')
    const given = req.headers.get('x-agents-secret') ?? ''
    if (!secret || !sameSecret(given, secret)) return json(req, { status: 'error', message: 'Not authorised.' }, 401)
    try {
      const ran = await runScheduled(serviceClient(), now)
      return json(req, { status: 'ok', ran })
    } catch (e) {
      return json(req, { status: 'error', message: safeError(e) }, 500)
    }
  }

  if (body.mode === 'priorities-input' || body.mode === 'priorities-save' || body.mode === 'news-save') {
    const secret = Deno.env.get('PRIORITIES_SECRET')
    const given = req.headers.get('x-priorities-secret') ?? ''
    if (!secret || !sameSecret(given, secret)) return json(req, { status: 'error', message: 'Not authorised.' }, 401)
    try {
      const db = serviceClient()
      if (body.mode === 'news-save') return json(req, await routineSaveNews(db, body as { key?: unknown; items?: unknown }, now))
      return json(req, body.mode === 'priorities-input' ? await routineInput(db, now) : await routineSave(db, body as { key?: unknown; picks?: unknown }, now))
    } catch (e) {
      return json(req, { status: 'error', message: safeError(e) }, 500)
    }
  }

  // On demand, as a signed-in member.
  const client = await userClient(req)
  if (!client) return json(req, { status: 'error', message: 'Sign in again.' }, 401)
  const { data: user } = await client.auth.getUser()
  // RLS: this only returns the caller's own household.
  const { data: membership } = await client
    .from('household_members')
    .select('household:households(id, timezone)')
    .eq('user_id', user.user!.id)
    .maybeSingle()
  const household = (membership as { household: Household | null } | null)?.household
  if (!household) return json(req, { status: 'error', message: 'No household.' }, 403)

  if (body.mode === 'push-key') {
    const vapid = vapidFromEnv()
    return vapid
      ? json(req, { status: 'ok', key: vapid.publicKey })
      : json(req, { status: 'error', message: 'Notifications aren’t set up on the server yet.' })
  }
  if (body.mode === 'push-test') {
    try {
      const sent = await notifyTest(serviceClient(), household.id, user.user!.id, now)
      if (sent === null) return json(req, { status: 'error', message: 'Notifications aren’t set up on the server yet.' })
      return json(req, sent ? { status: 'ok' } : { status: 'error', message: 'No device took it. Turn notifications off and on again on this device.' })
    } catch (e) {
      return json(req, { status: 'error', message: safeError(e) }, 500)
    }
  }

  const agent = agentById(body.agent ?? '')
  if (!agent || agent.status !== 'live') return json(req, { status: 'error', message: 'That agent isn’t available.' }, 400)
  const db = serviceClient()
  try {
    const prefs = await loadPrefs(db, household.id)
    if (!prefs.enabled(agent.id).includes(user.user!.id)) {
      return json(req, { status: 'error', message: `${agent.name} is switched off for you.` }, 400)
    }
    // A briefing on demand is just the caller's, so each person gets their own key.
    const key = agent.id === 'chief_of_staff' ? `${manualKey(now)}:${user.user!.id.slice(0, 8)}` : manualKey(now)
    const ran = await runAgent(db, household, agent.id, key, 'manual', prefs, now, {
      onlyFor: agent.id === 'chief_of_staff' ? user.user!.id : undefined,
      requestedBy: user.user!.id,
    })
    return json(req, ran ? { status: 'ok' } : { status: 'recent', message: 'It ran a few minutes ago.' })
  } catch (e) {
    return json(req, { status: 'error', message: safeError(e) }, 500)
  }
})
