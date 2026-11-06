import { ArrowRight, CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState, QueryState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc'
import { todayISO } from '@/lib/dates'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { TaskDetailDialog } from '@/modules/tasks/components/TaskDetail'
import { useOpenOccurrences, useTaskCategories, useTaskLists } from '@/modules/tasks/hooks'
import { inView } from '@/modules/tasks/lib/owner'
import { isOutOfHours, taskScore, topJobs } from '@/modules/tasks/lib/topJobs'
import { waitingOnTitle } from '@/modules/tasks/lib/waiting'
import { type Suggestion, useSuggestions } from './api'
import { AgentsTab } from './components/AgentsTab'
import { BriefingCard } from './components/BriefingCard'
import { HistoryTab } from './components/HistoryTab'
import { SuggestionCard } from './components/SuggestionCard'

const TABS = ['overview', 'suggestions', 'agents', 'history'] as const
type Tab = (typeof TABS)[number]

/** Snoozed suggestions wait in their own list until their day. */
const isPending = (s: Suggestion) => s.status === 'pending'

export default function AiHubPage() {
  const [params, setParams] = useSearchParams()
  const tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'overview'
  const setTab = (v: string) => setParams((p) => { p.set('tab', v); return p }, { replace: true })
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const suggestions = useSuggestions()
  const pending = suggestions.data?.filter(isPending).length ?? 0

  return (
    <>
      <PageHeader title="AI Hub" description="Helpers that notice things and suggest. Nothing changes until you approve it." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="max-w-full">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="suggestions">Suggestions{pending ? ` ${pending}` : ''}</TabsTrigger>
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <BriefingCard onOpenTask={setOpenTaskId} />
            <div className="grid grid-cols-1 content-start gap-4">
              <FocusCard />
              <Card>
                <CardHeader>
                  <CardTitle>Suggestions</CardTitle>
                  {pending > 3 ? (
                    <Button size="sm" variant="ghost" onClick={() => setTab('suggestions')}>
                      All {pending} <ArrowRight />
                    </Button>
                  ) : null}
                </CardHeader>
                <CardContent>
                  <SuggestionList items={suggestions.data?.filter(isPending).slice(0, 3)} query={suggestions} onOpenTask={setOpenTaskId} />
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="suggestions">
          <Card>
            <CardContent className="pt-2">
              <SuggestionList items={suggestions.data?.filter(isPending)} query={suggestions} onOpenTask={setOpenTaskId} />
            </CardContent>
          </Card>
          {suggestions.data?.some((s) => !isPending(s)) ? (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>Snoozed</CardTitle>
              </CardHeader>
              <CardContent>
                <SuggestionList items={suggestions.data.filter((s) => !isPending(s))} query={suggestions} onOpenTask={setOpenTaskId} />
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>
        <TabsContent value="agents"><AgentsTab /></TabsContent>
        <TabsContent value="history"><HistoryTab /></TabsContent>
      </Tabs>
      <TaskDetailDialog taskId={openTaskId} onClose={() => setOpenTaskId(null)} />
    </>
  )
}

function SuggestionList({
  items,
  query,
  onOpenTask,
}: {
  items: Suggestion[] | undefined
  query: ReturnType<typeof useSuggestions>
  onOpenTask: (taskId: string) => void
}) {
  return (
    <QueryState query={query}>
      {() =>
        items?.length ? (
          <ul className="divide-y">
            {items.map((s) => <SuggestionCard key={s.id} suggestion={s} onOpenTask={onOpenTask} />)}
          </ul>
        ) : (
          <EmptyState icon={CheckCircle2} title="Nothing to suggest" description="The agents check again each morning and after tasks are done." className="py-6" />
        )
      }
    </QueryState>
  )
}

/** The live top of my list, the same ranking as Top jobs on Home; the briefing doesn't redo it. */
function FocusCard() {
  const { me } = useHousehold()
  const open = useOpenOccurrences()
  const lists = useTaskLists().data ?? []
  const categories = useTaskCategories().data ?? []
  const today = todayISO()
  const mine = open.data?.filter((o) => inView(o.task, me.id, categories, lists) && !waitingOnTitle(o.task, open.data) && !isOutOfHours(o.task, categories))
  const top = topJobs(mine ?? [], categories, today, 3).filter((o) => taskScore(o, categories, today) > 0)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Focus now</CardTitle>
        <Button size="sm" variant="ghost" asChild>
          <Link to="/?view=details">Top jobs <ArrowRight /></Link>
        </Button>
      </CardHeader>
      <CardContent>
        <QueryState query={open}>
          {() =>
            top.length ? (
              <ol className="grid gap-1 text-sm">
                {top.map((o, i) => (
                  <li key={o.id} className="flex gap-2">
                    <span className="w-4 text-muted-foreground tabular">{i + 1}</span>
                    <span className="truncate">{o.task.title}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing pressing.</p>
            )
          }
        </QueryState>
      </CardContent>
    </Card>
  )
}
