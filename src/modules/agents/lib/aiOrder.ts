// Today's AI picks for a Top jobs tab put first, in the AI's order; the rest
// keep their own order. Picks only count while the job is still open in this
// list. When I'm out, only jobs that can be done away from home are left.

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

/** Language practice, calls, messages, online bookings and the like: fine away from home. Used for jobs the AI didn't tag. */
const ANYWHERE_WORDS = /\b(call|ring|phone|email|e-mail|text|message|reply|book|order|pay|renew|cancel|apply|research|read|learn|study|review|revise|words?|characters?|plan|check|sign up|register|buy online)\b/i
const ANYWHERE_CATEGORIES = /^(spanish|mandarin|languages?|admin|finance)/i

export function canDoAnywhere(title: string, category: string | null | undefined, tagged?: Where): boolean {
  if (tagged) return tagged === 'anywhere'
  return ANYWHERE_CATEGORIES.test(category ?? '') || ANYWHERE_WORDS.test(title)
}
