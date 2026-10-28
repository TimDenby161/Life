import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, type Tables } from '@/lib/supabase'
import { fetchAllPages, unwrap } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'

export type MetricDefinition = Tables<'health_metric_definitions'>
export type Measurement = Tables<'health_measurements'>
export type ExerciseSession = Tables<'health_exercise_sessions'>
export type Period = Tables<'health_periods'>

// Everything below is filtered by RLS to the household. Both members see all of it.
export const healthKeys = {
  all: ['health'] as const,
  definitions: ['health', 'definitions'] as const,
  measurements: ['health', 'measurements'] as const,
  exercise: ['health', 'exercise'] as const,
  periods: ['health', 'periods'] as const,
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
