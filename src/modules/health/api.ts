import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, type Tables } from '@/lib/supabase'
import { fetchAllPages, unwrap } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import type { Visibility } from './lib/metrics'

export type MetricDefinition = Tables<'health_metric_definitions'>
export type Measurement = Tables<'health_measurements'>
export type ExerciseSession = Tables<'health_exercise_sessions'>
export type Period = Tables<'health_periods'>
export type CategoryVisibility = Tables<'health_category_visibility'>

// Everything below is filtered by RLS: a partner's private rows never arrive.
export const healthKeys = {
  all: ['health'] as const,
  definitions: ['health', 'definitions'] as const,
  measurements: ['health', 'measurements'] as const,
  exercise: ['health', 'exercise'] as const,
  periods: ['health', 'periods'] as const,
  trackPeriods: ['health', 'track-periods'] as const,
  visibility: ['health', 'visibility'] as const,
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

// Own row only (RLS), so this is always the signed-in person's setting.
export const useTrackPeriods = () =>
  useQuery({
    queryKey: healthKeys.trackPeriods,
    queryFn: async () => {
      const prefs = unwrap(await supabase.from('user_preferences').select('settings').maybeSingle())
      return (prefs?.settings as { track_periods?: boolean } | undefined)?.track_periods === true
    },
  })

export const useCategoryVisibility = () =>
  useQuery({ queryKey: healthKeys.visibility, queryFn: async () => unwrap(await supabase.from('health_category_visibility').select('*')) })

function useHealthMutation<TArgs>(fn: (householdId: string, args: TArgs) => Promise<unknown>) {
  const { household } = useHousehold()
  const qc = useQueryClient()
  return useMutation({ mutationFn: (args: TArgs) => fn(household.id, args), onSuccess: () => qc.invalidateQueries({ queryKey: healthKeys.all }) })
}

export const useAddMeasurement = () =>
  useHealthMutation(async (h, m: { metric_id: string; value: number; measured_at: string; notes?: string | null; visibility: Visibility }) =>
    unwrap(await supabase.from('health_measurements').insert({ ...m, household_id: h })),
  )
export const useUpdateMeasurement = () =>
  useHealthMutation(async (_h, a: { id: string; patch: { visibility?: Visibility; value?: number; notes?: string | null } }) =>
    unwrap(await supabase.from('health_measurements').update(a.patch).eq('id', a.id)),
  )
export const useDeleteMeasurement = () =>
  useHealthMutation(async (_h, id: string) => unwrap(await supabase.from('health_measurements').delete().eq('id', id)))

export const useAddExercise = () =>
  useHealthMutation(async (h, s: { description: string; started_at: string; duration_minutes: number; visibility: Visibility }) =>
    unwrap(await supabase.from('health_exercise_sessions').insert({ ...s, household_id: h })),
  )
export const useDeleteExercise = () =>
  useHealthMutation(async (_h, id: string) => unwrap(await supabase.from('health_exercise_sessions').delete().eq('id', id)))

export const useAddPeriod = () =>
  useHealthMutation(async (h, p: { started_on: string; ended_on: string | null; notes: string | null; visibility: Visibility }) =>
    unwrap(await supabase.from('health_periods').insert({ ...p, household_id: h })),
  )
export const useUpdatePeriod = () =>
  useHealthMutation(async (_h, a: { id: string; patch: { started_on?: string; ended_on?: string | null; notes?: string | null; visibility?: Visibility } }) =>
    unwrap(await supabase.from('health_periods').update(a.patch).eq('id', a.id)),
  )
export const useDeletePeriod = () => useHealthMutation(async (_h, id: string) => unwrap(await supabase.from('health_periods').delete().eq('id', id)))

export const useSetTrackPeriods = () =>
  useHealthMutation(async (_h, on: boolean) => {
    const prefs = unwrap(await supabase.from('user_preferences').select('user_id, settings').single())
    const settings = { ...(prefs.settings as Record<string, unknown>), track_periods: on }
    unwrap(await supabase.from('user_preferences').update({ settings }).eq('user_id', prefs.user_id))
  })

// Update-or-insert by hand (not upsert): an upsert also SETs household_id and
// category on conflict, and only `shared` is an updatable column.
export const useSetCategoryShared = () =>
  useHealthMutation(async (h, a: { category: string; shared: boolean }) => {
    const userId = (await supabase.auth.getSession()).data.session?.user.id
    const updated = unwrap(
      await supabase.from('health_category_visibility').update({ shared: a.shared }).eq('user_id', userId!).eq('category', a.category).select('category'),
    )
    if (!updated.length) unwrap(await supabase.from('health_category_visibility').insert({ household_id: h, category: a.category, shared: a.shared }))
  })
