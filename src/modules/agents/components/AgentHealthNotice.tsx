import { TriangleAlert } from 'lucide-react'
import { Link } from 'react-router'
import { useAgentRuns } from '../api'
import { agentHealth } from '../lib/agentHealth'
import { agentById } from '../../../../supabase/functions/_shared/agents/registry.ts'

/** On Home, only when this morning's agents didn't all run: a line saying which, linking to their history. */
export function AgentHealthNotice() {
  const runs = useAgentRuns()
  const health = runs.data ? agentHealth(runs.data, new Date()) : null
  if (!health) return null
  const names = health.failed.map((id) => agentById(id)?.name ?? id)
  const text = health.missing
    ? "The agents haven't run this morning."
    : `${names.join(', ')} failed this morning.`
  return (
    <Link
      to="/ai?tab=history"
      className="flex items-center gap-2 rounded-lg bg-warning/15 px-3 py-2 text-sm text-warning hover:underline"
    >
      <TriangleAlert className="size-4 shrink-0" aria-hidden />
      <span>{text} See history</span>
    </Link>
  )
}
