import { formatDistanceToNow } from 'date-fns'
import { QueryState } from '@/components/states'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/misc'
import { formatDateTime } from '@/lib/dates'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { agentById } from '../../../../supabase/functions/_shared/agents/registry.ts'
import { type AgentRun, useAgentActions, useAgentRuns } from '../api'

const TONE = { succeeded: 'success', failed: 'danger', running: 'primary', queued: 'neutral' } as const

export function RunStatus({ run }: { run: AgentRun }) {
  return <Badge tone={TONE[run.status as keyof typeof TONE] ?? 'neutral'}>{run.status}</Badge>
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const TRIGGER: Record<string, string> = { scheduled: 'Scheduled', event: 'After a task was done', manual: 'Run now' }
const RESPONSE: Record<string, string> = { approved: 'Approved', dismissed: 'Dismissed', snoozed: 'Snoozed' }

/** Dollars from millionths, to a tenth of a cent. */
const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(micro && micro < 10_000 ? 4 : 3)}`

export function HistoryTab() {
  const runs = useAgentRuns()
  const actions = useAgentActions()
  const { member } = useHousehold()
  const month = new Date().toISOString().slice(0, 7)

  return (
    <div className="grid grid-cols-1 gap-4">
      <Card>
        <CardHeader>
          <CardTitle>AI use this month</CardTitle>
        </CardHeader>
        <CardContent>
          <QueryState query={runs}>
            {(rows) => {
              const thisMonth = rows.filter((r) => r.created_at.startsWith(month))
              const tokens = thisMonth.reduce((n, r) => n + r.llm_input_tokens + r.llm_output_tokens, 0)
              const cost = thisMonth.reduce((n, r) => n + Number(r.llm_cost_micro_usd), 0)
              return (
                <p className="text-sm">
                  {tokens ? `${tokens.toLocaleString()} tokens · ${usd(cost)} estimated` : 'None: every run so far used rules only, at no cost.'}
                </p>
              )
            }}
          </QueryState>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Runs</CardTitle>
        </CardHeader>
        <CardContent>
          <QueryState query={runs}>
            {(rows) =>
              rows.length ? (
                <ul className="divide-y">
                  {rows.map((r) => (
                    <li key={r.id} className="grid gap-0.5 py-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{agentById(r.agent_id)?.name ?? r.agent_id}</span>
                        <RunStatus run={r} />
                        <span className="ml-auto text-xs text-muted-foreground" title={formatDateTime(r.created_at)}>
                          {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-muted-foreground">
                        {TRIGGER[r.trigger] ?? r.trigger}
                        {r.trigger === 'manual' && r.requested_by ? ` by ${member(r.requested_by)?.display_name ?? 'someone'}` : ''}
                        {r.status === 'succeeded' ? ` · ${r.briefings_count ? plural(r.briefings_count, 'briefing') : plural(r.suggestions_count, 'suggestion')}` : ''}
                        {r.attempts > 1 ? ` · attempt ${r.attempts}` : ''}
                        {r.llm_cost_micro_usd ? ` · ${usd(Number(r.llm_cost_micro_usd))}` : ''}
                      </p>
                      {r.error ? <p className="text-destructive">{r.error}</p> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No runs yet.</p>
              )
            }
          </QueryState>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What you did with suggestions</CardTitle>
        </CardHeader>
        <CardContent>
          <QueryState query={actions}>
            {(rows) =>
              rows.length ? (
                <ul className="divide-y">
                  {rows.map((a) => (
                    <li key={a.id} className="flex items-baseline gap-2 py-2 text-sm">
                      <Badge tone={a.response === 'approved' ? 'success' : 'neutral'}>{RESPONSE[a.response] ?? a.response}</Badge>
                      <span className="min-w-0 flex-1 truncate">{a.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {member(a.actor_id)?.display_name} · {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Nothing approved, snoozed or dismissed yet.</p>
              )
            }
          </QueryState>
        </CardContent>
      </Card>
    </div>
  )
}
