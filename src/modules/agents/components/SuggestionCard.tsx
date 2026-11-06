import { AlarmClock, AlertTriangle, Check, CircleDot, Info, X } from 'lucide-react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { addDaysISO, formatDayInline, todayISO } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { type Action, OBSERVATION_KINDS } from '../../../../supabase/functions/_shared/agents/types.ts'
import { agentById } from '../../../../supabase/functions/_shared/agents/registry.ts'
import { type Suggestion, useRespond } from '../api'

const SEVERITY = {
  3: { icon: AlertTriangle, className: 'text-destructive' },
  2: { icon: CircleDot, className: 'text-warning' },
  1: { icon: Info, className: 'text-muted-foreground' },
} as const

/** What pressing Approve does, in a few words. */
export function approveLabel(s: Pick<Suggestion, 'action' | 'task_id' | 'kind'>): string | null {
  const action = s.action as Action | null
  if (!action) return s.task_id || OBSERVATION_KINDS.has(s.kind) ? null : 'Add as task'
  if (action.type === 'create_task') return action.recurrence ? 'Add job' : 'Add task'
  if (action.type === 'move_due_date') return `Move to ${formatDayInline(action.due_date)}`
  return 'Archive'
}

/** Where an agent's suggestions are about, for a link when there's no single task. */
const AGENT_PAGE: Record<string, { to: string; label: string }> = {
  wedding: { to: '/wedding', label: 'Wedding' },
  language_coach: { to: '/languages', label: 'Languages' },
  health_coach: { to: '/health', label: 'Health' },
  household: { to: '/jobs', label: 'Jobs' },
  finance: { to: '/finances', label: 'Finances' },
  life_admin: { to: '/ai?tab=agents', label: 'Renewals' },
}

const DONE_MESSAGE: Record<string, string> = { create_task: 'Added to Tasks', move_due_date: 'Date moved', archive_task: 'Archived' }

export function SuggestionCard({ suggestion: s, onOpenTask }: { suggestion: Suggestion; onOpenTask: (taskId: string) => void }) {
  const respond = useRespond()
  const { icon: Icon, className } = SEVERITY[s.severity as 1 | 2 | 3] ?? SEVERITY[1]
  const label = approveLabel(s)
  const today = todayISO()
  const act = (response: 'approve' | 'dismiss' | 'snooze', snoozeUntil?: string) =>
    respond.mutate(
      { id: s.id, response, snoozeUntil },
      {
        onSuccess: () => {
          if (response === 'approve') toast.success(DONE_MESSAGE[(s.action as Action | null)?.type ?? 'create_task'])
          if (response === 'snooze') toast(`Back ${formatDayInline(snoozeUntil!)}`)
        },
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    )

  return (
    <li className="flex gap-3 py-3">
      <Icon className={cn('mt-0.5 size-4 shrink-0', className)} aria-label={`Severity ${s.severity}`} />
      <div className="grid min-w-0 flex-1 gap-1.5">
        <p className="font-medium leading-snug">{s.title}</p>
        <p className="text-sm text-muted-foreground">{s.reason}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {label ? (
            <Button size="sm" onClick={() => act('approve')} disabled={respond.isPending}>
              <Check /> {label}
            </Button>
          ) : null}
          {s.task_id ? (
            <Button size="sm" variant="outline" onClick={() => onOpenTask(s.task_id!)}>
              Open task
            </Button>
          ) : AGENT_PAGE[s.agent_id] ? (
            <Button size="sm" variant="outline" asChild>
              <Link to={AGENT_PAGE[s.agent_id].to}>Open {AGENT_PAGE[s.agent_id].label}</Link>
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" disabled={respond.isPending}>
                <AlarmClock /> Later
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => act('snooze', addDaysISO(today, 1))}>Tomorrow</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => act('snooze', addDaysISO(today, 7))}>In a week</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => act('snooze', addDaysISO(today, 30))}>In a month</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="ghost" onClick={() => act('dismiss')} disabled={respond.isPending} aria-label="Dismiss">
            <X /> Dismiss
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">
            {s.status === 'snoozed' && s.snoozed_until ? `Snoozed to ${formatDayInline(s.snoozed_until)} · ` : ''}
            {agentById(s.agent_id)?.name ?? s.agent_id}
            {s.recipients.length > 1 ? ' · for both' : ''}
          </span>
        </div>
      </div>
    </li>
  )
}
