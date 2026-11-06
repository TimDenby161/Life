// Today's AI picks put first in a list of jobs, in the AI's order; the rest keep
// their own order. Picks only count on the day they were made, and only while
// the job is still open in this list.

export type AiPick = { task_id: string; why: string }

export function aiFirst<T extends { task_id: string }>(ranked: T[], picks: AiPick[] | undefined, pickedOn: string | undefined, today: string) {
  if (!picks?.length || pickedOn !== today) return { items: ranked, notes: new Map<string, string>() }
  const byTask = new Map(ranked.map((o) => [o.task_id, o]))
  const first = picks.flatMap((p) => byTask.get(p.task_id) ?? [])
  const firstIds = new Set(first.map((o) => o.task_id))
  return {
    items: [...first, ...ranked.filter((o) => !firstIds.has(o.task_id))],
    notes: new Map(picks.filter((p) => byTask.has(p.task_id)).map((p) => [p.task_id, p.why])),
  }
}
