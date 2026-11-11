import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, type Tables } from '@/lib/supabase'
import { unwrap } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { createTask, taskKeys } from '@/modules/tasks/api'
import type { Entry, Problem, Side } from '../../../supabase/functions/_shared/hustles.ts'

export type HustleSettings = Tables<'hustle_settings'>
export type Hustle = Tables<'hustles'>
export type HustleCharge = Tables<'hustle_charges'>

export const hustleKeys = {
  all: ['hustles'] as const,
  sheet: ['hustles', 'sheet'] as const,
  settings: ['hustles', 'settings'] as const,
  list: ['hustles', 'list'] as const,
  charges: ['hustles', 'charges'] as const,
}

type Fail = { status: 'not_configured' | 'error'; message: string }
export type SheetResult = { status: 'ok'; owner: string; spreadsheetId: string; entries: Entry[]; problems: Problem[] } | Fail
export type AddResult = { status: 'ok'; row: number } | Fail

async function callFunction<T extends { status: string }>(body: Record<string, unknown>): Promise<T | Fail> {
  const { data, error } = await supabase.functions.invoke<T>('side-hustles', { body })
  if (error) {
    const parsed = await (error as { context?: Response }).context?.json?.().catch(() => null)
    return parsed?.status ? (parsed as T) : { status: 'error', message: 'The sheet could not be reached.' }
  }
  return data ?? { status: 'error', message: 'Empty response' }
}

/** The sheet's entries, read through the side-hustles function (the service account holds the Google access). */
export const useSheet = (enabled: boolean) =>
  useQuery({ queryKey: hustleKeys.sheet, queryFn: () => callFunction<SheetResult>({ mode: 'read' }), enabled, staleTime: 5 * 60_000 })

export const useHustleSettings = () => useQuery({ queryKey: hustleKeys.settings, queryFn: async () => unwrap(await supabase.from('hustle_settings').select('*')) })
export const useHustles = () => useQuery({ queryKey: hustleKeys.list, queryFn: async () => unwrap(await supabase.from('hustles').select('*').order('created_at')) })
export const useCharges = () =>
  useQuery({ queryKey: hustleKeys.charges, queryFn: async () => unwrap(await supabase.from('hustle_charges').select('*').order('description')) })

function useHustleMutation<TArgs>(fn: (householdId: string, me: string, args: TArgs) => Promise<unknown>) {
  const { household, me } = useHousehold()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: TArgs) => fn(household.id, me.id, args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: hustleKeys.all })
      qc.invalidateQueries({ queryKey: taskKeys.all })
    },
  })
}

export const useSaveSettings = () =>
  useHustleMutation(async (h, _me, s: { spreadsheet_id: string; sheet_name: string; exists: boolean }) =>
    s.exists
      ? unwrap(await supabase.from('hustle_settings').update({ spreadsheet_id: s.spreadsheet_id, sheet_name: s.sheet_name }).eq('user_id', _me))
      : unwrap(await supabase.from('hustle_settings').insert({ household_id: h, spreadsheet_id: s.spreadsheet_id, sheet_name: s.sheet_name })),
  )

/** A side hustle by name (matching the sheet's Project column), made the first time it needs settings. Returns its id. */
async function ensureHustle(h: string, name: string): Promise<string> {
  const found = unwrap(await supabase.from('hustles').select('id').eq('name', name).maybeSingle())
  return found?.id ?? unwrap(await supabase.from('hustles').insert({ household_id: h, name }).select('id').single()).id
}

export const useAddHustle = () => useHustleMutation(async (h, _me, name: string) => ensureHustle(h, name.replace(/\s+/g, ' ').trim()))
export const useSetCategory = () =>
  useHustleMutation(async (h, _me, { name, categoryId }: { name: string; categoryId: string | null }) =>
    unwrap(await supabase.from('hustles').update({ category_id: categoryId }).eq('id', await ensureHustle(h, name))),
  )

/** The next date this month or next with that day of the month (clamped to the month's end). */
function nextMonthDay(day: number, today = new Date()): string {
  const make = (y: number, m: number) => {
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
    return new Date(Date.UTC(y, m, Math.min(day, last))).toISOString().slice(0, 10)
  }
  const iso = today.toISOString().slice(0, 10)
  const thisMonth = make(today.getUTCFullYear(), today.getUTCMonth())
  return thisMonth >= iso ? thisMonth : make(today.getUTCFullYear(), today.getUTCMonth() + 1)
}

/** A regular charge (or income) with its monthly task on your own list; adding it from Side hustles writes it to the sheet. */
export const useAddCharge = () =>
  useHustleMutation(async (h, me, c: { hustleName: string; kind: Side; description: string; usualMinor: number; monthDay: number }) => {
    const hustleId = await ensureHustle(h, c.hustleName)
    const list = unwrap(await supabase.from('task_lists').select('id').eq('kind', 'personal').eq('owner_id', me).single())
    const task = await createTask(h, {
      list_id: list.id,
      title: `${c.kind === 'out' ? 'Add charge' : 'Add income'}: ${c.description} (${c.hustleName})`,
      description: 'Add it on Side hustles: that writes it to the sheet and ticks this off.',
      assignee_id: me,
      category_id: null,
      priority: 'normal',
      needs_both: false,
      due_date: nextMonthDay(c.monthDay),
      due_time: null,
      recurrence: { freq: 'monthly', interval: 1, monthDay: c.monthDay },
      last_done_on: null,
      room_id: null,
    })
    return unwrap(
      await supabase
        .from('hustle_charges')
        .insert({ household_id: h, hustle_id: hustleId, kind: c.kind, description: c.description, usual_minor: c.usualMinor, task_id: task.id }),
    )
  })

/** Stops a regular charge and archives its task. */
export const useDeleteCharge = () =>
  useHustleMutation(async (_h, _me, charge: HustleCharge) => {
    if (charge.task_id) unwrap(await supabase.from('tasks').update({ archived_at: new Date().toISOString() }).eq('id', charge.task_id))
    unwrap(await supabase.from('hustle_charges').delete().eq('id', charge.id))
  })

/** Writes a row to the sheet (and, for a regular charge, ticks its task off). */
export function useAddEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (e: { side: Side; date: string; project: string; description: string; amountMinor: number; chargeId?: string }) => callFunction<AddResult>({ mode: 'add', ...e }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: hustleKeys.all })
      qc.invalidateQueries({ queryKey: taskKeys.all })
    },
  })
}
