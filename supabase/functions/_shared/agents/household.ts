// Household Coordinator: a library of home maintenance that's easy to forget,
// suggested as repeating jobs when nothing like it is on the list or was done
// recently, plus rooms with no jobs at all. Fairness and forgotten chores are
// the Task Manager's; this only adds what's missing. Pure.
import { nextWeekday } from './dates.ts'
import { effectiveCompletions, similarTitles } from './taskManager.ts'
import type { Rule, SuggestionDraft, TaskContext } from './types.ts'

export const MAX_MAINTENANCE = 3
export const MAX_EMPTY_ROOMS = 2

type Upkeep = { id: string; title: string; match: RegExp; rule: Rule; every: string; why: string }

const job = (freq: Rule['freq'], interval = 1): Rule => ({ freq, interval, afterDone: true })

/** Most important first. Matching is on words, so "Test smoke alarm" counts for the smoke alarms. */
export const UPKEEP: Upkeep[] = [
  { id: 'smoke_alarms', title: 'Test the smoke alarms', match: /smoke alarm|fire alarm|carbon monoxide/i, rule: job('monthly'), every: 'every month', why: 'Fire services advise testing them monthly.' },
  { id: 'boiler', title: 'Book the boiler service', match: /boiler/i, rule: job('yearly'), every: 'every year', why: 'A yearly service keeps it safe and any warranty valid (skip it if your building arranges this).' },
  { id: 'extractor', title: 'Clean the extractor fan filter', match: /extractor|cooker hood/i, rule: job('monthly', 3), every: 'every 3 months', why: 'Greasy filters stop working and are a fire risk.' },
  { id: 'washing_machine', title: 'Clean the washing machine filter and drawer', match: /washing machine/i, rule: job('monthly', 2), every: 'every 2 months', why: 'Stops smells, mould and blockages.' },
  { id: 'dishwasher', title: 'Clean the dishwasher filter', match: /dishwasher filter|clean (the )?dishwasher/i, rule: job('monthly'), every: 'every month', why: 'A clogged filter leaves dishes dirty.' },
  { id: 'fridge', title: 'Clear out and wipe the fridge', match: /fridge/i, rule: job('monthly'), every: 'every month', why: 'Out-of-date food and spills are easier monthly.' },
  { id: 'kettle', title: 'Descale the kettle', match: /kettle|descale/i, rule: job('weekly', 4), every: 'every 4 weeks', why: 'Limescale builds up quickly, especially with hard water.' },
  { id: 'oven', title: 'Clean the oven', match: /\boven\b/i, rule: job('monthly', 3), every: 'every 3 months', why: 'Little and often beats one awful clean.' },
  { id: 'mattress', title: 'Rotate the mattress', match: /mattress/i, rule: job('monthly', 3), every: 'every 3 months', why: 'Even wear makes it last years longer.' },
  { id: 'bedding', title: 'Wash the duvet and pillows', match: /duvet|pillows/i, rule: job('monthly', 6), every: 'every 6 months', why: 'Sheets get washed; these usually don’t.' },
  { id: 'windows', title: 'Clean the windows inside', match: /window/i, rule: job('monthly', 3), every: 'every 3 months', why: 'More light, and condensation mould is caught early.' },
  { id: 'freezer', title: 'Defrost the freezer', match: /freezer|defrost/i, rule: job('monthly', 6), every: 'every 6 months', why: 'Ice build-up wastes energy and space.' },
  { id: 'radiators', title: 'Bleed the radiators', match: /radiator/i, rule: job('yearly'), every: 'every autumn', why: 'Trapped air leaves cold patches and costs heat.' },
]

export function analyseHousehold(ctx: TaskContext, rooms: { id: string; name: string }[], enabled: string[]): SuggestionDraft[] {
  if (!enabled.length) return []
  const done = effectiveCompletions(ctx.events).map((c) => c.title)
  const known = [...ctx.open.map((t) => t.title), ...done]
  const saturday = nextWeekday(ctx.today, 6)
  const out: SuggestionDraft[] = UPKEEP.filter((u) => !known.some((t) => u.match.test(t) || similarTitles(t, u.title)))
    .slice(0, MAX_MAINTENANCE)
    .map((u) => ({
      dedupe_key: `household:${u.id}`,
      kind: 'maintenance',
      severity: 1,
      title: `${u.title}, ${u.every}?`,
      reason: `${u.why} Nothing like it is on the list. Approving adds it as a joint job that comes back ${u.every} after it's done.`,
      task_id: null,
      action: { type: 'create_task', title: u.title, list: 'joint', due_date: saturday, recurrence: u.rule },
      recipients: enabled,
    }))

  const used = new Set(ctx.open.map((t) => t.room_id).filter(Boolean))
  out.push(
    ...rooms
      .filter((r) => !used.has(r.id))
      .slice(0, MAX_EMPTY_ROOMS)
      .map((r) => ({
        dedupe_key: `household:room:${r.id}`,
        kind: 'empty_room',
        severity: 1 as const,
        title: `No jobs for the ${r.name}`,
        reason: 'Every other room has repeating jobs. If it needs any (dusting, hoovering, plants), add them on the Jobs page with this room.',
        task_id: null,
        action: null,
        recipients: enabled,
      })),
  )
  return out
}
