import { toISODate } from '@/lib/dates'
import { type AiResult, parseAiResult } from '../../../../supabase/functions/_shared/agents/work.ts'

type Open = {
  task_id: string
  task: { title: string; created_at: string; ai_asks_task_id: string | null; ai_result: unknown }
}

export type MorningRun = {
  /** Jobs the run did today, still open (you tick them off). */
  did: { taskId: string; title: string; result: AiResult }[]
  /** Every question still waiting for an answer, today's first. */
  asks: { taskId: string; question: string; forTitle: string | null; today: boolean }[]
  /** Whether today's run did or asked anything: the pop-up only shows then. */
  news: boolean
}

/** What the morning run did and asked, from the open tasks. */
export function morningRun(open: Open[], today: string): MorningRun {
  const titleOf = (taskId: string) => open.find((o) => o.task_id === taskId)?.task.title ?? null
  const did = open.flatMap((o) => {
    const result = parseAiResult(o.task.ai_result)
    return result && result.day === today ? [{ taskId: o.task_id, title: o.task.title, result }] : []
  })
  const asks = open
    .filter((o) => o.task.ai_asks_task_id)
    .map((o) => ({
      taskId: o.task_id,
      question: o.task.title,
      forTitle: titleOf(o.task.ai_asks_task_id!),
      today: toISODate(new Date(o.task.created_at)) === today,
    }))
    .toSorted((a, b) => Number(b.today) - Number(a.today))
  return { did, asks, news: did.length > 0 || asks.some((a) => a.today) }
}
