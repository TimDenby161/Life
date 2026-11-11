import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Json } from '@/lib/database.types'
import { supabase, type Tables } from '@/lib/supabase'
import { unwrap } from '@/lib/utils'
import { useUserId } from '@/modules/auth/AuthProvider'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import type { AgentSchedule } from '../../../supabase/functions/_shared/agents/registry.ts'
import { fromB64url } from '../../../supabase/functions/_shared/push.ts'
import type { AiPick } from './lib/aiOrder'
import { thisDeviceEndpoint, workerRegistration } from './push'

export type AgentSetting = Tables<'agent_settings'>
export type AgentRun = Tables<'agent_runs'>
export type Suggestion = Tables<'agent_suggestions'>
export type Briefing = Tables<'agent_briefings'>
export type AgentAction = Tables<'agent_actions'>

export const agentKeys = {
  all: ['agents'] as const,
  settings: ['agents', 'settings'] as const,
  suggestions: ['agents', 'suggestions'] as const,
  briefing: ['agents', 'briefing'] as const,
  runs: ['agents', 'runs'] as const,
  actions: ['agents', 'actions'] as const,
  prefs: ['agents', 'prefs'] as const,
  push: ['agents', 'push'] as const,
}

/** My settings, one row per agent I've changed (no row = on, daily). */
export const useAgentSettings = () =>
  useQuery({ queryKey: agentKeys.settings, queryFn: async () => unwrap(await supabase.from('agent_settings').select('*')) })

/** Open suggestions I can see: pending, and snoozed ones so they can be woken early. */
export const useSuggestions = () =>
  useQuery({
    queryKey: agentKeys.suggestions,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('agent_suggestions')
          .select('*')
          .in('status', ['pending', 'snoozed'])
          .order('severity', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(200),
      ),
  })

/** My most recent briefing (daily or weekly). */
export const useLatestBriefing = () =>
  useQuery({
    queryKey: agentKeys.briefing,
    queryFn: async () =>
      unwrap(await supabase.from('agent_briefings').select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle()),
  })

export const useAgentRuns = () =>
  useQuery({
    queryKey: agentKeys.runs,
    queryFn: async () => unwrap(await supabase.from('agent_runs').select('*').order('created_at', { ascending: false }).limit(100)),
  })

export const useAgentActions = () =>
  useQuery({
    queryKey: agentKeys.actions,
    queryFn: async () => unwrap(await supabase.from('agent_actions').select('*').order('created_at', { ascending: false }).limit(100)),
  })

export const useAiSummaries = () => {
  const userId = useUserId()
  return useQuery({
    queryKey: agentKeys.prefs,
    queryFn: async () =>
      unwrap(await supabase.from('user_preferences').select('ai_summaries').eq('user_id', userId).maybeSingle())?.ai_summaries ?? false,
  })
}

function useAgentMutation<TArgs, TResult = unknown>(fn: (householdId: string, args: TArgs) => Promise<TResult>, alsoTasks = false) {
  const { household } = useHousehold()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: TArgs) => fn(household.id, args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentKeys.all })
      if (alsoTasks) qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

/** The row is created on first change; RLS keeps it to my own. Update first, so a quick second change can't clash with the insert. */
export const useSaveAgentSetting = () =>
  useAgentMutation(async (householdId, s: { agentId: string; enabled: boolean; schedule: AgentSchedule; config?: Json }) => {
    const fields = { enabled: s.enabled, schedule: s.schedule, ...(s.config === undefined ? {} : { config: s.config }) }
    const updated = unwrap(await supabase.from('agent_settings').update(fields).eq('agent_id', s.agentId).select('agent_id'))
    if (updated.length) return
    const inserted = await supabase.from('agent_settings').insert({ ...fields, household_id: householdId, agent_id: s.agentId })
    // Another save made the row in between: fall back to updating it.
    if (inserted.error?.code === '23505') unwrap(await supabase.from('agent_settings').update(fields).eq('agent_id', s.agentId))
    else unwrap(inserted)
  })

/** Saves my settings for one agent's goals, keeping whether it's on and its schedule. */
export const useSaveAgentConfig = (agentId: string, row: AgentSetting | undefined) => {
  const save = useSaveAgentSetting()
  const mutate = (config: Json, options?: Parameters<typeof save.mutate>[1]) =>
    save.mutate({ agentId, enabled: row?.enabled ?? true, schedule: (row?.schedule ?? 'daily') as AgentSchedule, config }, options)
  return { mutate, isPending: save.isPending }
}

export const useAiPriorities = () => {
  const userId = useUserId()
  return useQuery({
    queryKey: [...agentKeys.prefs, 'priorities'],
    queryFn: async () =>
      unwrap(await supabase.from('user_preferences').select('ai_priorities').eq('user_id', userId).maybeSingle())?.ai_priorities ?? false,
  })
}

export const useSetAiPriorities = () => {
  const userId = useUserId()
  return useAgentMutation(async (_h, on: boolean) => {
    unwrap(await supabase.from('user_preferences').update({ ai_priorities: on }).eq('user_id', userId))
  })
}

export const useSetAiSummaries = () => {
  const userId = useUserId()
  return useAgentMutation(async (_h, on: boolean) => {
    unwrap(await supabase.from('user_preferences').update({ ai_summaries: on }).eq('user_id', userId))
  })
}

/** Approve (applies the action as me), dismiss, or snooze until a date. Returns the task created or changed. */
export const useRespond = () =>
  useAgentMutation(
    async (_h, r: { id: string; response: 'approve' | 'dismiss' | 'snooze'; snoozeUntil?: string }) =>
      unwrap(await supabase.rpc('respond_agent_suggestion', { p_suggestion_id: r.id, p_response: r.response, p_snooze_until: r.snoozeUntil })),
    true,
  )

export type RunResult = { status: 'ok' | 'recent' | 'error'; message?: string }

/** Calls the agents Edge Function as me. */
async function callAgents<T extends RunResult>(body: Record<string, string>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('agents', { body })
  if (error) {
    // Non-2xx responses still carry our JSON body.
    const parsed = await (error as { context?: Response }).context?.json?.().catch(() => null)
    return parsed?.status ? (parsed as T) : ({ status: 'error', message: 'The agents service could not be reached.' } as T)
  }
  return data ?? ({ status: 'error', message: 'No response.' } as T)
}

export const useRunAgent = () => useAgentMutation(async (_h, agentId: string) => callAgents<RunResult>({ agent: agentId }))

/** Whether my briefing comes as a notification, my registered devices, and whether this browser is one of them. */
export const usePushSettings = () => {
  const userId = useUserId()
  return useQuery({
    queryKey: agentKeys.push,
    queryFn: async () => {
      const [prefs, devices, endpoint] = await Promise.all([
        supabase.from('user_preferences').select('briefing_push').eq('user_id', userId).maybeSingle(),
        supabase.from('push_subscriptions').select('endpoint'),
        thisDeviceEndpoint().catch(() => null),
      ])
      const endpoints = unwrap(devices).map((d) => d.endpoint)
      return { on: unwrap(prefs)?.briefing_push ?? false, devices: endpoints.length, thisDevice: !!endpoint && endpoints.includes(endpoint) }
    },
  })
}

/**
 * On: subscribe this browser and register it, then switch on. `permission` is
 * requested in the tap handler itself, because iPhone only asks on a tap.
 * Off: switch off and forget all my devices.
 */
export const useSetBriefingPush = () => {
  const userId = useUserId()
  return useAgentMutation(async (householdId, r: { on: boolean; permission?: Promise<NotificationPermission> }) => {
    if (!r.on) {
      unwrap(await supabase.from('user_preferences').update({ briefing_push: false }).eq('user_id', userId))
      unwrap(await supabase.from('push_subscriptions').delete().eq('user_id', userId))
      return
    }
    if ((await r.permission) !== 'granted') throw new Error('Notifications are blocked for Life. Allow them in Settings, then try again.')
    const key = await callAgents<RunResult & { key?: string }>({ mode: 'push-key' })
    if (key.status !== 'ok' || !key.key) throw new Error(key.message ?? 'Notifications aren’t set up on the server yet.')
    const reg = await workerRegistration()
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(key.key) }))
    const { endpoint, keys } = sub.toJSON()
    if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error('This browser didn’t give a notification address.')
    unwrap(await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint))
    unwrap(await supabase.from('push_subscriptions').insert({ household_id: householdId, endpoint, p256dh: keys.p256dh, auth: keys.auth }))
    unwrap(await supabase.from('user_preferences').update({ briefing_push: true }).eq('user_id', userId))
  })
}

export const useSendTestPush = () => useAgentMutation(async () => callAgents<RunResult>({ mode: 'push-test' }))

export type RenewalRow = Tables<'renewals'>

/** The household's renewals, soonest first (Life Admin reads the same list). */
export const useRenewals = () =>
  useQuery({
    queryKey: [...agentKeys.all, 'renewals'],
    queryFn: async () => unwrap(await supabase.from('renewals').select('*').order('expires_on')),
  })

export type RenewalInput = Pick<RenewalRow, 'name' | 'owner_id' | 'expires_on' | 'warn_days' | 'every_months'>

export const useSaveRenewal = () =>
  useAgentMutation(async (householdId, r: RenewalInput & { id?: string }) => {
    const { id, ...fields } = r
    if (id) unwrap(await supabase.from('renewals').update(fields).eq('id', id))
    else unwrap(await supabase.from('renewals').insert({ ...fields, household_id: householdId }))
  })

export const useDeleteRenewal = () =>
  useAgentMutation(async (_h, id: string) => {
    unwrap(await supabase.from('renewals').delete().eq('id', id))
  })

export type TripRow = Tables<'trips'>
export type TripInput = Pick<
  TripRow,
  'name' | 'owner_id' | 'starts_on' | 'ends_on' | 'abroad' | 'transport' | 'stay' | 'insurance' | 'time_off' | 'cost_minor' | 'paid_minor' | 'plan_url' | 'confirmed'
>

/** Trips still to come or under way, soonest first. */
export const useTrips = () =>
  useQuery({
    queryKey: [...agentKeys.all, 'trips'],
    queryFn: async () => unwrap(await supabase.from('trips').select('*').gte('ends_on', new Date().toISOString().slice(0, 10)).order('starts_on')),
  })

export const useSaveTrip = () =>
  useAgentMutation(async (householdId, t: Partial<TripInput> & { id?: string }) => {
    const { id, ...fields } = t
    if (id) unwrap(await supabase.from('trips').update(fields).eq('id', id))
    else unwrap(await supabase.from('trips').insert({ ...(fields as TripInput), household_id: householdId }))
  })

export const useDeleteTrip = () =>
  useAgentMutation(async (_h, id: string) => {
    unwrap(await supabase.from('trips').delete().eq('id', id))
  })

export type GoalRow = Tables<'career_goals'>

/** Both of our goals (each person edits only their own). */
export const useGoals = () =>
  useQuery({
    queryKey: [...agentKeys.all, 'goals'],
    queryFn: async () => unwrap(await supabase.from('career_goals').select('*').order('created_at')),
  })

export const useSaveGoal = () =>
  useAgentMutation(
    async (
      householdId,
      g: { id?: string; title?: string; target_date?: string | null; review_days?: number; last_reviewed_on?: string | null; done_at?: string | null },
    ) => {
      const { id, ...fields } = g
      if (id) unwrap(await supabase.from('career_goals').update(fields).eq('id', id))
      else {
        const { done_at: _done, ...insert } = fields
        unwrap(await supabase.from('career_goals').insert({ ...insert, title: insert.title ?? '', household_id: householdId }))
      }
    },
  )

export const useDeleteGoal = () =>
  useAgentMutation(async (_h, id: string) => {
    unwrap(await supabase.from('career_goals').delete().eq('id', id))
  })

/** Today's AI picks for every Top jobs tab (a member's id, or 'together'). */
export const useAiPicks = (day: string) =>
  useQuery({
    queryKey: [...agentKeys.all, 'picks', day],
    queryFn: async () => {
      const rows = unwrap(await supabase.from('ai_picks').select('view, picks').eq('day', day))
      return new Map(rows.map((r) => [r.view, r.picks as AiPick[]]))
    },
  })

/** Today's one-line headlines from the morning routine, by story address. */
export const useShortHeadlines = (day: string) =>
  useQuery({
    queryKey: [...agentKeys.all, 'headlines', day],
    queryFn: async () => {
      const row = unwrap(await supabase.from('ai_headlines').select('items').eq('day', day).maybeSingle())
      return new Map(((row?.items ?? []) as { url: string; short: string }[]).map((h) => [h.url, h.short]))
    },
  })
