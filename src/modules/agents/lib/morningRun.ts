import { toISODate } from '@/lib/dates'
import { type AiResult, parseAiResult } from '../../../../supabase/functions/_shared/agents/work.ts'

type Open = {
  task_id: string
  task: { title: string; created_at: string; ai_asks_task_id: string | null; ai_answer?: string | null; ai_result: unknown }
}

export type MorningRun = {
  /** Jobs the run did today, still open (you tick them off). */
  did: { taskId: string; title: string; result: AiResult }[]
  /** Every question still waiting for an answer, today's first. */
  asks: { taskId: string; question: string; forTitle: string | null; today: boolean }[]
  /** Questions you've answered whose job Claude hasn't done yet, with what you said. */
  answered: { taskId: string; question: string; answer: string; forTitle: string | null }[]
  /** Whether today's run did or asked anything: the pop-up only shows then. */
  news: boolean
}

/** Every open job Claude left a result on, newest first. */
export function claudeResults(open: Open[]): MorningRun['did'] {
  return open
    .flatMap((o) => {
      const result = parseAiResult(o.task.ai_result)
      return result ? [{ taskId: o.task_id, title: o.task.title, result }] : []
    })
    .toSorted((a, b) => (b.result.day ?? '').localeCompare(a.result.day ?? ''))
}

type Answered = { id: string; title: string; ai_answer: string | null; ai_asks_task_id: string | null }

/** What the morning run did and asked, from the open tasks and the questions you've answered. */
export function morningRun(open: Open[], today: string, answeredRows: Answered[] = []): MorningRun {
  const titleOf = (taskId: string) => open.find((o) => o.task_id === taskId)?.task.title ?? null
  const did = claudeResults(open).filter((d) => d.result.day === today)
  const asks = open
    // An answered question is done with, even before its tick-off reaches this screen.
    .filter((o) => o.task.ai_asks_task_id && !o.task.ai_answer)
    .map((o) => ({
      taskId: o.task_id,
      question: o.task.title,
      forTitle: titleOf(o.task.ai_asks_task_id!),
      today: toISODate(new Date(o.task.created_at)) === today,
    }))
    .toSorted((a, b) => Number(b.today) - Number(a.today))
  // Kept while the job is still open and Claude hasn't left a result on it yet.
  const answered = answeredRows.flatMap((q) => {
    const job = open.find((o) => o.task_id === q.ai_asks_task_id)
    return q.ai_answer && job && !parseAiResult(job.task.ai_result)
      ? [{ taskId: q.id, question: q.title, answer: q.ai_answer, forTitle: job.task.title }]
      : []
  })
  return { did, asks, answered, news: did.length > 0 || asks.some((a) => a.today) }
}
