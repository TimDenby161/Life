import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { todayISO } from '@/lib/dates'
import { supabase, type Tables, type TablesUpdate } from '@/lib/supabase'
import { fetchAllPages, unwrap } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { useUserId } from '@/modules/auth/AuthProvider'
import { completeOccurrence, type Job, reopenOccurrence } from '@/modules/tasks/api'
import { learnedSchedule, reviewedSchedule } from './lib/srs'
import { type Kind, loadHsk } from './lib/vocab'

export type Study = Tables<'language_study'>
export type Progress = Tables<'language_progress'>
export type Language = 'zh'
export type StudySettings = Pick<Study, 'words_per_day' | 'characters_per_day' | 'start_level' | 'words_task_id' | 'characters_task_id' | 'review_task_id'>

// Both members can read everything here; each person only writes their own (RLS).
export const languageKeys = {
  all: ['languages'] as const,
  vocab: (language: Language) => ['languages', 'vocab', language] as const,
  study: ['languages', 'study'] as const,
  progress: ['languages', 'progress'] as const,
}

export const useVocab = (language: Language) =>
  useQuery({ queryKey: languageKeys.vocab(language), queryFn: loadHsk, staleTime: Infinity, gcTime: Infinity })

export const useStudy = () =>
  useQuery({ queryKey: languageKeys.study, queryFn: async () => unwrap(await supabase.from('language_study').select('*')) })

export const useProgress = () =>
  useQuery({
    queryKey: languageKeys.progress,
    queryFn: () => fetchAllPages<Progress>((a, b) => supabase.from('language_progress').select('*').order('created_at').order('id').range(a, b)),
  })

function useLanguageMutation<TArgs, TResult>(fn: (householdId: string, args: TArgs) => Promise<TResult>) {
  const { household } = useHousehold()
  const qc = useQueryClient()
  return useMutation({ mutationFn: (args: TArgs) => fn(household.id, args), onSuccess: () => qc.invalidateQueries({ queryKey: languageKeys.all }) })
}

/** Creates the person's settings row the first time, updates it after. */
export function useSaveStudy() {
  const userId = useUserId()
  return useLanguageMutation(async (h, { language, exists, settings }: { language: Language; exists: boolean; settings: StudySettings }) => {
    if (!exists) return unwrap(await supabase.from('language_study').insert({ household_id: h, language, ...settings }))
    return unwrap(await supabase.from('language_study').update(settings).eq('language', language).eq('user_id', userId))
  })
}

export const useLearnItem = () =>
  useLanguageMutation(async (h, { language, kind, item }: { language: Language; kind: Kind; item: string }) =>
    unwrap(await supabase.from('language_progress').insert({ household_id: h, language, kind, item, ...learnedSchedule(todayISO()) })),
  )

export const useReviewItem = () =>
  useLanguageMutation(async (_h, { row, remembered }: { row: Progress; remembered: boolean }) => {
    const patch: TablesUpdate<'language_progress'> = reviewedSchedule(row, remembered, todayISO())
    return unwrap(await supabase.from('language_progress').update(patch).eq('id', row.id))
  })

/** Ticks off a linked job if it's due today or overdue; does nothing otherwise. */
export function useTickOffJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (job: Job | undefined) => {
      const open = job?.open[0]
      if (!job || !open?.due_date || open.due_date > todayISO()) return null
      await completeOccurrence({ occurrenceId: open.id })
      return { title: job.title, occurrenceId: open.id }
    },
    onSuccess: (done) => {
      if (!done) return
      toast.success(`Ticked off “${done.title}”`, {
        action: { label: 'Undo', onClick: () => void reopenOccurrence(done.occurrenceId).then(() => qc.invalidateQueries({ queryKey: ['tasks'] })) },
      })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })
}
