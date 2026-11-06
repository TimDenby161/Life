// Loads what the agents read, for one household. This runs with the service
// role, which bypasses RLS, so EVERY query here is filtered by household_id
// (src/test/agents-guard.test.ts checks that). Only the columns the rules use
// are selected: no task descriptions or comments, no contact details, and of
// health data only exercise sessions (never weight or periods).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'
import type { CalEvent } from '../_shared/agents/calendar.ts'
import { addDays } from '../_shared/agents/dates.ts'
import { CALENDAR_SCOPE, googleAccessToken, listEvents } from '../_shared/google-calendar.ts'
import type { AgentSchedule } from '../_shared/agents/registry.ts'
import type { FinAccount, FinSnapshot, FinTx } from '../_shared/agents/finance.ts'
import type { Goal } from '../_shared/agents/career.ts'
import type { Session } from '../_shared/agents/fitness.ts'
import type { Renewal } from '../_shared/agents/lifeAdmin.ts'
import type { Progress, Study } from '../_shared/agents/languages.ts'
import type { Trip } from '../_shared/agents/travel.ts'
import type { CompletionEvent, OpenTask, TaskContext } from '../_shared/agents/types.ts'
import type { WeddingInput } from '../_shared/agents/wedding.ts'

const HISTORY_DAYS = 180

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

export async function loadContext(db: SupabaseClient, householdId: string, today: string, hour: number): Promise<TaskContext> {
  const since = `${addDays(today, -HISTORY_DAYS)}T00:00:00Z`
  const [members, lists, categories, open, events] = await Promise.all([
    db.from('household_members').select('user_id, profile:profiles(display_name)').eq('household_id', householdId).order('joined_at'),
    db.from('task_lists').select('id, kind, owner_id').eq('household_id', householdId),
    db.from('task_categories').select('id, name, owner_id').eq('household_id', householdId),
    db
      .from('task_occurrences')
      .select(
        'id, due_date, due_time, delay_count, task:tasks!inner(id, title, list_id, category_id, needs_both, priority, importance_votes, recurrence, deadline, waiting_on_task_id, created_by, created_at, archived_at, room_id)',
      )
      .eq('household_id', householdId)
      .eq('status', 'open')
      .is('task.archived_at', null)
      .limit(2000),
    db
      .from('task_completion_events')
      .select('occurrence_id, task_id, event_type, completed_by, also_completed_by, occurred_at, recorded_at, task_title, list_id, category_id, category_name, is_recurring')
      .eq('household_id', householdId)
      .gte('recorded_at', since)
      .order('recorded_at')
      .limit(5000),
  ])

  type OccRow = { id: string; due_date: string | null; due_time: string | null; delay_count: number; task: Record<string, unknown> }
  return {
    today,
    hour,
    members: check(members).map((m: { user_id: string; profile: { display_name: string } | null }) => ({
      id: m.user_id,
      name: m.profile?.display_name ?? 'Someone',
    })),
    lists: check(lists),
    categories: check(categories),
    open: (check(open) as OccRow[]).map(
      (o): OpenTask => ({
        occurrence_id: o.id,
        task_id: o.task.id as string,
        title: o.task.title as string,
        list_id: o.task.list_id as string,
        category_id: o.task.category_id as string | null,
        needs_both: o.task.needs_both as boolean,
        priority: o.task.priority as string,
        importance_votes: o.task.importance_votes as number,
        recurrence: o.task.recurrence as OpenTask['recurrence'],
        due_date: o.due_date,
        due_time: o.due_time,
        deadline: o.task.deadline as string | null,
        delay_count: o.delay_count,
        waiting_on_task_id: o.task.waiting_on_task_id as string | null,
        created_by: o.task.created_by as string,
        created_at: o.task.created_at as string,
        room_id: o.task.room_id as string | null,
      }),
    ),
    events: check(events) as CompletionEvent[],
  }
}

export type AgentPrefs = {
  members: string[]
  /** People who have this agent on (no row = on, with the default schedule). */
  enabled: (agentId: string) => string[]
  schedule: (agentId: string, userId: string) => AgentSchedule
  /** A person's own settings for an agent, e.g. fitness goals; {} when none. */
  config: (agentId: string, userId: string) => unknown
  aiSummaries: Set<string>
  /** People who want their briefing as a phone notification. */
  briefingPush: Set<string>
  /** People who want Claude to pick their top jobs each morning. */
  aiPriorities: Set<string>
}

export async function loadPrefs(db: SupabaseClient, householdId: string): Promise<AgentPrefs> {
  const members = await db.from('household_members').select('user_id').eq('household_id', householdId)
  const ids = (check(members) as { user_id: string }[]).map((m) => m.user_id)
  const [settings, prefs] = await Promise.all([
    db.from('agent_settings').select('user_id, agent_id, enabled, schedule, config').eq('household_id', householdId),
    // user_preferences has no household_id; these ids are this household's members.
    db.from('user_preferences').select('user_id, ai_summaries, briefing_push, ai_priorities').in('user_id', ids),
  ])
  const rows = check(settings) as { user_id: string; agent_id: string; enabled: boolean; schedule: AgentSchedule; config: unknown }[]
  const row = (agentId: string, userId: string) => rows.find((r) => r.agent_id === agentId && r.user_id === userId)
  const prefRows = check(prefs) as { user_id: string; ai_summaries: boolean; briefing_push: boolean; ai_priorities: boolean }[]
  return {
    members: ids,
    enabled: (agentId) => ids.filter((id) => row(agentId, id)?.enabled ?? true),
    schedule: (agentId, userId) => row(agentId, userId)?.schedule ?? 'daily',
    config: (agentId, userId) => row(agentId, userId)?.config ?? {},
    aiSummaries: new Set(prefRows.filter((p) => p.ai_summaries).map((p) => p.user_id)),
    briefingPush: new Set(prefRows.filter((p) => p.briefing_push).map((p) => p.user_id)),
    aiPriorities: new Set(prefRows.filter((p) => p.ai_priorities).map((p) => p.user_id)),
  }
}

export async function loadWedding(db: SupabaseClient, householdId: string, ctx: TaskContext): Promise<WeddingInput> {
  const [settings, budget, suppliers, guests] = await Promise.all([
    db.from('wedding_settings').select('wedding_date, wedding_date_approx, task_category_id').eq('household_id', householdId).maybeSingle(),
    db.from('wedding_budget_items').select('id, name, category, budget_minor, paid_minor, due_date, supplier_id').eq('household_id', householdId),
    db.from('wedding_suppliers').select('id, role, name').eq('household_id', householdId),
    db.from('wedding_guests').select('rsvp').eq('household_id', householdId),
  ])
  const s = check(settings) as { wedding_date: string | null; wedding_date_approx: boolean; task_category_id: string | null } | null
  const categoryId = s?.task_category_id ?? null
  // How many checklist tasks are done, counted rather than loaded.
  let doneCount = 0
  if (categoryId) {
    const done = await db
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('household_id', householdId)
      .eq('category_id', categoryId)
      .eq('status', 'completed')
      .is('archived_at', null)
    if (done.error) throw new Error(done.error.message)
    doneCount = done.count ?? 0
  }
  return {
    today: ctx.today,
    date: s?.wedding_date ?? null,
    dateApprox: s?.wedding_date_approx ?? false,
    categoryId,
    budget: (check(budget) as WeddingInput['budget']).map((b) => ({ ...b, budget_minor: Number(b.budget_minor), paid_minor: Number(b.paid_minor) })),
    suppliers: check(suppliers),
    guests: check(guests),
    checklist: { open: categoryId ? ctx.open.filter((t) => t.category_id === categoryId) : [], done: doneCount },
  }
}

export async function loadLanguages(db: SupabaseClient, householdId: string): Promise<{ study: Study[]; progress: Progress[] }> {
  const [study, progress] = await Promise.all([
    db.from('language_study').select('user_id, language, active').eq('household_id', householdId),
    db
      .from('language_progress')
      .select('user_id, language, item, learned_on, due_on, interval_days, lapses, last_reviewed_on')
      .eq('household_id', householdId)
      .limit(20000),
  ])
  return { study: check(study), progress: check(progress) }
}

export async function loadSessions(db: SupabaseClient, householdId: string, today: string, days: number): Promise<Session[]> {
  return check(
    await db
      .from('health_exercise_sessions')
      .select('user_id, description, started_at, duration_minutes')
      .eq('household_id', householdId)
      .gte('started_at', `${addDays(today, -days)}T00:00:00Z`)
      .limit(2000),
  )
}

export async function loadRooms(db: SupabaseClient, householdId: string): Promise<{ id: string; name: string }[]> {
  return check(await db.from('task_rooms').select('id, name').eq('household_id', householdId).order('sort_order'))
}

/**
 * What net worth needs, as the Finances page works it out: accounts counted in
 * net worth, their recorded balances, and transactions as account, date and
 * amount only (no description, category or kind: Finance never looks at spending).
 */
export async function loadFinance(db: SupabaseClient, householdId: string): Promise<{ accounts: FinAccount[]; snapshots: FinSnapshot[]; transactions: FinTx[] }> {
  const accounts = check(
    await db
      .from('financial_accounts')
      .select('id, account_type, ownership, owner_id, opening_balance_minor, opening_date')
      .eq('household_id', householdId)
      .is('archived_at', null)
      .eq('include_in_net_worth', true)
      .eq('currency', 'GBP'),
  ) as FinAccount[]
  const ids = accounts.map((a) => a.id)
  if (!ids.length) return { accounts: [], snapshots: [], transactions: [] }
  const [snapshots, transactions] = await Promise.all([
    db.from('account_balance_history').select('account_id, as_of, balance_minor, source, created_at').eq('household_id', householdId).in('account_id', ids).limit(20000),
    db.from('financial_transactions').select('account_id, occurred_on, amount_minor, created_at').eq('household_id', householdId).in('account_id', ids).limit(100000),
  ])
  const n = <T extends object>(rows: T[], key: keyof T) => rows.map((r) => ({ ...r, [key]: Number(r[key]) }))
  return {
    accounts: n(accounts, 'opening_balance_minor'),
    snapshots: n(check(snapshots) as FinSnapshot[], 'balance_minor'),
    transactions: n(check(transactions) as FinTx[], 'amount_minor'),
  }
}

export async function loadRenewals(db: SupabaseClient, householdId: string): Promise<Renewal[]> {
  return check(await db.from('renewals').select('id, name, owner_id, expires_on, warn_days, every_months').eq('household_id', householdId).limit(500))
}

export async function loadTrips(db: SupabaseClient, householdId: string, today: string): Promise<Trip[]> {
  return check(
    await db
      .from('trips')
      .select('id, name, owner_id, starts_on, ends_on, abroad, transport, stay, insurance, time_off')
      .eq('household_id', householdId)
      .gte('starts_on', today)
      .limit(200),
  )
}

export async function loadGoals(db: SupabaseClient, householdId: string): Promise<Goal[]> {
  return check(
    await db
      .from('career_goals')
      .select('id, user_id, title, target_date, review_days, last_reviewed_on, created_at, done_at')
      .eq('household_id', householdId)
      .limit(200),
  )
}

const titleKey = (title: string) => title.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * The household's connected calendars from yesterday to a week ahead: times,
 * titles and whose calendar only (descriptions and locations are dropped
 * here). Titles hidden in Settings stay hidden, as do calendars switched off
 * for planning (e.g. Birthdays). Empty when none is connected.
 */
export async function loadCalendar(db: SupabaseClient, householdId: string, today: string): Promise<CalEvent[]> {
  const serviceAccount = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
  if (!serviceAccount) return []
  const rows = check(
    await db
      .from('calendar_integrations')
      .select('google_calendar_id, owner_id, hidden_event_titles')
      .eq('household_id', householdId)
      .eq('enabled', true)
      .eq('use_for_agents', true)
      .eq('mode', 'service_account'),
  ) as { google_calendar_id: string; owner_id: string | null; hidden_event_titles: string[] | null }[]
  if (!rows.length) return []
  const token = await googleAccessToken(serviceAccount, CALENDAR_SCOPE)
  const timeMin = `${addDays(today, -1)}T00:00:00Z`
  const timeMax = `${addDays(today, 8)}T00:00:00Z`
  const lists = await Promise.all(
    rows.map(async (row) => {
      const hidden = new Set((row.hidden_event_titles ?? []).map(titleKey))
      return (await listEvents(token, row.google_calendar_id, timeMin, timeMax))
        .filter((e) => e.status !== 'cancelled' && !hidden.has(titleKey(e.summary ?? '')))
        .map((e): CalEvent => ({
          owner_id: row.owner_id,
          title: e.summary?.trim() || '(No title)',
          start: (e.start.dateTime ?? e.start.date)!,
          end: (e.end.dateTime ?? e.end.date)!,
          allDay: Boolean(e.start.date),
        }))
    }),
  )
  return lists.flat()
}
