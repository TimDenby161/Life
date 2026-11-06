import { formatDistanceToNow } from 'date-fns'
import { Play } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge, Segmented, Switch } from '@/components/ui/misc'
import { getErrorMessage } from '@/lib/errors'
import { AGENTS, type AgentDef, type AgentSchedule } from '../../../../supabase/functions/_shared/agents/registry.ts'
import { type AgentRun, useAgentRuns, useAgentSettings, useAiSummaries, useRunAgent, useSaveAgentSetting, useSetAiSummaries } from '../api'
import { FitnessGoals } from './FitnessGoals'
import { RunStatus } from './HistoryTab'

function LiveAgent({ agent, lastRun }: { agent: AgentDef; lastRun: AgentRun | undefined }) {
  const settings = useAgentSettings()
  const save = useSaveAgentSetting()
  const run = useRunAgent()
  const row = settings.data?.find((s) => s.agent_id === agent.id)
  const enabled = row?.enabled ?? true
  const schedule = (row?.schedule ?? 'daily') as AgentSchedule
  const change = (patch: { enabled?: boolean; schedule?: AgentSchedule }) =>
    save.mutate({ agentId: agent.id, enabled, schedule, ...patch }, { onError: (e) => toast.error(getErrorMessage(e)) })

  return (
    <Card className="grid gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">{agent.name}</h3>
          <p className="text-sm text-muted-foreground">{agent.summary}</p>
        </div>
        <Switch checked={enabled} onCheckedChange={(v) => change({ enabled: v })} aria-label={`${agent.name} on`} disabled={settings.isPending || save.isPending} />
      </div>
      {agent.schedules.length ? (
        <Segmented
          aria-label={`${agent.name} schedule`}
          size="sm"
          className="w-fit"
          value={schedule}
          onChange={(v) => change({ schedule: v as AgentSchedule })}
          options={agent.schedules.map((s) => ({ value: s, label: s === 'daily' ? 'Every morning' : 'Mondays' }))}
        />
      ) : (
        <p className="text-sm">{agent.runs}</p>
      )}
      {agent.id === 'health_coach' ? <FitnessGoals key={row ? 'saved' : 'new'} row={row} /> : null}
      <dl className="grid gap-1 text-sm sm:grid-cols-[8rem_1fr]">
        <dt className="text-muted-foreground">Reads</dt>
        <dd>{agent.reads.join(', ')}</dd>
        <dt className="text-muted-foreground">Can, if you approve</dt>
        <dd>{agent.can.length ? agent.can.join(', ') : 'Nothing: it only reports'}</dd>
        <dt className="text-muted-foreground">Last run</dt>
        <dd className="flex items-center gap-2">
          {lastRun ? (
            <>
              {formatDistanceToNow(new Date(lastRun.created_at), { addSuffix: true })} <RunStatus run={lastRun} />
            </>
          ) : (
            'Not yet'
          )}
        </dd>
      </dl>
      <div>
        <Button
          size="sm"
          variant="outline"
          disabled={!enabled || run.isPending}
          onClick={() =>
            run.mutate(agent.id, {
              onSuccess: (r) => (r.status === 'ok' ? toast.success(`${agent.name} ran`) : r.status === 'recent' ? toast(r.message) : toast.error(r.message)),
            })
          }
        >
          <Play /> Run now
        </Button>
      </div>
    </Card>
  )
}

function AiSummaries() {
  const on = useAiSummaries()
  const set = useSetAiSummaries()
  return (
    <Card className="grid gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">AI sentence on my briefing</h3>
          <p className="text-sm text-muted-foreground">
            Adds one sentence written by Claude to your morning briefing. It sends Anthropic your briefing’s task titles, counts and dates, nothing
            else. Off by default; only works once an API key is set on the server, and stops at the monthly spending cap.
          </p>
        </div>
        <Switch
          checked={on.data ?? false}
          onCheckedChange={(v) => set.mutate(v, { onError: (e) => toast.error(getErrorMessage(e)) })}
          aria-label="AI sentence on my briefing"
          disabled={on.isPending}
        />
      </div>
    </Card>
  )
}

export function AgentsTab() {
  const runs = useAgentRuns()
  const lastRun = (id: string) => runs.data?.find((r) => r.agent_id === id)
  return (
    <div className="grid grid-cols-1 gap-3">
      <p className="text-sm text-muted-foreground">These settings are yours alone; your partner has their own.</p>
      {AGENTS.filter((a) => a.status === 'live').map((a) => (
        <LiveAgent key={a.id} agent={a} lastRun={lastRun(a.id)} />
      ))}
      <AiSummaries />
      <h2 className="mt-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Not built yet</h2>
      {AGENTS.filter((a) => a.status === 'planned').map((a) => (
        <Card key={a.id} className="grid gap-1 p-4 opacity-80">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{a.name}</h3>
            <Badge tone="outline">Not built yet</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{a.summary}</p>
          <p className="text-sm">{a.blockedBy}</p>
        </Card>
      ))}
    </div>
  )
}
