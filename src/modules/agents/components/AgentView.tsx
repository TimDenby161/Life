import { formatDistanceToNow } from 'date-fns'
import { ArrowRight, CheckCircle2, Map as MapIcon, Play, Settings2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { EmptyState, QueryState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDayInline as day, todayLabel } from '@/lib/dates'
import { TopJobsCard } from '@/modules/dashboard/DashboardPage'
import { FinanceOverview } from '@/modules/finances/components/FinanceOverview'
import { TaskDetailDialog } from '@/modules/tasks/components/TaskDetail'
import { WeddingPlan } from '@/modules/wedding/components/WeddingPlan'
import type { BriefingContent } from '../../../../supabase/functions/_shared/agents/chiefOfStaff.ts'
import { agentById } from '../../../../supabase/functions/_shared/agents/registry.ts'
import { OBSERVATION_KINDS } from '../../../../supabase/functions/_shared/agents/types.ts'
import { type Suggestion, useAgentRuns, useLatestBriefing, useRunAgent, useSuggestions } from '../api'
import type { PageAgent } from '../pageAgents'
import { AgentFlags } from './AgentFlags'
import { SuggestionCard } from './SuggestionCard'
import { TodayCalendar } from './TodayCalendar'
import { TopNews } from './TopNews'

/** Something to know rather than something to do. */
const isNote = (s: Suggestion) => !s.action && OBSERVATION_KINDS.has(s.kind)

/** A page's agent view: what its agents noticed and suggest, then when they last looked. */
export default function AgentView({ scope, onDetails }: { scope: PageAgent; onDetails: () => void }) {
  if (scope.extra === 'today') return <HomeToday />
  // Finance is the live goals and trend cards only: the agent's notes repeated them.
  if (scope.extra === 'finance') return <div className="grid grid-cols-1 gap-4"><FinanceOverview /></div>
  // Wedding is its jobs and venues: the planner's notices weren't what was needed day to day.
  if (scope.extra === 'wedding') return <WeddingPlan />
  return <AgentSuggestions scope={scope} onDetails={onDetails} />
}

/**
 * On iPhone a claude.ai link opens the Claude app, where artifacts don't fit the
 * screen; x-safari-https:// sends it to Safari instead (iOS 17+). Elsewhere the
 * link is left alone.
 */
export function inBrowser(href: string, userAgent = navigator.userAgent): string {
  const ios = /iPhone|iPad|iPod/.test(userAgent)
  return ios && href.startsWith('https://') ? `x-safari-${href}` : href
}

/** Pinned links at the top of Home. */
const HOME_LINKS = [{ label: 'Central America', href: 'https://claude.ai/artifact/7Tm8wQd2ZezWCcVMVMs3Ra', icon: MapIcon }]

/**
 * Home, sized to fit a phone screen: the news, the rest of today's calendar beside pinned links, the jobs I can
 * do today (AI-picked, home or out), led by the morning check-in until it's done, with what the agents have flagged.
 */
function HomeToday() {
  return (
    <div className="grid grid-cols-1 gap-3">
      <TopNews max={3} compact />
      <div className="flex items-stretch gap-3">
        <div className="min-w-0 flex-1">
          <TodayCalendar max={3} compact />
        </div>
        {HOME_LINKS.map(({ label, href, icon: Icon }) => (
          <a
            key={href}
            href={inBrowser(href)}
            target="_blank"
            rel="noreferrer noopener"
            className="grid w-20 shrink-0 place-content-center justify-items-center gap-1 rounded-xl border bg-card p-2 text-center text-xs font-medium leading-tight shadow-[0_1px_2px_rgb(0_0_0/0.03)] hover:bg-muted/60"
          >
            <Icon className="size-5 text-primary" />
            {label}
          </a>
        ))}
      </div>
      <TopJobsCard title="Today’s tasks" limit={4} checkIn footer={<AgentFlags max={2} />} />
    </div>
  )
}

function AgentSuggestions({ scope, onDetails }: { scope: PageAgent; onDetails: () => void }) {
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
      <CardHeader><CardTitle>{todayLabel()}</CardTitle></CardHeader>
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
  const ids = scope.agents
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
