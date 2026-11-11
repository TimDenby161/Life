import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { addDaysISO, todayISO } from '@/lib/dates'
import { supabase, type Tables } from '@/lib/supabase'
import { unwrap } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { completeOccurrence, createTask, taskKeys } from '@/modules/tasks/api'
import type { Average, Standing } from '../../../supabase/functions/_shared/tableTennis.ts'

export type TtProfile = Tables<'tt_profile'>
export type TtRanking = Tables<'tt_rankings'>
export type TtPlayer = Tables<'tt_players'>
export type TtNote = Tables<'tt_player_notes'>
export type TtEmployer = Tables<'tt_employers'>
export type TtSession = Tables<'tt_sessions'>
export type TtSnapshot = Tables<'tt_snapshots'>

export const ttKeys = {
  all: ['tt'] as const,
  live: ['tt', 'live'] as const,
  profile: ['tt', 'profile'] as const,
  rankings: ['tt', 'rankings'] as const,
  players: ['tt', 'players'] as const,
  notes: ['tt', 'notes'] as const,
  snapshots: ['tt', 'snapshots'] as const,
  employers: ['tt', 'employers'] as const,
  sessions: ['tt', 'sessions'] as const,
}

type Fail = { status: 'error'; message: string }
export type LiveResult = { status: 'ok'; day: string; records: Average[]; tables: { league: string; divisionId: number; rows: Standing[] }[] } | Fail
export type SearchResult = { status: 'ok'; players: { ttUserId: string; name: string; where: string[] }[] } | Fail

async function callFunction<T extends { status: string }>(body: Record<string, unknown>): Promise<T | Fail> {
  const { data, error } = await supabase.functions.invoke<T>('table-tennis', { body })
  if (error) {
    const parsed = await (error as { context?: Response }).context?.json?.().catch(() => null)
    return parsed?.status ? (parsed as T) : { status: 'error', message: 'TT Leagues could not be reached.' }
  }
  return data ?? { status: 'error', message: 'Empty response' }
}

/** This season's records and league tables, fetched through the table-tennis function (TT Leagues can't be read from a browser). */
export const useLive = (enabled = true) =>
  useQuery({ queryKey: ttKeys.live, queryFn: () => callFunction<LiveResult>({ mode: 'refresh' }), staleTime: 30 * 60_000, enabled })

export const useSearchPlayers = () => useMutation({ mutationFn: (q: string) => callFunction<SearchResult>({ mode: 'search', q }) })

export const useProfiles = () => useQuery({ queryKey: ttKeys.profile, queryFn: async () => unwrap(await supabase.from('tt_profile').select('*')) })
export const useRankings = () =>
  useQuery({ queryKey: ttKeys.rankings, queryFn: async () => unwrap(await supabase.from('tt_rankings').select('*').order('on_date', { ascending: false })) })
export const usePlayers = () => useQuery({ queryKey: ttKeys.players, queryFn: async () => unwrap(await supabase.from('tt_players').select('*').order('name')) })
export const useNotes = () =>
  useQuery({ queryKey: ttKeys.notes, queryFn: async () => unwrap(await supabase.from('tt_player_notes').select('*').order('created_at', { ascending: false })) })
/** The last 120 days of league snapshots: enough to show how a player has moved this season. */
export const useSnapshots = () =>
  useQuery({
    queryKey: ttKeys.snapshots,
    queryFn: async () => unwrap(await supabase.from('tt_snapshots').select('*').gte('day', addDaysISO(todayISO(), -120)).order('day')),
  })
export const useEmployers = () => useQuery({ queryKey: ttKeys.employers, queryFn: async () => unwrap(await supabase.from('tt_employers').select('*').order('name')) })
export const useSessions = () =>
  useQuery({
    queryKey: ttKeys.sessions,
    queryFn: async () => unwrap(await supabase.from('tt_sessions').select('*').order('day', { ascending: false }).order('start_time', { ascending: false }).limit(300)),
  })

function useTtMutation<TArgs>(fn: (householdId: string, me: string, args: TArgs) => Promise<unknown>) {
  const { household, me } = useHousehold()
  const qc = useQueryClient()
  return useMutation({ mutationFn: (args: TArgs) => fn(household.id, me.id, args), onSuccess: () => qc.invalidateQueries({ queryKey: ttKeys.all }) })
}

/**
 * Says which TT Leagues player you are. The first time, it also adds a monthly
 * "Update national ranking" task to your own list, so the app asks for it.
 */
export function useSaveProfile() {
  const { household, me } = useHousehold()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ttUserId, name, existing }: { ttUserId: string; name: string; existing: TtProfile | null }) => {
      let taskId = existing?.ranking_task_id ?? null
      if (!taskId) {
        const list = unwrap(await supabase.from('task_lists').select('id').eq('kind', 'personal').eq('owner_id', me.id).single())
        const task = await createTask(household.id, {
          list_id: list.id,
          title: 'Update national ranking',
          description: 'Add this month’s Table Tennis England ranking on the Table tennis page.',
          assignee_id: me.id,
          category_id: null,
          priority: 'normal',
          needs_both: false,
          due_date: todayISO(),
          due_time: null,
          recurrence: { freq: 'monthly', interval: 1, monthDay: Number(todayISO().slice(8, 10)) },
          last_done_on: null,
          room_id: null,
        })
        taskId = task.id
      }
      const row = { tt_user_id: ttUserId, tt_name: name, ranking_task_id: taskId }
      return existing
        ? unwrap(await supabase.from('tt_profile').update(row).eq('user_id', me.id))
        : unwrap(await supabase.from('tt_profile').insert({ ...row, household_id: household.id }))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ttKeys.all })
      qc.invalidateQueries({ queryKey: taskKeys.all })
    },
  })
}

/** Records this month's ranking and ticks off the ranking task if it's due. */
export function useAddRanking() {
  const { household, me } = useHousehold()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ ranking, rating, taskId }: { ranking: number; rating: number | null; taskId: string | null }) => {
      const today = todayISO()
      // One a day: a second save today corrects the first.
      const existing = unwrap(await supabase.from('tt_rankings').select('id').eq('user_id', me.id).eq('on_date', today).maybeSingle())
      if (existing) unwrap(await supabase.from('tt_rankings').update({ ranking, rating }).eq('id', existing.id))
      else unwrap(await supabase.from('tt_rankings').insert({ household_id: household.id, on_date: today, ranking, rating }))
      if (!taskId) return
      const open = unwrap(await supabase.from('task_occurrences').select('id, due_date').eq('task_id', taskId).eq('status', 'open').maybeSingle())
      if (open && (!open.due_date || open.due_date <= addDaysISO(today, 7))) await completeOccurrence({ occurrenceId: open.id })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ttKeys.all })
      qc.invalidateQueries({ queryKey: taskKeys.all })
    },
  })
}

export const useAddPlayer = () =>
  useTtMutation(async (h, _me, p: { ttUserId: string; name: string }) => unwrap(await supabase.from('tt_players').insert({ household_id: h, tt_user_id: p.ttUserId, name: p.name })))
export const useDeletePlayer = () => useTtMutation(async (_h, _me, id: string) => unwrap(await supabase.from('tt_players').delete().eq('id', id)))
export const useAddNote = () =>
  useTtMutation(async (h, _me, n: { playerId: string; note: string }) => unwrap(await supabase.from('tt_player_notes').insert({ household_id: h, player_id: n.playerId, note: n.note.trim() })))
export const useDeleteNote = () => useTtMutation(async (_h, _me, id: string) => unwrap(await supabase.from('tt_player_notes').delete().eq('id', id)))

export const useSaveEmployer = () =>
  useTtMutation(async (h, _me, e: { id?: string; name: string; rate_minor: number }) =>
    e.id
      ? unwrap(await supabase.from('tt_employers').update({ name: e.name, rate_minor: e.rate_minor }).eq('id', e.id))
      : unwrap(await supabase.from('tt_employers').insert({ household_id: h, name: e.name, rate_minor: e.rate_minor })),
  )
export const useAddSession = () =>
  useTtMutation(async (h, _me, s: { employer_id: string; day: string; start_time: string; end_time: string; paid: boolean }) =>
    unwrap(
      await supabase
        .from('tt_sessions')
        .insert({ household_id: h, employer_id: s.employer_id, day: s.day, start_time: s.start_time, end_time: s.end_time, paid_on: s.paid ? todayISO() : null }),
    ),
  )
/** Marks sessions paid (today) or back to owed. */
export const useSetPaid = () =>
  useTtMutation(async (_h, _me, { ids, paid }: { ids: string[]; paid: boolean }) =>
    unwrap(await supabase.from('tt_sessions').update({ paid_on: paid ? todayISO() : null }).in('id', ids)),
  )
export const useDeleteSession = () => useTtMutation(async (_h, _me, id: string) => unwrap(await supabase.from('tt_sessions').delete().eq('id', id)))
