import { formatDistanceToNow } from 'date-fns'
import { ArrowRight, CheckCircle2, Play, Settings2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { EmptyState, QueryState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDayInline as day } from '@/lib/dates'
import { TaskDetailDialog } from '@/modules/tasks/components/TaskDetail'
import type { BriefingContent } from '../../../../supabase/functions/_shared/agents/chiefOfStaff.ts'
import { agentById } from '../../../../supabase/functions/_shared/agents/registry.ts'
import { OBSERVATION_KINDS } from '../../../../supabase/functions/_shared/agents/types.ts'
import { type Suggestion, useAgentRuns, useLatestBriefing, useRunAgent, useSuggestions } from '../api'
import type { PageAgent } from '../pageAgents'
import { BriefingCard } from './BriefingCard'
import { SuggestionCard } from './SuggestionCard'

/** Something to know rather than something to do. */
const isNote = (s: Suggestion) => !s.action && OBSERVATION_KINDS.has(s.kind)

/** A page's agent view: what its agents noticed and suggest, then when they last looked. */
export default function AgentView({ scope, onDetails }: { scope: PageAgent; onDetails: () => void }) {
  const suggestions = useSuggestions()
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const mine = (suggestions.data ?? [])
    .filter((s) => s.status === 'pending' && (scope.agents as string[]).includes(s.agent_id) && (!scope.kinds || scope.kinds.includes(s.kind)))
    .slice(0, scope.limit)
  const notes = mine.filter(isNote)
  const todo = mine.filter((s) => !isNote(s))
  const list = (items: Suggestion[]) => (
    <ul className="divide-y">
      {items.map((s) => <SuggestionCard key={s.id} suggestion={s} onOpenTask={setOpenTaskId} />)}
    </ul>
  )

  return (
    <div className="grid grid-cols-1 gap-4">
      {scope.extra === 'briefing' ? <BriefingCard onOpenTask={setOpenTaskId} /> : null}
      {scope.extra === 'calendar' ? <CalendarCard /> : null}

      <QueryState query={suggestions}>
        {() =>
          mine.length ? (
            <>
              {notes.length ? (
                <Card>
                  <CardHeader><CardTitle>Noticed</CardTitle></CardHeader>
                  <CardContent>{list(notes)}</CardContent>
                </Card>
              ) : null}
              {todo.length ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Suggested</CardTitle>
                    {scope.limit ? (
                      <Button size="sm" variant="ghost" asChild>
                        <Link to="/ai?tab=suggestions">All <ArrowRight /></Link>
                      </Button>
                    ) : null}
                  </CardHeader>
                  <CardContent>{list(todo)}</CardContent>
                </Card>
              ) : null}
            </>
          ) : (
            <Card>
              <CardContent>
                <EmptyState
                  icon={CheckCircle2}
                  title="Nothing right now"
                  description="The agents look again each morning, and after tasks are done."
                  action={<Button size="sm" variant="outline" onClick={onDetails}>Open details</Button>}
                  className="py-6"
                />
              </CardContent>
            </Card>
          )
        }
      </QueryState>

      <AgentsFooter scope={scope} />
      <TaskDetailDialog taskId={openTaskId} onClose={() => setOpenTaskId(null)} />
    </div>
  )
}

/** Today's calendar and packed days ahead, from my latest briefing. */
function CalendarCard() {
  const briefing = useLatestBriefing()
  const c = briefing.data?.content as BriefingContent | undefined
  if (!c?.calendar && !c?.packed?.length) return null
  return (
    <Card>
      <CardHeader><CardTitle>Today</CardTitle></CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {c.calendar?.length ? (
          <ul className="grid gap-0.5">
            {c.calendar.map((e, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-11 shrink-0 text-muted-foreground tabular">{e.time ?? 'All day'}</span>
                <span className="truncate">{e.title}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">Nothing in the calendar today.</p>
        )}
        {c.packed?.length ? (
          <div className="grid gap-0.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Packed days</h3>
            <ul className="grid gap-0.5">
              {c.packed.map((x) => (
                <li key={x.date}>{day(x.date)}: {x.load}{x.titles.length ? ` (${x.titles.join(', ')})` : ''}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">As of this morning’s briefing{briefing.data ? `, ${formatDistanceToNow(new Date(briefing.data.updated_at), { addSuffix: true })}` : ''}.</p>
      </CardContent>
    </Card>
  )
}

/** When each agent last looked, with Run now (Home lists only the Chief of Staff). */
function AgentsFooter({ scope }: { scope: PageAgent }) {
  const runs = useAgentRuns()
  const run = useRunAgent()
  const ids = scope.extra === 'briefing' ? (['chief_of_staff'] as const) : scope.agents
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
      {ids.map((id) => {
        const agent = agentById(id)
        const last = runs.data?.find((r) => r.agent_id === id)
        return (
          <span key={id} className="flex items-center gap-2">
            {agent?.name} {last ? `· ${formatDistanceToNow(new Date(last.created_at), { addSuffix: true })}` : '· not run yet'}
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              disabled={run.isPending}
              onClick={() =>
                run.mutate(id, {
                  onSuccess: (r) => (r.status === 'ok' ? toast.success(`${agent?.name} ran`) : r.status === 'recent' ? toast(r.message) : toast.error(r.message)),
                })
              }
            >
              <Play /> Run now
            </Button>
          </span>
        )
      })}
      <Button size="sm" variant="ghost" className="h-7" asChild>
        <Link to="/ai?tab=agents"><Settings2 /> Agent settings</Link>
      </Button>
    </div>
  )
}
