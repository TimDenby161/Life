import { formatDistanceToNow } from 'date-fns'
import { RefreshCw, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/misc'
import { formatDayInline as day } from '@/lib/dates'
import type { BriefingContent } from '../../../../supabase/functions/_shared/agents/chiefOfStaff.ts'
import { formatMinutes } from '../../../../supabase/functions/_shared/agents/taskManager.ts'
import { useLatestBriefing, useRunAgent } from '../api'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  )
}

export function BriefingCard({ onOpenTask }: { onOpenTask: (taskId: string) => void }) {
  const briefing = useLatestBriefing()
  const run = useRunAgent()
  const refresh = () =>
    run.mutate('chief_of_staff', {
      onSuccess: (r) => (r.status === 'error' ? toast.error(r.message) : r.status === 'recent' ? toast(r.message) : undefined),
    })
  const b = briefing.data
  const c = b?.content as BriefingContent | undefined

  return (
    <Card>
      <CardHeader>
        <CardTitle>{b?.kind === 'weekly' ? 'This week' : 'Today'}</CardTitle>
        <Button size="icon-sm" variant="outline" aria-label="Refresh briefing" title="Refresh briefing" onClick={refresh} disabled={run.isPending}>
          <RefreshCw className={run.isPending ? 'animate-spin' : undefined} />
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4">
        {briefing.isPending ? (
          <ListSkeleton rows={3} />
        ) : briefing.error ? (
          <ErrorState error={briefing.error} onRetry={() => briefing.refetch()} />
        ) : !b || !c ? (
          <EmptyState
            title="No briefing yet"
            description="The Chief of Staff writes one each morning after 6."
            action={<Button size="sm" onClick={refresh} disabled={run.isPending}>Get one now</Button>}
          />
        ) : (
          <>
            <div className="grid gap-1.5">
              <p className="text-lg font-semibold leading-snug">{c.headline}</p>
              {b.ai_summary ? (
                <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                  <Sparkles className="mt-0.5 size-3.5 shrink-0" />
                  <span>{b.ai_summary} <Badge tone="outline" className="ml-1 align-middle">AI</Badge></span>
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">Written {formatDistanceToNow(new Date(b.updated_at), { addSuffix: true })}</p>
            </div>

            {c.top?.length ? (
              <Section title="Top today">
                <ol className="grid gap-1 text-sm">
                  {c.top.map((p, i) => (
                    <li key={p.task_id} className="flex gap-2">
                      <span className="w-4 shrink-0 text-muted-foreground tabular">{i + 1}</span>
                      <span className="min-w-0">
                        <button className="text-left hover:underline" onClick={() => onOpenTask(p.task_id)}>{p.title}</button>
                        {p.why ? <span className="block text-xs text-muted-foreground">{p.why}</span> : null}
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="flex items-center gap-1 text-xs text-muted-foreground"><Sparkles className="size-3" /> Picked by AI this morning</p>
              </Section>
            ) : null}

            {c.calendar?.length ? (
              <Section title="Calendar">
                <ul className="grid gap-0.5 text-sm">
                  {c.calendar.map((e, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="w-11 shrink-0 text-muted-foreground tabular">{e.time ?? 'All day'}</span>
                      <span className="truncate">{e.title}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            {c.deadlines.length ? (
              <Section title="Deadlines">
                <ul className="grid gap-0.5 text-sm">
                  {c.deadlines.map((d) => (
                    <li key={d.task_id} className="flex justify-between gap-3">
                      <button className="truncate text-left hover:underline" onClick={() => onOpenTask(d.task_id)}>{d.title}</button>
                      <span className="shrink-0 text-muted-foreground tabular">{day(d.deadline)}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            {c.busy.length || c.clashes.length || c.packed?.length ? (
              <Section title="Busy">
                <ul className="grid gap-0.5 text-sm">
                  {c.packed?.map((x) => (
                    <li key={x.date}>{day(x.date)}: {x.load}{x.titles.length ? ` (${x.titles.join(', ')})` : ''}</li>
                  ))}
                  {c.busy.map((x) => (
                    <li key={x.from}>{day(x.from)} to {day(x.to)}: {x.titles.join(', ')}</li>
                  ))}
                  {c.clashes.map((x) => (
                    <li key={`${x.date}${x.time}`}>Same time, {day(x.date)} {x.time}: {x.titles.join(', ')}</li>
                  ))}
                </ul>
              </Section>
            ) : null}

            {c.partnerDone || c.added.length ? (
              <Section title="Since yesterday">
                <ul className="grid gap-0.5 text-sm">
                  {c.partnerDone ? (
                    <li>{c.partnerDone.name} finished {c.partnerDone.count}: {c.partnerDone.titles.join(', ')}</li>
                  ) : null}
                  {c.added.map((a) => (
                    <li key={a.task_id}>
                      {a.by} added <button className="hover:underline" onClick={() => onOpenTask(a.task_id)}>{a.title}</button>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            {c.plan?.length ? (
              <Section title="Plan for the week">
                <ul className="grid gap-0.5 text-sm">
                  {c.plan.map((p) => (
                    <li key={p.task_id} className="flex justify-between gap-3">
                      <button className="truncate text-left hover:underline" onClick={() => onOpenTask(p.task_id)}>
                        {p.title}{p.together ? ' (together)' : ''}
                      </button>
                      <span className={p.late ? 'shrink-0 text-destructive tabular' : 'shrink-0 text-muted-foreground tabular'}>
                        {p.deadline ? `by ${day(p.deadline)}` : p.due_date ? day(p.due_date) : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}

            {c.workload ? (
              <Section title={`Joint jobs, last ${c.workload.days} days`}>
                <ul className="grid gap-0.5 text-sm">
                  {c.workload.people.map((p) => (
                    <li key={p.id} className="flex justify-between gap-3">
                      <span>{p.name}</span>
                      <span className="text-muted-foreground tabular">{p.jobs} · ~{formatMinutes(p.minutes)}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">Time is estimated from the kind of job.</p>
              </Section>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}
