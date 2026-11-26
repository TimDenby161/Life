import { toISODate } from '@/lib/dates'
import { MORNING_HOUR } from '../../../../supabase/functions/_shared/agents/schedule.ts'

type Run = { agent_id: string; trigger: string; status: string; created_at: string }

/** Two hourly ticks after the morning runs start: before this, nothing is late yet. */
export const LATE_FROM_HOUR = MORNING_HOUR + 2

/**
 * Whether this morning's agents ran: null when all is well (or it's too early to say), else what
 * went wrong. Missing means no scheduled run has succeeded today; failed means an agent's last
 * scheduled run today failed and nothing has succeeded for it since.
 */
export function agentHealth(runs: Run[], now: Date): { missing: boolean; failed: string[] } | null {
  if (now.getHours() < LATE_FROM_HOUR) return null
  const today = toISODate(now)
  const todays = runs.filter((r) => r.trigger === 'scheduled' && toISODate(new Date(r.created_at)) === today)
  const missing = !todays.some((r) => r.status === 'succeeded')
  const latest = new Map<string, Run>()
  for (const r of todays.toSorted((a, b) => a.created_at.localeCompare(b.created_at))) latest.set(r.agent_id, r)
  const failed = [...latest.values()].filter((r) => r.status === 'failed').map((r) => r.agent_id).sort()
  return missing || failed.length ? { missing, failed } : null
}
