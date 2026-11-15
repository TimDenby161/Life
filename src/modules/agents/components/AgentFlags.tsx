import { Check, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useRespond, useSuggestions } from '../api'
import { approveLabel } from './SuggestionCard'

/**
 * The most important things the agents have flagged for me, one line each, for
 * the foot of Home's task list: its own action (Add task, Move…) and dismiss.
 * The full reasons and the rest are in the AI Hub.
 */
export function AgentFlags({ max = 2 }: { max?: number }) {
  const suggestions = useSuggestions()
  const respond = useRespond()
  const top = (suggestions.data ?? []).filter((s) => s.status === 'pending' && s.severity >= 2).slice(0, max)
  if (!top.length) return null
  const act = (id: string, response: 'approve' | 'dismiss') =>
    respond.mutate({ id, response }, { onSuccess: () => response === 'approve' && toast.success('Done'), onError: (e) => toast.error(getErrorMessage(e)) })
  return (
    <ul className="mx-1 mt-1 grid gap-0.5 border-t pt-1.5 sm:mx-2">
      {top.map((s) => {
        const label = approveLabel(s)
        return (
          // On a phone the title wraps (two lines at most) with its action underneath; wider screens keep one line.
          <li key={s.id} className="flex items-start gap-2 py-0.5 text-sm sm:items-center">
            <Sparkles className={cn('mt-0.5 size-3.5 shrink-0 sm:mt-0', s.severity >= 3 ? 'text-destructive' : 'text-warning')} />
            <div className="flex min-w-0 flex-1 flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
              <span className="line-clamp-2 min-w-0 leading-snug sm:flex-1" title={s.reason}>
                {s.title}
              </span>
              {label ? (
                <Button size="sm" variant="outline" className="h-7 shrink-0 px-2" disabled={respond.isPending} onClick={() => act(s.id, 'approve')}>
                  <Check /> {label}
                </Button>
              ) : null}
            </div>
            <Button size="icon-sm" variant="ghost" className="-mt-1 shrink-0 sm:mt-0" aria-label={`Dismiss ${s.title}`} disabled={respond.isPending} onClick={() => act(s.id, 'dismiss')}>
              <X />
            </Button>
          </li>
        )
      })}
    </ul>
  )
}
