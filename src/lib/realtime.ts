import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { supabase } from './supabase'

// Which query-key roots to refresh when a table changes. Realtime enforces RLS
// per subscriber, so each person only receives changes they are allowed to see.
export const REALTIME_TABLES: Record<string, string[]> = {
  tasks: ['tasks'],
  task_occurrences: ['tasks'],
  task_completion_events: ['tasks'],
  task_comments: ['tasks'],
  task_subtasks: ['tasks'],
  task_categories: ['tasks'],
  task_rooms: ['tasks'],
  financial_accounts: ['finances'],
  financial_transactions: ['finances'],
  account_balance_history: ['finances'],
  budgets: ['finances'],
  savings_goals: ['finances'],
  finance_categories: ['finances'],
  feed_posts: ['feed'],
  feed_comments: ['feed'],
  feed_reads: ['feed'],
  feed_events: ['feed'],
  feed_sources: ['feed'],
  health_measurements: ['health'],
  health_exercise_sessions: ['health'],
  health_periods: ['health'],
  takeaways: ['health'],
  language_study: ['languages'],
  language_progress: ['languages'],
  investment_holdings: ['investments'],
  investment_settings: ['investments'],
  calendar_integrations: ['calendar'],
  agent_settings: ['agents'],
  agent_runs: ['agents'],
  agent_suggestions: ['agents'],
  agent_briefings: ['agents'],
  renewals: ['agents'],
  trips: ['agents'],
  career_goals: ['agents'],
  ai_picks: ['agents'],
  ai_headlines: ['agents'],
  people: ['people'],
  meals: ['meals'],
  shopping_items: ['meals'],
  shopping_list_runs: ['meals'],
  recipes: ['meals'],
  meal_wishes: ['meals'],
  meal_availability: ['meals'],
  meal_slot_notes: ['meals'],
  meal_pantry: ['meals'],
  wedding_venues: ['wedding'],
  tt_profile: ['tt'],
  tt_rankings: ['tt'],
  tt_players: ['tt'],
  tt_player_notes: ['tt'],
  tt_employers: ['tt'],
  tt_sessions: ['tt'],
  tt_snapshots: ['tt'],
  hustle_settings: ['hustles'],
  hustles: ['hustles'],
  hustle_charges: ['hustles'],
  wants: ['shopping'],
  life_goals: ['goals'],
  profiles: ['household'],
}

/** Keeps every open screen in sync with changes made by the other person. */
export function useHouseholdRealtime(householdId: string) {
  const queryClient = useQueryClient()

  useEffect(() => {
    const pending = new Set<string>()
    let timer: ReturnType<typeof setTimeout> | undefined
    // One action (e.g. completing a task) touches several tables: batch them.
    const schedule = (roots: string[]) => {
      roots.forEach((r) => pending.add(r))
      clearTimeout(timer)
      timer = setTimeout(() => {
        pending.forEach((root) => queryClient.invalidateQueries({ queryKey: [root] }))
        pending.clear()
      }, 300)
    }

    let channel = supabase.channel(`household:${householdId}`)
    for (const [table, roots] of Object.entries(REALTIME_TABLES)) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: table === 'profiles' ? undefined : `household_id=eq.${householdId}` },
        () => schedule(roots),
      )
    }

    let wasConnected = false
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        // After a reconnect we may have missed events: refresh everything.
        if (wasConnected) queryClient.invalidateQueries()
        wasConnected = true
      }
    })

    return () => {
      clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [householdId, queryClient])
}
