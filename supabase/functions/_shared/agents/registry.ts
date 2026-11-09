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
  | 'nutrition'
  | 'side_projects'
  | 'friends'

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
    summary: 'A short briefing each morning: your goals first, then what is due, deadlines coming up, what changed, and the suggestions that matter most.',
    status: 'live',
    runs: 'Every morning after 6am, or Mondays only',
    cadence: null,
    schedules: ['daily', 'weekly'],
    reads: ['Tasks and jobs', 'Completion history', 'Every agent’s suggestions', 'Your goals from the other agents (your weight only for you)'],
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
    summary: 'Review pile-ups, words that keep slipping, and languages left alone for days. With a target date, a speaking topic each week for the language that comes first. Never re-teaches what you know.',
    status: 'live',
    runs: 'Every morning',
    cadence: 'daily',
    schedules: [],
    reads: ['Your own language progress', 'Your language targets'],
    can: ['Add a revision or practice task'],
  },
  {
    id: 'health_coach',
    name: 'Fitness Coach',
    summary: 'Your weekly goals and limits, a taper before tournaments, recovery after big weeks, strength and mobility balance, a weekly table tennis conditioning session, and a nudge to go together when you both have the same session to do.',
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
    summary: 'Your overall position: net worth at each balance update, what moved it, and how it compares with a year ago; and savings goals with a target date against the monthly pace. No bills or spending. Never moves money.',
    status: 'live',
    runs: 'Every morning; new figures after each balance update',
    cadence: 'daily',
    schedules: [],
    reads: ['Account types and recorded balances (not transactions)', 'Savings goals and pots'],
    can: ['Add a task (it never moves money)'],
  },
  {
    id: 'life_admin',
    name: 'Life Admin',
    summary: 'Reminders before things expire: passport, MOT, insurance, contracts. Never renews or sends anything.',
    status: 'live',
    runs: 'Every morning',
    cadence: 'daily',
    schedules: [],
    reads: ['Your renewals list (names and dates)', 'Open task titles, so it doesn’t remind you twice'],
    can: ['Add a task'],
  },
  {
    id: 'travel',
    name: 'Travel',
    summary: 'What still needs sorting before each trip: time off, travel, somewhere to stay, insurance, packing, and passports running out. For big trips, when to ask operators for offers, with an email to copy. Never books or sends anything.',
    status: 'live',
    runs: 'Every morning',
    cadence: 'daily',
    schedules: [],
    reads: ['Your trips list (names, dates, what’s sorted)', 'Passport dates from Renewals', 'Open task titles'],
    can: ['Add a task'],
  },
  {
    id: 'career',
    name: 'Career',
    summary: 'Keeps your career goals moving: check-ins and target dates. Coaching around work events from your calendar: openers to prepare beforehand, what went well afterwards. Never searches for jobs, applies or contacts anyone.',
    status: 'live',
    runs: 'Every morning',
    cadence: 'daily',
    schedules: [],
    reads: ['Your own career goals', 'Your calendar’s event titles, for the words you choose'],
    can: ['Add a task'],
  },
  {
    id: 'nutrition',
    name: 'Weight & Food',
    summary: 'A weekly weight review against a steady pace to your target, a nudge when you haven’t weighed in, takeaway limits on your own and together, and a meal planning day.',
    status: 'live',
    runs: 'Every morning; the review on Mondays',
    cadence: 'daily',
    schedules: [],
    reads: ['Your own weight readings', 'Takeaways logged on the Health page'],
    can: ['Add a weigh-in or meal planning task'],
  },
  {
    id: 'side_projects',
    name: 'Side Projects',
    summary: 'One growth experiment a week for each side project, tracked against your paid-user goals, and a monthly list of sponsors to approach with a pitch to copy. Never posts or emails anyone.',
    status: 'live',
    runs: 'Every morning; experiments on Mondays',
    cadence: 'daily',
    schedules: [],
    reads: ['Your projects and paid-user counts (entered by you)'],
    can: ['Add a task'],
  },
  {
    id: 'friends',
    name: 'Friends',
    summary: 'Birthdays a week ahead and friends you haven’t seen for longer than you’d like, from the People page. Never messages anyone.',
    status: 'live',
    runs: 'Every morning',
    cadence: 'daily',
    schedules: [],
    reads: ['People: names, birthdays and when you last saw them'],
    can: ['Add a task'],
  },
]

/** In run order: the Task Manager first, the Chief of Staff (no cadence) is dispatched separately, last. */
export const LIVE_AGENTS = AGENTS.filter((a) => a.status === 'live')

export function agentById(id: string): AgentDef | undefined {
  return AGENTS.find((a) => a.id === id)
}
