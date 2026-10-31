import { daysBetween, type ISODate, parseISODate, todayISO } from '@/lib/dates'
import type { TaskCategory } from '../api'
import { compareOccurrences, delayDays } from './format'

type Subtask = { is_done: boolean; due_date?: string | null }

type Scorable = {
  created_at?: string
  delay_count?: number
  due_date: string | null
  due_time: string | null
  task: { subtasks?: Subtask[]; title: string; description?: string | null; priority: string; category_id: string | null; recurrence?: unknown; importance_votes?: number; deadline?: string | null }
}

// How important a task sounds, from its words. Each tier counts once however many words match.
const CRITICAL =
  /\b(pay|payments?|bills?|invoices?|tax|hmrc|deadlines?|renew(al)?|expir(es?|y|ing)|insurance|mortgage|rent|passport|visa|licen[cs]e|mot|solicitor|contract|legal|court|fines?|urgent|asap|important|doctor|gp|dentist|hospital|prescriptions?|vet)\b/i
const MAJOR =
  /\b(book|register|submit|apply|sign|cancel|confirm|deposit|venue|quotes?|finances?|appointments?|call|phone|reply|send|order|fix|repair|boiler|buy)\b/i
const ROUTINE =
  /\b(clean|wipe|dust|hoover|vacuum|tidy|mop|wash|laundry|descale|learn|study|practi[cs]e|review|words?|characters?|mandarin|spanish|stretch|weigh)\b/i

const PRIORITY_POINTS: Record<string, number> = { urgent: 50, high: 25, normal: 0, low: -25 }
const VOTE_POINTS = 10
const CRITICAL_WORD_POINTS = 30
const MAJOR_WORD_POINTS = 15
const EVENING_STARTS = 16
const POINTS_PER_EVENING_HOUR = 10
const BEDTIME = 22
const DAILY_SCORE_AT_BEDTIME = 100
const POINTS_PER_BEDTIME_HOUR = 15
const DEADLINE_DAY_SCORE = 195
const DEADLINE_MISSED_SCORE = 200
const DEADLINE_RUN_UP_DAYS = 7
const DEADLINE_POINTS_PER_DAY = 20
const BIRTHDAY_RUN_UP_DAYS = 14
const BIRTHDAY_POINTS_PER_DAY = 14
const BIRTHDAY = /\b(birthdays?|presents?|gifts?)\b/i
const DUE_DAY_SCORE = 100
const MAX_CYCLE_RUN_UP_DAYS = 14
const CYCLE_DAYS: Record<string, number> = { weekly: 7, monthly: 30, yearly: 365 }
const FAR_OFF_POINTS_PER_MONTH = 5
const DUE_RUN_UP_DAYS = 7
const DUE_POINTS_PER_DAY = 10
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
    (CRITICAL.test(text) ? CRITICAL_WORD_POINTS : MAJOR.test(text) ? MAJOR_WORD_POINTS : 0) -
    (ROUTINE.test(text) ? 15 : 0) -
    (task.recurrence ? 15 : 0)
  )
}

/** Further off counts for less, a little more each month, so distant tasks sort by date whatever their wording. */
function farOffUrgency(days: number) {
  return days <= 30 ? 4 : -20 - Math.floor((days - 30) / 30) * FAR_OFF_POINTS_PER_MONTH
}

/** Overdue edges past due today, but only a little: importance still counts for more. */
function repeatingUrgency(days: number) {
  if (days < 0) return 40 + Math.min(-days, 14)
  if (days === 0) return 40
  if (days === 1) return 30
  if (days <= 3) return 22
  return days <= 7 ? 12 : farOffUrgency(days)
}

/** The date someone picks for a one-off task is the day it reaches 100, after a week's climb. */
function oneOffUrgency(days: number) {
  if (days < 0) return DUE_DAY_SCORE - days
  return days <= DUE_RUN_UP_DAYS ? DUE_DAY_SCORE - days * DUE_POINTS_PER_DAY : farOffUrgency(days)
}

/** How many days a repeating task's cycle runs, for anything from weekly up. */
function cycleDays(recurrence: unknown) {
  const rule = recurrence as { freq?: string; interval?: number } | null | undefined
  const days = rule?.freq ? CYCLE_DAYS[rule.freq] : undefined
  return days ? days * (rule?.interval ?? 1) : null
}

/**
 * How far through its cycle a job is: just done is 0, and it reaches 100 when it
 * comes due. Long cycles only count their last fortnight, so a six-monthly job
 * doesn't look pressing weeks ahead.
 */
function cycleUrgency(days: number, cycle: number) {
  if (days < 0) return DUE_DAY_SCORE + Math.min(-days, 14)
  const runUp = Math.min(cycle, MAX_CYCLE_RUN_UP_DAYS)
  return days <= runUp ? Math.round(DUE_DAY_SCORE * (1 - days / runUp)) : farOffUrgency(days)
}

function urgencyScore(o: Scorable, today: ISODate) {
  if (!o.due_date) return 0
  const days = daysBetween(today, o.due_date)
  if (!o.task.recurrence) return oneOffUrgency(days)
  const cycle = cycleDays(o.task.recurrence)
  return cycle ? cycleUrgency(days, cycle) : repeatingUrgency(days)
}

/** Nothing talks a one-off task below 100 once its day has come. */
function dueDayFloor(o: Scorable, today: ISODate) {
  return !o.task.recurrence && o.due_date && o.due_date <= today ? DUE_DAY_SCORE : null
}

function isDailyAndDue(o: Scorable, today: ISODate) {
  const rule = o.task.recurrence as { freq?: string; interval?: number } | null | undefined
  return rule?.freq === 'daily' && (rule.interval ?? 1) === 1 && Boolean(o.due_date) && o.due_date! <= today
}

/** A daily task can't wait for tomorrow, so it climbs every hour from 5pm until it's done. */
function endOfDayScore(o: Scorable, today: ISODate, hour: number) {
  return isDailyAndDue(o, today) ? Math.max(0, hour - EVENING_STARTS) * POINTS_PER_EVENING_HOUR : 0
}

/** However low it started, an unfinished daily task reaches 100 by 10pm. */
function endOfDayFloor(o: Scorable, today: ISODate, hour: number) {
  if (!isDailyAndDue(o, today) || hour <= EVENING_STARTS) return null
  return DAILY_SCORE_AT_BEDTIME + (hour - BEDTIME) * POINTS_PER_BEDTIME_HOUR
}

function categoryName(task: Scorable['task'], categories: Pick<TaskCategory, 'id' | 'name'>[]) {
  return categories.find((c) => c.id === task.category_id)?.name ?? ''
}

const within = (hours: { from: number; to: number }, hour: number) => hour >= hours.from && hour < hours.to

function isWorkTime(hour: number, today: ISODate) {
  const day = parseISODate(today).getDay()
  return day !== 0 && day !== 6 && within(WORK_HOURS, hour)
}

/** Work jobs matter in work hours; cleaning and anything uncategorised suit the lunch break. */
function timeOfDayScore(task: Scorable['task'], categories: Pick<TaskCategory, 'id' | 'name'>[], hour: number, today: ISODate) {
  const category = categoryName(task, categories)
  if (WORK_CATEGORY.test(category)) return isWorkTime(hour, today) ? WORK_POINTS : 0
  return (!category || LUNCH_CATEGORIES.test(category)) && within(LUNCH_HOURS, hour) ? LUNCH_POINTS : 0
}

/** Work jobs stay out of sight evenings and weekends. */
export function isOutOfHours(task: Scorable['task'], categories: Pick<TaskCategory, 'id' | 'name'>[], hour = new Date().getHours(), today = todayISO()) {
  return WORK_CATEGORY.test(categoryName(task, categories)) && !isWorkTime(hour, today)
}

/**
 * In the last week before a hard deadline the score climbs towards 200, whatever
 * else it would be. A birthday's date can't move either, so its due date counts
 * as a deadline, and it starts earlier: climbing for two weeks, around 100 a week out.
 */
function deadlineScore(o: Scorable, categories: Pick<TaskCategory, 'id' | 'name'>[], today: ISODate) {
  const birthday = BIRTHDAY.test(taskText(o.task, categories))
  const deadline = o.task.deadline ?? (birthday ? o.due_date : null)
  if (!deadline) return null
  const days = daysBetween(today, deadline)
  if (days < 0) return DEADLINE_MISSED_SCORE
  if (days > (birthday ? BIRTHDAY_RUN_UP_DAYS : DEADLINE_RUN_UP_DAYS)) return null
  return DEADLINE_DAY_SCORE - days * (birthday ? BIRTHDAY_POINTS_PER_DAY : DEADLINE_POINTS_PER_DAY)
}

/** Everything that makes a task pressing, before the cap. */
function pressure(o: Scorable, categories: Pick<TaskCategory, 'id' | 'name'>[], today: ISODate, hour: number) {
  const score = importanceScore(o.task, categories) + urgencyScore(o, today) + endOfDayScore(o, today, hour) + timeOfDayScore(o.task, categories, hour, today)
  return Math.max(score, endOfDayFloor(o, today, hour) ?? score, dueDayFloor(o, today) ?? score)
}

/** 100 means due today: only a task past its date goes higher, apart from the run-up to a hard deadline or birthday. */
function ownScore(o: Scorable, categories: Pick<TaskCategory, 'id' | 'name'>[], today: ISODate, hour: number) {
  const score = pressure(o, categories, today, hour)
  const pastDue = Boolean(o.due_date) && o.due_date! < today
  const capped = pastDue ? score : Math.min(score, DUE_DAY_SCORE)
  return Math.max(capped, deadlineScore(o, categories, today) ?? capped)
}

/** A subtask scores like its task, on its own date if it has one. Delaying the task holds its subtasks back too. */
export function subtaskScore(o: Scorable, subtask: Subtask, categories: Pick<TaskCategory, 'id' | 'name'>[], today: ISODate, hour = new Date().getHours()) {
  const dates = [subtask.due_date, o.delay_count ? o.due_date : null].filter((d) => d != null)
  return ownScore({ ...o, due_date: dates.toSorted().at(-1) ?? o.due_date }, categories, today, hour)
}

/** A task with subtasks left is as pressing as the most pressing of them. */
export function taskScore(o: Scorable, categories: Pick<TaskCategory, 'id' | 'name'>[], today: ISODate, hour = new Date().getHours()) {
  const left = o.task.subtasks?.filter((s) => !s.is_done) ?? []
  if (!left.length) return ownScore(o, categories, today, hour)
  return Math.max(...left.map((s) => subtaskScore(o, s, categories, today, hour)))
}

/** Highest score first; on a tie, whichever is more pressing underneath, then whatever has been waiting longest. */
export function byScore<T extends Scorable>(items: T[], categories: Pick<TaskCategory, 'id' | 'name'>[], today: ISODate, hour = new Date().getHours()): T[] {
  return items
    .map((item) => ({ item, score: taskScore(item, categories, today, hour), pressure: pressure(item, categories, today, hour) }))
    .sort((a, b) => b.score - a.score || b.pressure - a.pressure || (a.item.created_at ?? '').localeCompare(b.item.created_at ?? '') || compareOccurrences(a.item, b.item))
    .map(({ item }) => item)
}

export function topJobs<T extends Scorable>(items: T[], categories: Pick<TaskCategory, 'id' | 'name'>[], today: ISODate, limit = 5): T[] {
  return byScore(items, categories, today).slice(0, limit)
}
