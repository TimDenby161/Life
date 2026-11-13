import { ExternalLink, Sparkles } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDay } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import type { AiResult } from '../../../../supabase/functions/_shared/agents/work.ts'
import { useAnswerClaude } from '../hooks'

/**
 * The answer box for a question Claude asked as a task. The answer saves on
 * Save, on Enter, or as soon as you leave the box (so tapping Accept or
 * closing the pop-up never loses it); saving ticks the question off and the
 * next morning run reads it and does the job the question was for.
 */
export function ClaudeAnswer({ taskId, question, className }: { taskId: string; question: string; className?: string }) {
  const answer = useAnswerClaude()
  const [text, setText] = useState('')
  const sent = useRef(false)
  // The row around it opens the task and swipes: neither should fire from in here.
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()
  const save = () => {
    const value = text.trim()
    if (!value || sent.current) return
    sent.current = true
    answer.mutate(
      { taskId, answer: value },
      {
        onSuccess: () => toast.success('Saved. Claude does the job in the morning.'),
        onError: (err) => {
          sent.current = false
          toast.error(getErrorMessage(err))
        },
      },
    )
  }
  if (answer.isSuccess) return <p className={cn('text-sm font-medium', className)}>{answer.variables.answer}</p>
  return (
    <form
      className={cn('flex gap-1.5', className)}
      onClick={stop}
      onTouchStart={stop}
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        save()
      }}
    >
      <Input
        aria-label={`Answer: ${question}`}
        placeholder="Answer…"
        maxLength={500}
        enterKeyHint="done"
        className="h-9"
        value={text}
        disabled={answer.isPending}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
      />
      <Button type="submit" size="sm" className="h-9 shrink-0" disabled={!text.trim() || answer.isPending}>
        {answer.isPending ? 'Saving…' : 'Save'}
      </Button>
    </form>
  )
}

/** What Claude found or wrote for a job, in full: its text, the links, and when. */
export function ClaudeResult({ result, className, showSummary = true }: { result: AiResult; className?: string; showSummary?: boolean }) {
  return (
    <div className={cn('grid gap-2 rounded-xl border border-primary/25 bg-primary/5 p-3 text-sm', className)}>
      {showSummary ? (
        <p className="flex items-start gap-2 font-medium">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 break-words">{result.summary}</span>
        </p>
      ) : null}
      <p className="whitespace-pre-wrap break-words leading-relaxed">{result.body}</p>
      {result.links.length ? (
        <ul className="grid gap-1">
          {result.links.map((l) => (
            <li key={l.url} className="min-w-0">
              <a href={l.url} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-full items-start gap-1 py-1 font-medium text-primary hover:underline">
                <span className="min-w-0 break-words">{l.title}</span>
                <ExternalLink className="mt-1 size-3 shrink-0" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Claude, from a web search{result.day ? ` · ${formatDay(result.day)}` : ''} · Check the details before relying on them.
      </p>
    </div>
  )
}
