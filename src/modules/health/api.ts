import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, type Tables } from '@/lib/supabase'
import { fetchAllPages, unwrap } from '@/lib/utils'
import { useUserId } from '@/modules/auth/AuthProvider'
import { useHousehold } from '@/modules/household/HouseholdProvider'

export type MetricDefinition = Tables<'health_metric_definitions'>
export type Measurement = Tables<'health_measurements'>
export type ExerciseSession = Tables<'health_exercise_sessions'>
export type Period = Tables<'health_periods'>
export type Takeaway = Tables<'takeaways'>

// Everything below is filtered by RLS to the household. Both members see all of it.
export const healthKeys = {
  all: ['health'] as const,
  definitions: ['health', 'definitions'] as const,
  measurements: ['health', 'measurements'] as const,
  exercise: ['health', 'exercise'] as const,
  periods: ['health', 'periods'] as const,
  takeaways: ['health', 'takeaways'] as const,
}

export const useMetricDefinitions = () =>
  useQuery({ queryKey: healthKeys.definitions, queryFn: async () => unwrap(await supabase.from('health_metric_definitions').select('*').order('sort_order').order('name')) })

export const useMeasurements = () =>
  useQuery({
    queryKey: healthKeys.measurements,
    queryFn: () => fetchAllPages<Measurement>((a, b) => supabase.from('health_measurements').select('*').order('measured_at').order('id').range(a, b)),
  })

export const useExerciseSessions = () =>
  useQuery({ queryKey: healthKeys.exercise, queryFn: async () => unwrap(await supabase.from('health_exercise_sessions').select('*').order('started_at', { ascending: false }).limit(500)) })

export const usePeriods = () =>
  useQuery({ queryKey: healthKeys.periods, queryFn: async () => unwrap(await supabase.from('health_periods').select('*').order('started_on', { ascending: false }).limit(200)) })

/** The last eight weeks of takeaways, newest first. */
export const useTakeaways = () =>
  useQuery({
    queryKey: healthKeys.takeaways,
    queryFn: async () => {
      const since = new Date(Date.now() - 56 * 86_400_000).toISOString().slice(0, 10)
      return unwrap(await supabase.from('takeaways').select('*').gte('eaten_on', since).order('eaten_on', { ascending: false }).order('created_at', { ascending: false }))
    },
  })

function useHealthMutation<TArgs>(fn: (householdId: string, args: TArgs) => Promise<unknown>) {
  const { household } = useHousehold()
  const qc = useQueryClient()
  return useMutation({ mutationFn: (args: TArgs) => fn(household.id, args), onSuccess: () => qc.invalidateQueries({ queryKey: healthKeys.all }) })
}

export const useAddMeasurement = () =>
  useHealthMutation(async (h, m: { metric_id: string; value: number; measured_at: string; notes?: string | null }) =>
    unwrap(await supabase.from('health_measurements').insert({ ...m, household_id: h })),
  )
export const useDeleteMeasurement = () =>
  useHealthMutation(async (_h, id: string) => unwrap(await supabase.from('health_measurements').delete().eq('id', id)))

/** Logs a session for each person given (one each when you did it together). */
export const useAddExercise = () =>
  useHealthMutation(async (h, { people, ...s }: { people: string[]; description: string; started_at: string; duration_minutes: number }) =>
    unwrap(await supabase.from('health_exercise_sessions').insert(people.map((user_id) => ({ ...s, user_id, household_id: h })))),
  )
export const useDeleteExercise = () =>
  useHealthMutation(async (_h, id: string) => unwrap(await supabase.from('health_exercise_sessions').delete().eq('id', id)))

export const useAddPeriod = () =>
  useHealthMutation(async (h, p: { started_on: string; ended_on: string | null; notes: string | null }) =>
    unwrap(await supabase.from('health_periods').insert({ ...p, household_id: h })),
  )
export const useUpdatePeriod = () =>
  useHealthMutation(async (_h, a: { id: string; patch: { started_on?: string; ended_on?: string | null; notes?: string | null } }) =>
    unwrap(await supabase.from('health_periods').update(a.patch).eq('id', a.id)),
  )
export const useDeletePeriod = () => useHealthMutation(async (_h, id: string) => unwrap(await supabase.from('health_periods').delete().eq('id', id)))

/** A takeaway, logged as mine: on my own, or together (counts against the joint limit). */
export const useAddTakeaway = () =>
  useHealthMutation(async (h, t: { eaten_on: string; shared: boolean }) => unwrap(await supabase.from('takeaways').insert({ ...t, household_id: h })))
export const useDeleteTakeaway = () => useHealthMutation(async (_h, id: string) => unwrap(await supabase.from('takeaways').delete().eq('id', id)))

/** Whether Home asks me for the morning check-in (weight and sleep). Each person's own, on by default. */
export const useMorningCheckInOn = () => {
  const userId = useUserId()
  return useQuery({
    queryKey: [...healthKeys.all, 'check-in-on', userId],
    queryFn: async () =>
      unwrap(await supabase.from('user_preferences').select('morning_check_in').eq('user_id', userId).maybeSingle())?.morning_check_in ?? true,
  })
}

export const useSetMorningCheckIn = () => {
  const userId = useUserId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (on: boolean) => unwrap(await supabase.from('user_preferences').update({ morning_check_in: on }).eq('user_id', userId)),
    onSuccess: () => qc.invalidateQueries({ queryKey: healthKeys.all }),
  })
}

// --- Exercise week plan (Coach page) ---------------------------------------

export type PlanCell = Tables<'exercise_plan'>
export const planKeys = {
  week: (monday: string) => ['health', 'plan', monday] as const,
  goals: ['health', 'plan-goals'] as const,
}

/** The seven days from this Monday. */
export const useExercisePlan = (monday: string, sunday: string) =>
  useQuery({
    queryKey: planKeys.week(monday),
    queryFn: async () => unwrap(await supabase.from('exercise_plan').select('*').gte('day', monday).lte('day', sunday)),
  })

/** Each member's weekly activity goals, for the coach's draft. */
export const useExerciseGoals = () =>
  useQuery({ queryKey: planKeys.goals, queryFn: async () => unwrap(await supabase.rpc('exercise_goals')) })

type BoxWrite = { id?: string; activity: string | null; remove?: boolean }

/**
 * Save a day from the box dialog: the person's own box and the shared one
 * together. activity null on the person = Rest; `remove` deletes the row.
 */
export const useSaveDay = () =>
  useHealthMutation(async (h, { day, person, mine, both }: { day: string; person: string; mine: BoxWrite; both?: BoxWrite }) => {
    const write = async (owner_id: string | null, w: BoxWrite) => {
      if (w.remove) return w.id ? unwrap(await supabase.from('exercise_plan').delete().eq('id', w.id)) : null
      return w.id
        ? unwrap(await supabase.from('exercise_plan').update({ activity: w.activity }).eq('id', w.id))
        : unwrap(await supabase.from('exercise_plan').insert({ household_id: h, day, owner_id, activity: w.activity }))
    }
    await write(person, mine)
    if (both) await write(null, both)
  })

/** What calendar titles mean ("GS1" = TT match; activity null = not exercise). */
export const useExerciseNames = () =>
  useQuery({ queryKey: ['health', 'names'], queryFn: async () => unwrap(await supabase.from('exercise_names').select('*').order('phrase')) })

export const useSaveExerciseName = () =>
  useHealthMutation(async (h, n: { owner_id: string | null; phrase: string; activity: string | null }) =>
    unwrap(await supabase.from('exercise_names').insert({ ...n, household_id: h, phrase: n.phrase.trim().slice(0, 60), activity: n.activity?.trim().slice(0, 40) || null })),
  )

export const useDeleteExerciseName = () =>
  useHealthMutation(async (_h, id: string) => unwrap(await supabase.from('exercise_names').delete().eq('id', id)))
