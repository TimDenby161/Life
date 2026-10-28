import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { todayISO } from '@/lib/dates'
import { supabase, type Tables, type TablesUpdate } from '@/lib/supabase'
import { fetchAllPages, unwrap } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { useUserId } from '@/modules/auth/AuthProvider'
import { completeOccurrence, type OccurrenceWithTask, reopenOccurrence, type TaskCategory } from '@/modules/tasks/api'
import { learnedSchedule, reviewedSchedule } from './lib/srs'
import { type Language, LANGUAGES, type StudyPart, studyPartOf } from './lib/languages'
import type { Kind } from './lib/vocab'

export type Study = Tables<'language_study'>
export type Progress = Tables<'language_progress'>
export type { Language }
/** A task study can be linked to (a job or a plain repeating task), with its open occurrence. */
export type StudyTask = { id: string; title: string; category_id: string | null; assignee_id: string | null; open: { id: string; due_date: string | null }[] }
export type StudySettings = Pick<Study, 'words_per_day' | 'characters_per_day' | 'start_level' | 'words_task_id' | 'characters_task_id' | 'review_task_id'>

// Both members can read everything here; each person only writes their own (RLS).
export const languageKeys = {
  all: ['languages'] as const,
  vocab: (language: Language) => ['languages', 'vocab', language] as const,
  study: ['languages', 'study'] as const,
  progress: ['languages', 'progress'] as const,
}

export const useVocab = (language: Language) =>
  useQuery({ queryKey: languageKeys.vocab(language), queryFn: LANGUAGES[language].load, staleTime: Infinity, gcTime: Infinity })

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

/** Starts or stops learning languages. Stopping keeps settings and progress. */
export function useSetStudying() {
  const userId = useUserId()
  return useLanguageMutation(async (h, changes: { language: Language; active: boolean; exists: boolean; settings: StudySettings }[]) => {
    for (const { language, active, exists, settings } of changes) {
      if (exists) unwrap(await supabase.from('language_study').update({ active }).eq('language', language).eq('user_id', userId))
      else unwrap(await supabase.from('language_study').insert({ household_id: h, language, ...settings, active }))
    }
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
    mutationFn: async (job: StudyTask | undefined) => {
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

/** Open tasks, one per task, in the shape study links to. */
export function studyTasks(open: OccurrenceWithTask[]): StudyTask[] {
  const byTask = new Map<string, StudyTask>()
  for (const o of open) {
    if (byTask.has(o.task_id)) continue
    byTask.set(o.task_id, {
      id: o.task_id,
      title: o.task.title,
      category_id: o.task.category_id,
      assignee_id: o.assignee_id,
      open: [{ id: o.id, due_date: o.due_date }],
    })
  }
  return [...byTask.values()].sort((a, b) => a.title.localeCompare(b.title))
}

const PART_COLUMN = { word: 'words_task_id', character: 'characters_task_id', review: 'review_task_id' } as const

/**
 * Where to study for a task, or null if it isn't a language task: the
 * Languages page for its language, person and part. A task linked in someone's
 * settings wins; otherwise it is recognised by name.
 */
export function studyLinkFor(
  task: { id: string; title: string; category_id: string | null },
  assigneeId: string | null,
  study: Study[],
  categories: TaskCategory[],
): string | null {
  const parts = Object.keys(PART_COLUMN) as StudyPart[]
  const linked = study.flatMap((s) => parts.filter((p) => s[PART_COLUMN[p]] === task.id).map((part) => ({ row: s, part })))[0]
  const guessed = linked ? null : studyPartOf(task.title, categories.find((c) => c.id === task.category_id)?.name)
  const found = linked ? { language: linked.row.language as Language, part: linked.part, person: linked.row.user_id } : guessed && { ...guessed, person: assigneeId }
  if (!found) return null
  const params = new URLSearchParams({ lang: found.language, part: found.part })
  if (found.person) params.set('person', found.person)
  return `/languages?${params}`
}
