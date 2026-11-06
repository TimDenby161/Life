import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Json } from '@/lib/database.types'
import { supabase, type Tables } from '@/lib/supabase'
import { unwrap } from '@/lib/utils'
import { useUserId } from '@/modules/auth/AuthProvider'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import type { AgentSchedule } from '../../../supabase/functions/_shared/agents/registry.ts'

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

export const useRunAgent = () =>
  useAgentMutation(async (_h, agentId: string): Promise<RunResult> => {
    const { data, error } = await supabase.functions.invoke<RunResult>('agents', { body: { agent: agentId } })
    if (error) {
      // Non-2xx responses still carry our JSON body.
      const body = await (error as { context?: Response }).context?.json?.().catch(() => null)
      return body?.status ? (body as RunResult) : { status: 'error', message: 'The agents service could not be reached.' }
    }
    return data ?? { status: 'error', message: 'No response.' }
  })
