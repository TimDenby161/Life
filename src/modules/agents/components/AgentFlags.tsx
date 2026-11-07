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
          <li key={s.id} className="flex items-center gap-2 text-sm">
            <Sparkles className={cn('size-3.5 shrink-0', s.severity >= 3 ? 'text-destructive' : 'text-warning')} />
            <span className="min-w-0 flex-1 truncate" title={s.reason}>{s.title}</span>
            {label ? (
              <Button size="sm" variant="outline" className="h-7 px-2" disabled={respond.isPending} onClick={() => act(s.id, 'approve')}>
                <Check /> {label}
              </Button>
            ) : null}
            <Button size="icon-sm" variant="ghost" aria-label={`Dismiss ${s.title}`} disabled={respond.isPending} onClick={() => act(s.id, 'dismiss')}>
              <X />
            </Button>
          </li>
        )
      })}
    </ul>
  )
}
