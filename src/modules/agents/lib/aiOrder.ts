// Today's AI picks for a Top jobs tab put first, in the AI's order; the rest
// keep their own order. Picks only count while the job is still open in this
// list. (Home drops a job swiped away today itself.) When I'm out, only jobs that can be done away from home are left.

export type Where = 'home' | 'anywhere'
export type AiPick = { task_id: string; why: string; where?: Where }

export function aiFirst<T extends { task_id: string }>(ranked: T[], picks: AiPick[] | undefined) {
  if (!picks?.length) return { items: ranked, notes: new Map<string, string>(), where: new Map<string, Where>() }
  const byTask = new Map(ranked.map((o) => [o.task_id, o]))
  const live = picks.filter((p) => byTask.has(p.task_id))
  const firstIds = new Set(live.map((p) => p.task_id))
  return {
    items: [...live.map((p) => byTask.get(p.task_id)!), ...ranked.filter((o) => !firstIds.has(o.task_id))],
    notes: new Map(live.map((p) => [p.task_id, p.why])),
    where: new Map(live.map((p) => [p.task_id, p.where ?? 'home'])),
  }
}

/** Things that need you at home, whatever the AI said: the house, food and supplies, cleaning, laundry, bins, shopping. */
const HOME_WORDS =
  /\b(food|fridge|freezer|cupboards?|pantry|supplies|stock|groceries|shop(ping)?|clean|wash|wipe|tidy|vacuum|hoover|dust|mop|bins?|laundry|towels|bed(ding|s)?|sheets|iron(ing)?|cook|bake|meal|garden|plants?|water the|descale|fix|repair|paint|bathroom|kitchen|oven|rug|floor|windows?|declutter|sort out the)\b/i

/** Language practice, calls, messages, online bookings and the like: fine away from home. Used for jobs the AI didn't tag. */
const ANYWHERE_WORDS = /\b(call|ring|phone|email|e-mail|text|message|reply|book|order online|pay|renew|cancel|apply|research|read|learn|study|review|revise|words?|characters?|tones|plan|sign up|register|decide|agree|draft|shortlist)\b/i
const ANYWHERE_CATEGORIES = /^(spanish|mandarin|languages?)/i

/** Starts with something you do on a phone ("Call the council about the bins"). */
const PHONE_START = /^(call|ring|phone|email|e-mail|text|message|reply|book|pay|renew|cancel|apply|research|plan|draft|agree|decide|shortlist|order online)\b/i

/** Can this be done away from home, on a phone? Phone actions are; obvious home jobs never are; otherwise the AI's tag, then the word lists. */
export function canDoAnywhere(title: string, category: string | null | undefined, tagged?: Where): boolean {
  if (PHONE_START.test(title.trim())) return true
  if (HOME_WORDS.test(title)) return false
  if (tagged) return tagged === 'anywhere'
  return ANYWHERE_CATEGORIES.test(category ?? '') || ANYWHERE_WORDS.test(title)
}

export const PLAN_MAX = 10
/** A one-off on its day, a late job or a deadline day scores at least this (DUE_DAY_SCORE in tasks/lib/topJobs.ts). */
export const PLAN_MIN_SCORE = 100

export type PlanRules<T> = {
  score: (o: T) => number
  minutes: (o: T) => number
  /** Free minutes left today, from the calendar. */
  budget: number
  /** Paid work fits the Work time left (`workBudget`) instead. */
  isWork?: (o: T) => boolean
  workBudget?: number
  /** Anything else a job needs today, e.g. the shops open. */
  fits?: (o: T) => boolean
  /** Most minutes of other jobs to add after the AI's picks: the time freed by picks moved to another day. */
  backfill?: number
}

/**
 * Home's Today's tasks: what can realistically get done in the time left today.
 * The AI's picks still open (`picked`) come first, in its order, less whatever
 * no longer fits as the day fills up. Time freed by a pick moved to another day
 * (`backfill`) is filled with jobs due today or late, best first; finishing a
 * job never brings in another. Without AI picks it's those jobs alone.
 */
export function todaysPlan<T extends { task_id: string }>(ranked: T[], picked: ReadonlySet<string> | null, rules: PlanRules<T>): T[] {
  const { score, minutes, budget, isWork = () => false, workBudget = 0, fits = () => true, backfill = Infinity } = rules
  const out: T[] = []
  let total = 0
  let worked = 0
  let added = 0
  const take = (o: T, extra: boolean) => {
    if (out.length >= PLAN_MAX || out.includes(o) || !fits(o)) return
    if (extra && added + minutes(o) > backfill) return
    if (isWork(o)) {
      if (worked + minutes(o) > workBudget) return
      worked += minutes(o)
    } else {
      if (total + minutes(o) > budget) return
      total += minutes(o)
    }
    if (extra) added += minutes(o)
    out.push(o)
  }
  if (picked) ranked.filter((o) => picked.has(o.task_id)).forEach((o) => take(o, false))
  ranked.filter((o) => score(o) >= PLAN_MIN_SCORE).forEach((o) => take(o, Boolean(picked)))
  return out
}
