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
  /** Extra output shown above the suggestions: the rest of today's calendar (live), today and packed days from the briefing, or the live goals and trend cards instead of any suggestions (finance), or the wedding's jobs and venues (wedding). */
  extra?: 'today' | 'calendar' | 'finance' | 'wedding' | 'languages' | 'exercise'
  /** Cap on suggestions shown (Home shows the top few). */
  limit?: number
  /** No visible title, description or agent / Details switch (Home keeps it clean). */
  bare?: boolean
  /** A third tab, Goals, where the agent's goals are set (the Coach's weekly exercise goals). */
  goals?: 'fitness'
}

export type PageViewName = 'agent' | 'details' | 'goals'

export const PAGE_AGENTS: Record<string, PageAgent> = {
  home: { label: 'Today', description: 'The rest of today’s calendar, the jobs you can do today, and the news.', agents: ['chief_of_staff'], extra: 'today', bare: true },
  tasks: { label: 'Task Manager', description: 'Put-off and overdue tasks, deadline risks, duplicates and moves off packed days.', agents: ['task_manager'], kinds: ['overdue', 'put_off', 'deadline_risk', 'blocked', 'undated', 'duplicate', 'automate', 'packed_day', 'workload'] },
  jobs: { label: 'Household', description: 'Upkeep that’s easy to forget, rooms with nothing set up, and jobs that keep slipping.', agents: ['household', 'task_manager'], kinds: ['maintenance', 'empty_room', 'missed_repeat', 'repeat'] },
  calendar: { label: 'This week', description: 'Today’s calendar, packed days ahead, and jobs worth moving off them.', agents: ['chief_of_staff', 'task_manager'], kinds: ['packed_day'], extra: 'calendar' },
  finances: { label: 'Finance', agents: ['finance'], extra: 'finance' },
  wedding: { label: 'Plan', description: 'The venues you’re looking at and the jobs to do.', agents: ['wedding'], extra: 'wedding' },
  languages: { label: 'Words', description: 'The words you know, the ones you’ve got wrong, and any to review again.', agents: ['language_coach'], extra: 'languages' },
  health: { label: 'Coach', agents: ['health_coach'], extra: 'exercise', goals: 'fitness' },
  stats: { label: 'Workload', description: 'How the joint jobs are shared.', agents: ['task_manager'], kinds: ['workload'] },
}

/**
 * Which view a page opens on: the agent's, unless the address asks for Details
 * or points inside the page (a query such as ?lang=zh, or a sub-path), so deep
 * links keep working.
 */
export function pageView(pathname: string, base: string, params: URLSearchParams): PageViewName {
  const asked = params.get('view')
  if (asked === 'details' || asked === 'agent' || asked === 'goals') return asked
  const inside = pathname.replace(/\/$/, '') !== base.replace(/\/$/, '') || [...params.keys()].length > 0
  return inside ? 'details' : 'agent'
}
