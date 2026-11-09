// Weight & Food: a target weight at a steady pace, takeaway limits and a weekly
// meal plan, from each person's own goals. Pure. Weight readings are health
// data, so anything about weight goes only to that person, and none of it ever
// reaches the AI summary (llm.ts) or a notification.
//
//   food:<id>:week:<week>          Mondays: last week's weight trend against the
//                                  pace to the target, and takeaways
//   food:<id>:weigh:<last>         no weigh-in for a week
//   food:<id>:solo:<week>:<n>      takeaways on your own over your limit
//   food:shared:<week>:<n>         takeaways together over the limit
//   food:plan:<date>               meal planning day: plan the week's meals
import { addDays, daysBetween, type ISODate, isoWeekday, isoWeekKey } from './dates.ts'
import { similarTitles } from './taskManager.ts'
import type { Member, OpenTask, SuggestionDraft } from './types.ts'

export const WEIGH_IN_DAYS = 7
export const DEFAULT_PACE_KG = 0.5
export const MEAL_PLAN_TASK = 'Plan the week’s meals and shopping list'

export type FoodGoals = {
  targetKg: number | null
  /** Kilos a week to lose (or gain, when the target is above). */
  weeklyKg: number
  /** Takeaways a week: on your own, and together. Null = no limit. */
  soloTakeaways: number | null
  sharedTakeaways: number | null
  /** 1 = Monday … 7 = Sunday; null = no meal planning nudge. */
  mealPlanDay: number | null
}

export type WeightReading = { user_id: string; date: ISODate; kg: number }
export type Takeaway = { user_id: string; eaten_on: ISODate; shared: boolean }

const num = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null)
const int = (v: unknown, min: number, max: number) => (Number.isInteger(v) ? num(v, min, max) : null)

/** Goals as saved in agent_settings.config, cleaned; null when there are none. */
export function parseFoodGoals(config: unknown): FoodGoals | null {
  const c = (config ?? {}) as Record<string, unknown>
  const goals: FoodGoals = {
    targetKg: num(c.targetKg, 30, 250),
    weeklyKg: num(c.weeklyKg, 0.1, 1) ?? DEFAULT_PACE_KG,
    soloTakeaways: int(c.soloTakeaways, 0, 14),
    sharedTakeaways: int(c.sharedTakeaways, 0, 14),
    mealPlanDay: int(c.mealPlanDay, 1, 7),
  }
  return goals.targetKg !== null || goals.soloTakeaways !== null || goals.sharedTakeaways !== null || goals.mealPlanDay !== null ? goals : null
}

/** "90.4". */
export const kg = (v: number) => (Math.round(v * 10) / 10).toFixed(1)

const average = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

/** Average of the readings in the `days` days up to and including `to`; null when there are none. */
export function averageTo(readings: WeightReading[], to: ISODate, days = 7): number | null {
  const from = addDays(to, -(days - 1))
  const xs = readings.filter((r) => r.date >= from && r.date <= to).map((r) => r.kg)
  return xs.length ? average(xs) : null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayMonth = (iso: ISODate) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`

/** When the target is reached at a weekly rate, or null when the rate is going the wrong way. */
export function reachBy(today: ISODate, now: number, target: number, perWeek: number): ISODate | null {
  const toGo = now - target
  if (Math.abs(toGo) < 0.05) return today
  if (perWeek === 0 || Math.sign(perWeek) !== Math.sign(toGo)) return null
  return addDays(today, Math.ceil((toGo / perWeek) * 7))
}

function weekReview(today: ISODate, goals: FoodGoals, mine: WeightReading[], solo: number, shared: number): { title: string; reason: string; severity: 1 | 2 } | null {
  const lastWeekEnd = addDays(today, -1)
  const now = averageTo(mine, lastWeekEnd)
  const parts: string[] = []
  let title = 'Last week'
  let severity: 1 | 2 = 1
  if (goals.targetKg !== null && now !== null) {
    const before = averageTo(mine, addDays(lastWeekEnd, -7))
    const month = averageTo(mine, addDays(lastWeekEnd, -28))
    const losing = goals.targetKg < now
    const change = before === null ? null : now - before
    title = `${kg(now)} kg${change === null ? '' : `, ${change <= -0.05 ? 'down' : change >= 0.05 ? 'up' : 'level'}${Math.abs(change) >= 0.05 ? ` ${kg(Math.abs(change))}` : ''} on the week before`}`
    const toGo = Math.abs(now - goals.targetKg)
    if (toGo < 0.05 || (losing ? now <= goals.targetKg : now >= goals.targetKg)) {
      parts.push(`At your ${kg(goals.targetKg)} kg target: well done. Keep the same habits to hold it.`)
    } else {
      const planned = reachBy(today, now, goals.targetKg, losing ? goals.weeklyKg : -goals.weeklyKg)!
      parts.push(`${kg(toGo)} kg to ${kg(goals.targetKg)}: at ${kg(goals.weeklyKg)} kg a week that’s about ${dayMonth(planned)}.`)
      if (month !== null) {
        const rate = (month - now) / 4
        const at = reachBy(today, now, goals.targetKg, losing ? rate : -rate)
        parts.push(at ? `At your last four weeks’ rate, about ${dayMonth(at)}.` : 'The last four weeks haven’t moved towards it yet.')
        if (!at || daysBetween(planned, at) > 28) severity = 2
      }
      if (change !== null && (losing ? change > 0.3 : change < -0.3)) severity = 2
    }
  }
  if (goals.soloTakeaways !== null || goals.sharedTakeaways !== null) {
    parts.push(`Takeaways: ${solo} on your own${goals.soloTakeaways !== null ? ` (limit ${goals.soloTakeaways})` : ''}, ${shared} together${goals.sharedTakeaways !== null ? ` (limit ${goals.sharedTakeaways})` : ''}.`)
    if ((goals.soloTakeaways !== null && solo > goals.soloTakeaways) || (goals.sharedTakeaways !== null && shared > goals.sharedTakeaways)) severity = 2
  }
  return parts.length ? { title, reason: parts.join(' '), severity } : null
}

export function analyseFood(
  today: ISODate,
  members: Member[],
  weights: WeightReading[],
  takeaways: Takeaway[],
  open: OpenTask[],
  enabled: string[],
  goalsFor: (userId: string) => FoodGoals | null,
): SuggestionDraft[] {
  const out: SuggestionDraft[] = []
  const week = isoWeekKey(today)
  const monday = addDays(today, 1 - isoWeekday(today))
  const inWeek = (t: Takeaway, from: ISODate, to: ISODate) => t.eaten_on >= from && t.eaten_on <= to
  const sharedIn = (from: ISODate, to: ISODate) => takeaways.filter((t) => t.shared && inWeek(t, from, to)).length
  const soloIn = (id: string, from: ISODate, to: ISODate) => takeaways.filter((t) => !t.shared && t.user_id === id && inWeek(t, from, to)).length
  const hasTask = (title: string) => open.some((t) => similarTitles(t.title, title))
  const people = members.filter((m) => enabled.includes(m.id)).map((m) => ({ m, goals: goalsFor(m.id) })).filter((p) => p.goals)

  for (const { m, goals } of people as { m: Member; goals: FoodGoals }[]) {
    const id = m.id.slice(0, 8)
    const mine = weights.filter((w) => w.user_id === m.id)

    if (isoWeekday(today) === 1) {
      const lastMonday = addDays(today, -7)
      const review = weekReview(today, goals, mine, soloIn(m.id, lastMonday, addDays(today, -1)), sharedIn(lastMonday, addDays(today, -1)))
      if (review) {
        out.push({ dedupe_key: `food:${id}:week:${week}`, kind: 'food_week', severity: review.severity, title: review.title, reason: review.reason, task_id: null, action: null, recipients: [m.id] })
      }
    }

    if (goals.targetKg !== null) {
      const last = mine.map((w) => w.date).sort().at(-1)
      const gap = last ? daysBetween(last, today) : null
      if ((gap === null || gap >= WEIGH_IN_DAYS) && !open.some((t) => /\bweigh/i.test(t.title))) {
        out.push({
          dedupe_key: `food:${id}:weigh:${last ?? 'never'}`,
          kind: 'weigh_in',
          severity: 1,
          title: last ? `No weigh-in for ${gap} days` : 'Weigh in to start tracking',
          reason: 'Same time, same scales, ideally first thing. The 7-day average on the Health page smooths out the daily ups and downs.',
          task_id: null,
          action: { type: 'create_task', title: 'Weigh in', list: 'personal', due_date: today },
          recipients: [m.id],
        })
      }
    }

    const solo = soloIn(m.id, monday, today)
    if (goals.soloTakeaways !== null && solo > goals.soloTakeaways) {
      out.push({
        dedupe_key: `food:${id}:solo:${week}:${solo}`,
        kind: 'takeaway_limit',
        severity: 2,
        title: `${solo} ${solo === 1 ? 'takeaway' : 'takeaways'} on your own this week`,
        reason: `Your limit is ${goals.soloTakeaways === 0 ? 'none' : goals.soloTakeaways} on your own. Something quick in the freezer for tired evenings makes the next one easier to skip.`,
        task_id: null,
        action: null,
        recipients: [m.id],
      })
    }
  }

  // Together: one card for whoever set a shared limit.
  const sharedLimit = people.filter((p) => p.goals!.sharedTakeaways !== null)
  const shared = sharedIn(monday, today)
  const limit = Math.min(...sharedLimit.map((p) => p.goals!.sharedTakeaways!))
  if (sharedLimit.length && shared > limit) {
    out.push({
      dedupe_key: `food:shared:${week}:${shared}`,
      kind: 'takeaway_limit',
      severity: 2,
      title: `${shared} takeaways together this week`,
      reason: `Your limit together is ${limit === 0 ? 'none' : limit === 1 ? 'one' : limit} a week. Cook the rest from the meal plan.`,
      task_id: null,
      action: null,
      recipients: sharedLimit.map((p) => p.m.id),
    })
  }

  // Meal planning: one joint task, for whoever plans on this day.
  const planners = people.filter((p) => p.goals!.mealPlanDay === isoWeekday(today)).map((p) => p.m.id)
  if (planners.length && !hasTask(MEAL_PLAN_TASK)) {
    out.push({
      dedupe_key: `food:plan:${today}`,
      kind: 'meal_plan',
      severity: 1,
      title: 'Plan this week’s meals',
      reason: 'Pick the dinners, write the shopping list and order or shop once. A plan is the easiest way to skip takeaways.',
      task_id: null,
      action: { type: 'create_task', title: MEAL_PLAN_TASK, list: planners.length > 1 ? 'joint' : 'personal', due_date: today },
      recipients: planners,
    })
  }
  return out
}
