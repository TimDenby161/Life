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

/**
 * Home's Today's tasks: what can realistically get done in the free time left
 * today (`budget` minutes, from the calendar). With AI picks today (`picked`,
 * the ones still open), the AI's plan in its order, less whatever no longer
 * fits as the day fills up; once it's all done nothing else is added. Without,
 * jobs due today or late in score order. `minutes` is 0 for paid work, which
 * happens in work time.
 */
export function todaysPlan<T extends { task_id: string }>(
  ranked: T[],
  picked: ReadonlySet<string> | null,
  score: (o: T) => number,
  minutes: (o: T) => number,
  budget: number,
): T[] {
  const out: T[] = []
  let total = 0
  for (const o of ranked) {
    if (out.length >= PLAN_MAX) break
    if (picked ? !picked.has(o.task_id) : score(o) < PLAN_MIN_SCORE) continue
    if (total + minutes(o) > budget) continue
    out.push(o)
    total += minutes(o)
  }
  return out
}
