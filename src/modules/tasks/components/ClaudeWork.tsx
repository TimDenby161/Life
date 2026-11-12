import { ExternalLink, SendHorizontal, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDay } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import type { AiResult } from '../../../../supabase/functions/_shared/agents/work.ts'
import { useAnswerClaude } from '../hooks'

/**
 * The answer box for a question Claude asked as a task. Sending it saves the
 * answer and ticks the question off; the next morning run reads it and does
 * the job the question was for.
 */
export function ClaudeAnswer({ taskId, question, className }: { taskId: string; question: string; className?: string }) {
  const answer = useAnswerClaude()
  const [text, setText] = useState('')
  // The row around it opens the task and swipes: neither should fire from in here.
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()
  return (
    <form
      className={cn('flex gap-1.5', className)}
      onClick={stop}
      onTouchStart={stop}
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const value = text.trim()
        if (!value) return
        answer.mutate(
          { taskId, answer: value },
          { onSuccess: () => toast.success('Sent. Claude does the job in the morning.'), onError: (err) => toast.error(getErrorMessage(err)) },
        )
      }}
    >
      <Input aria-label={`Answer: ${question}`} placeholder="Answer…" maxLength={500} enterKeyHint="send" className="h-9" value={text} onChange={(e) => setText(e.target.value)} />
      <Button type="submit" size="icon" variant="outline" className="size-9 shrink-0" aria-label="Send answer" disabled={!text.trim() || answer.isPending}>
        <SendHorizontal />
      </Button>
    </form>
  )
}

/** What Claude found or wrote for a job, in full: its text, the links, and when. */
export function ClaudeResult({ result, className }: { result: AiResult; className?: string }) {
  return (
    <div className={cn('grid gap-2 rounded-xl border border-primary/25 bg-primary/5 p-3 text-sm', className)}>
      <p className="flex items-start gap-2 font-medium">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 break-words">{result.summary}</span>
      </p>
      <p className="whitespace-pre-wrap break-words leading-relaxed">{result.body}</p>
      {result.links.length ? (
        <ul className="grid gap-1">
          {result.links.map((l) => (
            <li key={l.url} className="min-w-0">
              <a href={l.url} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-full items-center gap-1 font-medium text-primary hover:underline">
                <span className="truncate">{l.title}</span>
                <ExternalLink className="size-3 shrink-0" aria-hidden />
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
