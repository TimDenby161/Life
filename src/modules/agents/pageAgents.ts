// Which agent drives which page. A page listed here opens on its agent's view
// (what it noticed, what it suggests), with the page itself under "Details".
import type { AgentId } from '../../../supabase/functions/_shared/agents/registry.ts'

export type PageAgent = {
  /** The switch label for the agent view. */
  label: string
  /** Shown under the page title; left out where the page needs the room (Finance fits one phone screen). */
  description?: string
  /** Agents whose suggestions show, and whose Run now buttons appear. */
  agents: AgentId[]
  /** Only these kinds (from any of the agents above); all kinds when absent. */
  kinds?: string[]
  /** Extra output shown above the suggestions: the rest of today's calendar (live), today and packed days from the briefing, or the live goals and trend cards instead of any suggestions (finance). */
  extra?: 'today' | 'calendar' | 'finance'
  /** Cap on suggestions shown (Home shows the top few). */
  limit?: number
  /** No visible title, description or agent / Details switch (Home keeps it clean). */
  bare?: boolean
}

export const PAGE_AGENTS: Record<string, PageAgent> = {
  home: { label: 'Today', description: 'The rest of today’s calendar, the jobs you can do today, and the news.', agents: ['chief_of_staff'], extra: 'today', bare: true },
  tasks: { label: 'Task Manager', description: 'Put-off and overdue tasks, deadline risks, duplicates and moves off packed days.', agents: ['task_manager'], kinds: ['overdue', 'put_off', 'deadline_risk', 'blocked', 'undated', 'duplicate', 'automate', 'packed_day', 'workload'] },
  jobs: { label: 'Household', description: 'Upkeep that’s easy to forget, rooms with nothing set up, and jobs that keep slipping.', agents: ['household', 'task_manager'], kinds: ['maintenance', 'empty_room', 'missed_repeat', 'repeat'] },
  calendar: { label: 'This week', description: 'Today’s calendar, packed days ahead, and jobs worth moving off them.', agents: ['chief_of_staff', 'task_manager'], kinds: ['packed_day'], extra: 'calendar' },
  finances: { label: 'Finance', agents: ['finance'], extra: 'finance' },
  investments: { label: 'Finance', description: 'Your overall position: net worth, what moved it, and anything going the wrong way.', agents: ['finance'] },
  wedding: { label: 'Planner', description: 'Payments, suppliers, progress and what’s next for September 2028.', agents: ['wedding'] },
  languages: { label: 'Coach', description: 'Reviews piling up, words that keep slipping, and languages left alone.', agents: ['language_coach'] },
  health: { label: 'Coach', description: 'Your weekly goals, recovery and balance.', agents: ['health_coach'] },
  stats: { label: 'Workload', description: 'How the joint jobs are shared.', agents: ['task_manager'], kinds: ['workload'] },
}

/**
 * Which view a page opens on: the agent's, unless the address asks for Details
 * or points inside the page (a query such as ?lang=zh, or a sub-path), so deep
 * links keep working.
 */
export function pageView(pathname: string, base: string, params: URLSearchParams): 'agent' | 'details' {
  const asked = params.get('view')
  if (asked === 'details' || asked === 'agent') return asked
  const inside = pathname.replace(/\/$/, '') !== base.replace(/\/$/, '') || [...params.keys()].length > 0
  return inside ? 'details' : 'agent'
}
