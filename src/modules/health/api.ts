import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, type Tables } from '@/lib/supabase'
import { fetchAllPages, unwrap } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import type { Visibility } from './lib/metrics'

export type MetricDefinition = Tables<'health_metric_definitions'>
export type Measurement = Tables<'health_measurements'>
export type ExerciseSession = Tables<'health_exercise_sessions'>
export type HealthNote = Tables<'health_notes'>
export type CategoryVisibility = Tables<'health_category_visibility'>

// Everything below is filtered by RLS: a partner's private rows never arrive.
export const healthKeys = {
  all: ['health'] as const,
  definitions: ['health', 'definitions'] as const,
  measurements: ['health', 'measurements'] as const,
  exercise: ['health', 'exercise'] as const,
  notes: ['health', 'notes'] as const,
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

export const useHealthNotes = () =>
  useQuery({ queryKey: healthKeys.notes, queryFn: async () => unwrap(await supabase.from('health_notes').select('*').order('noted_on', { ascending: false }).limit(200)) })

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
  useHealthMutation(async (h, s: Omit<ExerciseSession, 'id' | 'household_id' | 'user_id' | 'created_at' | 'updated_at' | 'source' | 'external_id'>) =>
    unwrap(await supabase.from('health_exercise_sessions').insert({ ...s, household_id: h })),
  )
export const useDeleteExercise = () =>
  useHealthMutation(async (_h, id: string) => unwrap(await supabase.from('health_exercise_sessions').delete().eq('id', id)))

export const useAddNote = () =>
  useHealthMutation(async (h, n: { noted_on: string; title: string; body: string | null; visibility: Visibility }) =>
    unwrap(await supabase.from('health_notes').insert({ ...n, household_id: h })),
  )
export const useDeleteNote = () => useHealthMutation(async (_h, id: string) => unwrap(await supabase.from('health_notes').delete().eq('id', id)))

export const useSetCategoryShared = () =>
  useHealthMutation(async (h, a: { category: string; shared: boolean }) =>
    unwrap(await supabase.from('health_category_visibility').upsert({ household_id: h, category: a.category, shared: a.shared }, { onConflict: 'user_id,category' })),
  )

export const useCreateMetric = () =>
  useHealthMutation(async (h, a: { ownerId: string; name: string; unit: string; decimals: number; aggregation: 'latest' | 'sum' | 'average' }) => {
    const key = `${a.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'metric'}_${Math.random().toString(36).slice(2, 6)}`
    return unwrap(
      await supabase
        .from('health_metric_definitions')
        .insert({ household_id: h, owner_id: a.ownerId, key, name: a.name, unit: a.unit, category: 'custom', decimals: a.decimals, aggregation: a.aggregation })
        .select('*')
        .single(),
    )
  })
