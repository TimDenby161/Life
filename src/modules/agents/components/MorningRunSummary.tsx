import { CheckCircle2, ChevronDown, Sparkles } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { todayISO } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { ClaudeAnswer, ClaudeResult } from '@/modules/tasks/components/ClaudeWork'
import { useAnsweredQuestions, useOpenOccurrences } from '@/modules/tasks/hooks'
import { useAcceptAiWork, useAiPriorities, useAiWorkSeen } from '../api'
import { type MorningRun, morningRun } from '../lib/morningRun'

/**
 * Over Home, once a day: what the morning run did (each opens to show it all)
 * and the questions it needs answering, until accepted. Only for people with AI
 * picks on, and only on days the run did or asked something. Accepting closes
 * it on every device.
 */
export function MorningRunSummary() {
  const today = todayISO()
  const on = useAiPriorities().data ?? false
  const seen = useAiWorkSeen()
  const open = useOpenOccurrences()
  const answeredQs = useAnsweredQuestions()
  const accept = useAcceptAiWork()
  const [closed, setClosed] = useState(false)
  const shown = useRef(false)

  if (!on || seen.isPending || seen.data === today || !open.data) return null
  const run = morningRun(open.data, today, answeredQs.data)
  // Once shown it stays until accepted: answering the last question doesn't snatch it away.
  if (run.news) shown.current = true
  if (!shown.current) return null

  const done = () => {
    setClosed(true)
    accept.mutate(today, { onError: (e) => toast.error(getErrorMessage(e)) })
  }

  return (
    <Dialog open={!closed} onOpenChange={(o) => !o && done()}>
      <DialogContent title="This morning" description="What Claude did for you">
        <MorningRunBody did={run.did} asks={run.asks} answered={run.answered} />
        <DialogFooter>
          <Button onClick={done}>Accept</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** What Claude did (each opens to show it all) and the questions it needs answering. */
export function MorningRunBody({ did, asks, answered, emptyText = 'All answered. Claude does those jobs in the morning.' }: Pick<MorningRun, 'did' | 'asks' | 'answered'> & { emptyText?: string }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  return (
    <div className="grid gap-4">
      {did.length ? (
        <ul className="grid gap-2">
          {did.map((d) => {
            const isOpen = expanded === d.taskId
            return (
              <li key={d.taskId} className="grid gap-2">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(isOpen ? null : d.taskId)}
                  className="flex items-start gap-2 rounded-xl border p-3 text-left text-sm hover:bg-muted/60"
                >
                  <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{d.result.summary}</span>
                    <span className="block truncate text-xs text-muted-foreground">{d.title}</span>
                  </span>
                  <ChevronDown className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} aria-hidden />
                </button>
                {isOpen ? <ClaudeResult result={d.result} /> : null}
              </li>
            )
          })}
        </ul>
      ) : null}

      {asks.length ? (
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold">Needs you</h3>
          <ul className="grid gap-3">
            {asks.map((a) => (
              <li key={a.taskId} className="grid gap-1.5 text-sm">
                <span>{a.question}</span>
                {a.forTitle ? <span className="text-xs text-muted-foreground">For “{a.forTitle}”</span> : null}
                <ClaudeAnswer taskId={a.taskId} question={a.question} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {answered.length ? (
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold">Answered</h3>
          <ul className="grid gap-3">
            {answered.map((a) => (
              <li key={a.taskId} className="grid gap-1.5 text-sm">
                <span className="text-muted-foreground">{a.question}</span>
                <p className="flex items-start gap-2 rounded-xl bg-muted/60 px-3 py-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                  <span className="min-w-0 whitespace-pre-wrap break-words">{a.answer}</span>
                </p>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">Claude does these the next morning.</p>
        </div>
      ) : null}

      {!did.length && !asks.length && !answered.length ? <p className="text-sm text-muted-foreground">{emptyText}</p> : null}
    </div>
  )
}
