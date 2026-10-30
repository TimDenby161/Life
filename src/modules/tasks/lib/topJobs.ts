import { daysBetween, type ISODate } from '@/lib/dates'
import type { TaskCategory } from '../api'
import { compareOccurrences, delayDays } from './format'

type Subtask = { is_done: boolean; due_date?: string | null }

type Scorable = {
  due_date: string | null
  due_time: string | null
  task: { subtasks?: Subtask[]; title: string; description?: string | null; priority: string; category_id: string | null; recurrence?: unknown; importance_votes?: number; deadline?: string | null }
}

// How important a task sounds, from its words. Each tier counts once however many words match.
const CRITICAL =
  /\b(pay|payments?|bills?|invoices?|tax|hmrc|deadlines?|renew(al)?|expir(es?|y|ing)|insurance|mortgage|rent|passport|visa|licen[cs]e|mot|solicitor|contract|legal|court|fines?|urgent|asap|important|doctor|gp|dentist|hospital|prescriptions?|vet)\b/i
const MAJOR =
  /\b(book|register|submit|apply|sign|cancel|confirm|deposit|wedding|venue|quotes?|finances?|appointments?|call|phone|reply|send|order|fix|repair|boiler|buy)\b/i
const ROUTINE =
  /\b(clean|wipe|dust|hoover|vacuum|tidy|mop|wash|laundry|descale|learn|study|practi[cs]e|review|words?|characters?|mandarin|spanish|stretch|weigh)\b/i

const PRIORITY_POINTS: Record<string, number> = { urgent: 50, high: 25, normal: 0, low: -25 }
const VOTE_POINTS = 15
const EVENING_STARTS = 16
const POINTS_PER_EVENING_HOUR = 10
const DEADLINE_DAY_SCORE = 195
const DEADLINE_MISSED_SCORE = 200
const DEADLINE_RUN_UP_DAYS = 7
const DEADLINE_POINTS_PER_DAY = 20
const BIRTHDAY_POINTS_PER_DAY = 14
const BIRTHDAY = /\b(birthdays?|presents?|gifts?)\b/i
const WORK_POINTS = 40
const LUNCH_POINTS = 30
const WORK_HOURS = { from: 8, to: 17 }
const LUNCH_HOURS = { from: 12, to: 14 }
const WORK_CATEGORY = /^c4\b/i
const LUNCH_CATEGORIES = /^(cleaning|other)$/i

function taskText(task: Scorable['task'], categories: Pick<TaskCategory, 'id' | 'name'>[]) {
  return [task.title, task.description, categoryName(task, categories)].filter(Boolean).join(' ')
}

/** A deadline always counts; otherwise our own votes settle it, then the flag and the wording. */
function isImportant(task: Scorable['task'], categories: Pick<TaskCategory, 'id' | 'name'>[]) {
  if (task.deadline) return true
  const votes = task.importance_votes ?? 0
  if (votes) return votes > 0
  return task.priority === 'high' || task.priority === 'urgent' || CRITICAL.test(taskText(task, categories))
}

/** How long delaying this task puts it off, given how often it's been put off already. */
export function delayDaysFor(o: { delay_count: number; task: Scorable['task'] }, categories: Pick<TaskCategory, 'id' | 'name'>[]) {
  return delayDays(o.delay_count, isImportant(o.task, categories))
}

function importanceScore(task: Scorable['task'], categories: Pick<TaskCategory, 'id' | 'name'>[]) {
  const text = taskText(task, categories)
  return (
    (task.importance_votes ?? 0) * VOTE_POINTS +
    (PRIORITY_POINTS[task.priority] ?? 0) +
    (CRITICAL.test(text) ? 40 : MAJOR.test(text) ? 25 : 0) -
    (ROUTINE.test(text) ? 15 : 0) -
    (task.recurrence ? 15 : 0)
  )
}

/** Overdue edges past due today, but only a little: importance still counts for more. */
function urgencyScore(dueDate: ISODate | null, today: ISODate) {
  if (!dueDate) return 0
  const days = daysBetween(today, dueDate)
  if (days < 0) return 40 + Math.min(-days, 14)
  if (days === 0) return 40
  if (days === 1) return 30
  if (days <= 3) return 22
  if (days <= 7) return 12
  if (days <= 30) return 4
  return -20
}

/** A daily task can't wait for tomorrow, so it climbs every hour from 5pm until it's done. */
function endOfDayScore(o: Scorable, today: ISODate, hour: number) {
  const rule = o.task.recurrence as { freq?: string; interval?: number } | null | undefined
  if (rule?.freq !== 'daily' || (rule.interval ?? 1) !== 1 || !o.due_date || o.due_date > today) return 0
  return Math.max(0, hour - EVENING_STARTS) * POINTS_PER_EVENING_HOUR
}

function categoryName(task: Scorable['task'], categories: Pick<TaskCategory, 'id' | 'name'>[]) {
  return categories.find((c) => c.id === task.category_id)?.name ?? ''
}

const within = (hours: { from: number; to: number }, hour: number) => hour >= hours.from && hour < hours.to

/** Work jobs matter in work hours; cleaning and anything uncategorised suit the lunch break. */
function timeOfDayScore(task: Scorable['task'], categories: Pick<TaskCategory, 'id' | 'name'>[], hour: number) {
  const category = categoryName(task, categories)
  if (WORK_CATEGORY.test(category)) return within(WORK_HOURS, hour) ? WORK_POINTS : 0
  return (!category || LUNCH_CATEGORIES.test(category)) && within(LUNCH_HOURS, hour) ? LUNCH_POINTS : 0
}

/** Work jobs stay out of sight outside work hours. */
export function isOutOfHours(task: Scorable['task'], categories: Pick<TaskCategory, 'id' | 'name'>[], hour = new Date().getHours()) {
  return WORK_CATEGORY.test(categoryName(task, categories)) && !within(WORK_HOURS, hour)
}

/**
 * In the last week before a hard deadline the score climbs towards 200, whatever
 * else it would be. A birthday's date can't move either, so its due date counts
 * as a deadline, and it starts higher: around 100 a week out.
 */
function deadlineScore(o: Scorable, categories: Pick<TaskCategory, 'id' | 'name'>[], today: ISODate) {
  const birthday = BIRTHDAY.test(taskText(o.task, categories))
  const deadline = o.task.deadline ?? (birthday ? o.due_date : null)
  if (!deadline) return null
  const days = daysBetween(today, deadline)
  if (days < 0) return DEADLINE_MISSED_SCORE
  if (days > DEADLINE_RUN_UP_DAYS) return null
  return DEADLINE_DAY_SCORE - days * (birthday ? BIRTHDAY_POINTS_PER_DAY : DEADLINE_POINTS_PER_DAY)
}

function ownScore(o: Scorable, categories: Pick<TaskCategory, 'id' | 'name'>[], today: ISODate, hour: number) {
  const score = importanceScore(o.task, categories) + urgencyScore(o.due_date, today) + endOfDayScore(o, today, hour) + timeOfDayScore(o.task, categories, hour)
  return Math.max(score, deadlineScore(o, categories, today) ?? score)
}

/** A subtask scores like its task, on its own date if it has one. */
export function subtaskScore(o: Scorable, subtask: Subtask, categories: Pick<TaskCategory, 'id' | 'name'>[], today: ISODate, hour = new Date().getHours()) {
  return ownScore({ ...o, due_date: subtask.due_date ?? o.due_date }, categories, today, hour)
}

/** A task with subtasks left is as pressing as the most pressing of them. */
export function taskScore(o: Scorable, categories: Pick<TaskCategory, 'id' | 'name'>[], today: ISODate, hour = new Date().getHours()) {
  const left = o.task.subtasks?.filter((s) => !s.is_done) ?? []
  if (!left.length) return ownScore(o, categories, today, hour)
  return Math.max(...left.map((s) => subtaskScore(o, s, categories, today, hour)))
}

/** Highest score first. */
export function byScore<T extends Scorable>(items: T[], categories: Pick<TaskCategory, 'id' | 'name'>[], today: ISODate, hour?: number): T[] {
  return items
    .map((item) => ({ item, score: taskScore(item, categories, today, hour) }))
    .sort((a, b) => b.score - a.score || compareOccurrences(a.item, b.item))
    .map(({ item }) => item)
}

export function topJobs<T extends Scorable>(items: T[], categories: Pick<TaskCategory, 'id' | 'name'>[], today: ISODate, limit = 5): T[] {
  return byScore(items, categories, today).slice(0, limit)
}
