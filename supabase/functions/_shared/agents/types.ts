// What the agents read and produce. The Edge Function loads a TaskContext with
// narrow, household-scoped selects; the analysis functions are pure.
import type { CalEvent, TravelRule } from './calendar.ts'
import type { ISODate } from './dates.ts'

export type Member = { id: string; name: string }
export type List = { id: string; kind: 'joint' | 'personal'; owner_id: string | null }
export type Category = { id: string; name: string; owner_id: string | null }

export type Rule = { freq: 'daily' | 'weekly' | 'monthly' | 'yearly'; interval?: number; afterDone?: boolean; weekdays?: number[]; monthDay?: number }

/** An open occurrence with the task fields the agents use. No descriptions or comments. */
export type OpenTask = {
  occurrence_id: string
  task_id: string
  title: string
  list_id: string
  category_id: string | null
  needs_both: boolean
  priority: string
  importance_votes: number
  recurrence: Rule | null
  due_date: ISODate | null
  due_time: string | null
  deadline: ISODate | null
  delay_count: number
  waiting_on_task_id: string | null
  created_by: string
  /** When the task (not the occurrence) was created. */
  created_at: string
  room_id?: string | null
  /** Minutes set on the task; null = estimate from the title. */
  duration_minutes?: number | null
}

/** A row of the append-only completion log (task_completion_events). */
export type CompletionEvent = {
  occurrence_id: string
  task_id: string
  event_type: 'completed' | 'skipped' | 'reopened'
  completed_by: string | null
  also_completed_by: string | null
  occurred_at: string
  recorded_at: string
  task_title: string
  list_id: string | null
  category_id: string | null
  category_name: string | null
  is_recurring: boolean
}

export type TaskContext = {
  today: ISODate
  /** Local hour, 0-23. */
  hour: number
  members: Member[]
  lists: List[]
  categories: Category[]
  open: OpenTask[]
  /** The last 180 days of the completion log. */
  events: CompletionEvent[]
  /** The household's time zone (Europe/London if not given). */
  timezone?: string
  /** Calendar events from today for about a week; none when no calendar is connected. */
  calendar?: CalEvent[]
  /** Each person's travel to and from events (Chief of Staff settings), by user id. */
  travel?: Record<string, TravelRule[]>
}

export type Action =
  | { type: 'create_task'; title: string; list: 'joint' | 'personal'; due_date?: ISODate; recurrence?: Rule; category_id?: string | null; needs_both?: boolean }
  | { type: 'move_due_date'; due_date: ISODate }
  | { type: 'archive_task' }

export type Severity = 1 | 2 | 3

/** What agent_finish_run receives for each suggestion. */
export type SuggestionDraft = {
  dedupe_key: string
  kind: string
  severity: Severity
  title: string
  reason: string
  task_id: string | null
  action: Action | null
  recipients: string[]
}

export type BriefingDraft = {
  recipient_id: string
  kind: 'daily' | 'weekly'
  period_key: string
  content: Record<string, unknown>
  ai_summary?: string | null
}

/** Suggestions that are things to know, not things to do: no "Add as task". */
export const OBSERVATION_KINDS = new Set(['workload', 'over_budget', 'wedding_summary', 'reviews_due', 'lang_stalled', 'training_load', 'rest_day', 'empty_room', 'fitness_week', 'fin_position', 'fin_debt', 'admin_start', 'trip_passport_unknown', 'career_start', 'goal_late', 'event_recovery', 'over_limit', 'food_week', 'takeaway_limit', 'savings_pace', 'project_milestone', 'project_count'])

/** "£1,250" or "£12.50". */
export function formatPounds(minor: number): string {
  const pounds = minor / 100
  return `£${pounds.toLocaleString('en-GB', { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 })}`
}
