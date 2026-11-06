// Every agent the AI Hub knows about. Pure, so the Edge Function and the app
// share one list. "planned" agents show in the Hub as not built yet and are
// never run.

export type AgentId =
  | 'chief_of_staff'
  | 'task_manager'
  | 'health_coach'
  | 'finance'
  | 'travel'
  | 'career'
  | 'household'
  | 'language_coach'
  | 'life_admin'
  | 'wedding'

export type AgentSchedule = 'daily' | 'weekly'

export type AgentDef = {
  id: AgentId
  name: string
  summary: string
  status: 'live' | 'planned'
  /** When it runs, in words. */
  runs: string
  /** How often the dispatcher runs it. The Chief of Staff follows each person's schedule instead. */
  cadence: 'daily' | 'weekly' | null
  /** Schedules a person can choose between; empty when it isn't a choice. */
  schedules: AgentSchedule[]
  /** What it reads. Shown under "Data access". */
  reads: string[]
  /** What approving one of its suggestions can do. */
  can: string[]
  /** For planned agents: what it is waiting on. */
  blockedBy?: string
}

export const AGENTS: AgentDef[] = [
  {
    id: 'chief_of_staff',
    name: 'Chief of Staff',
    summary: 'A short briefing each morning: what is due, deadlines coming up, what changed, and the suggestions that matter most.',
    status: 'live',
    runs: 'Every morning after 6am, or Mondays only',
    cadence: null,
    schedules: ['daily', 'weekly'],
    reads: ['Tasks and jobs', 'Completion history', 'Every agent’s suggestions'],
    can: [],
  },
  {
    id: 'task_manager',
    name: 'Task Manager',
    summary: 'Spots tasks that keep being put off, deadlines at risk, duplicates, one-offs that should be jobs, and how joint work is shared.',
    status: 'live',
    runs: 'Every morning, and within the hour after a task is ticked off',
    cadence: 'daily',
    schedules: [],
    reads: ['Tasks and jobs', 'Completion history (6 months)'],
    can: ['Add a task or job', 'Move a task’s date', 'Archive a duplicate'],
  },
  {
    id: 'wedding',
    name: 'Wedding Planner',
    summary: 'Payments coming up, budget lines with no supplier, overspends, RSVPs to chase, and a monthly progress summary.',
    status: 'live',
    runs: 'Every morning',
    cadence: 'daily',
    schedules: [],
    reads: ['Wedding date, budget and payments', 'Supplier roles and names (not contact details)', 'Guest replies (counts only)', 'Wedding checklist tasks'],
    can: ['Add a task (it never pays anything)'],
  },
  {
    id: 'language_coach',
    name: 'Language Coach',
    summary: 'Review pile-ups, words that keep slipping, and languages left alone for days. Never re-teaches what you know.',
    status: 'live',
    runs: 'Every morning',
    cadence: 'daily',
    schedules: [],
    reads: ['Your own language progress'],
    can: ['Add a revision task'],
  },
  {
    id: 'health_coach',
    name: 'Fitness Coach',
    summary: 'Recovery after big weeks, strength and mobility balance, and a weekly table tennis session for footwork, explosiveness and endurance.',
    status: 'live',
    runs: 'Every morning',
    cadence: 'daily',
    schedules: [],
    reads: ['Your own exercise sessions (not weight or periods)'],
    can: ['Add a training task'],
  },
  {
    id: 'household',
    name: 'Household Coordinator',
    summary: 'Home maintenance that’s easy to forget (smoke alarms, filters, boiler) and rooms with no jobs. Sharing and missed chores stay with the Task Manager.',
    status: 'live',
    runs: 'Mondays',
    cadence: 'weekly',
    schedules: [],
    reads: ['Tasks, jobs and rooms', 'Completion history'],
    can: ['Add a repeating job'],
  },
  {
    id: 'finance',
    name: 'Finance',
    summary: 'Your overall position: net worth at each balance update, what moved it, and how it compares with a year ago. No bills or spending. Never moves money.',
    status: 'live',
    runs: 'Every morning; new figures after each balance update',
    cadence: 'daily',
    schedules: [],
    reads: ['Account types and recorded balances (not transactions)'],
    can: ['Add a task (it never moves money)'],
  },
  {
    id: 'life_admin',
    name: 'Life Admin',
    summary: 'Renewals, appointments and follow-ups; drafts letters on request. Never sends anything.',
    status: 'planned',
    runs: 'Daily',
    cadence: null,
    schedules: [],
    reads: [],
    can: ['Add a task'],
    blockedBy: 'Needs your approval for email or calendar access.',
  },
  {
    id: 'travel',
    name: 'Travel',
    summary: 'Trip checklists and booking deadlines. Never invents prices or availability.',
    status: 'planned',
    runs: 'Weekly',
    cadence: null,
    schedules: [],
    reads: [],
    can: ['Add a task'],
    blockedBy: 'No trips stored in the app and no approved price source.',
  },
  {
    id: 'career',
    name: 'Career',
    summary: 'Goals, learning tasks and application drafts for review. Never applies or contacts anyone.',
    status: 'planned',
    runs: 'Weekly',
    cadence: null,
    schedules: [],
    reads: [],
    can: ['Add a task'],
    blockedBy: 'Needs goals and an approved job source.',
  },
]

/** In run order: the Task Manager first, the Chief of Staff (no cadence) is dispatched separately, last. */
export const LIVE_AGENTS = AGENTS.filter((a) => a.status === 'live')

export function agentById(id: string): AgentDef | undefined {
  return AGENTS.find((a) => a.id === id)
}
