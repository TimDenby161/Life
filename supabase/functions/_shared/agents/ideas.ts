// Daily tasks for each area of life (finance, wedding, meals, holidays,
// shopping, health, table tennis, side hustles, people, languages), decided
// each morning by the Claude routine from your goals (life_goals, the Goals
// page). Area by area, Claude works out what Tim, Sophie and the two of you
// together need to do today to move towards those goals: nothing on a quiet
// day, several things when something is urgent. They go straight onto the
// lists (Tim asked for them to be added, not suggested, 13 Nov 2026). Each
// person only gets areas they've picked in Settings (user_preferences.
// idea_areas; Sophie's leave out table tennis and side hustles). Pure parts
// only (the areas, the prompt, the input and the output check); the calls are
// in functions/agents/routine.ts and the write is agent_save_ideas, which
// also caps how many a day.
//
// Claude sees, per area and person: the goals as you wrote them, a few plain
// facts (names and dates: savings goal names, the wedding month, trip names and
// dates, shopping list names and deadlines, birthdays, languages studied, the
// last coaching day, side hustle names, how many meals are planned), and the
// titles of their open jobs and of the open tasks it added earlier. Never
// account figures, health readings or exercise, notes, or anyone else's private
// details.
import type { ISODate } from './dates.ts'

export const AREAS = [
  { key: 'finance', label: 'Finance', names: ['finance', 'finances', 'money'] },
  { key: 'wedding', label: 'Wedding', names: ['wedding'] },
  { key: 'meals', label: 'Meals', names: ['meals', 'cooking'] },
  { key: 'holidays', label: 'Holidays', names: ['holidays', 'travel'] },
  { key: 'shopping', label: 'Shopping', names: ['shopping'] },
  { key: 'health', label: 'Health', names: ['health', 'fitness'] },
  { key: 'table_tennis', label: 'Table tennis', names: ['table tennis'] },
  { key: 'side_hustles', label: 'Side hustles', names: ['side hustles', 'side projects'] },
  { key: 'people', label: 'People', names: ['people', 'friends', 'social'] },
  { key: 'languages', label: 'Languages', names: ['languages'] },
] as const

export type AreaKey = (typeof AREAS)[number]['key']
export const AREA_KEYS: readonly AreaKey[] = AREAS.map((a) => a.key)
/** Together never gets these: they're one person's own. */
export const SOLO_AREAS: readonly AreaKey[] = ['table_tennis', 'side_hustles']
export const TOGETHER = 'together'

export const MAX_IDEA_CHARS = 80
export const MIN_IDEA_MINUTES = 5
export const MAX_IDEA_MINUTES = 45
/** As agent_save_ideas: new tasks a day in one area for one of you (or Together), and in all. */
export const MAX_PER_AREA = 3
export const MAX_PER_DAY = 6

/** What Claude is told about one area for one of you, or for the two of you together. */
export type Plan = { for: string; who: string; goals: string[]; facts: string[]; open_jobs: string[]; open_tasks_you_added: string[] }
export type AreaInput = { area: AreaKey; label: string; plans: Plan[] }

export const IDEAS_PROMPT = [
  'You plan the day for a household, area of life by area of life, like a coach for each area. For each area, each plan is for one person or for the two of them together (for "together").',
  'From that plan\'s goals and facts, decide what that person (or the pair) should do today to move towards their goals, and add those tasks. Most days most plans need nothing: add nothing when nothing useful is due. Add more than one only when several things are genuinely urgent (a deadline, a birthday or a trip coming up soon, something already late).',
  `At most ${MAX_PER_AREA} tasks in one area for one plan, and at most ${MAX_PER_DAY} in all for each person and for together. Together tasks are things they do as a pair (both need to be there or decide together); a task for one of them goes to that person.`,
  'Each task goes straight onto their list for today, so it must be worth doing, concrete and done in one sitting of 5 to 45 minutes: a step towards the goal, not the whole goal ("Shortlist three venue areas", not "Plan the wedding").',
  'Never repeat or overlap an open job or an open task you added before (open_tasks_you_added); while those are open, add something only if it is a different, urgent thing. Goals are the people\'s own words: follow them (e.g. who plans holidays).',
  'Write each as a short instruction in plain British English starting with a verb, at most 80 characters, no emoji, no quotation marks, naming the specific thing (e.g. "Choose a gift for Jess’s birthday on 20 Nov").',
  'Give minutes: your honest estimate, 5 to 45. Answer with a list of items, each with the area key, for (copied from the plan) and the title and minutes; an empty list is fine.',
].join(' ')

export const IDEAS_ANSWER = { mode: 'ideas-save', key: '<the ideas key>', items: [{ area: '<area key>', for: '<the plan’s for>', title: '<the task>', minutes: 15 }] }

export function ideasInput(today: ISODate, weekday: string, areas: AreaInput[]) {
  return { date: today, weekday, areas }
}

export type Idea = { area: AreaKey; for: string; title: string; minutes: number }

/**
 * Claude's answer, kept only where it's usable: an offered area and plan, a
 * real title (whitespace tidied, no emoji or quotes, cut to length), minutes in
 * range, no repeats, and within the caps for each plan.
 */
export function cleanIdeas(raw: unknown, offered: readonly AreaInput[]): Idea[] {
  if (!Array.isArray(raw)) return []
  const allowed = (area: string, who: string) => offered.some((a) => a.area === area && a.plans.some((p) => p.for === who))
  const out: Idea[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const { area, for: who, title, minutes } = item as Record<string, unknown>
    if (typeof area !== 'string' || typeof who !== 'string' || !allowed(area, who) || typeof title !== 'string') continue
    const clean = title
      .replace(/\p{Extended_Pictographic}/gu, '')
      .replace(/["“”]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_IDEA_CHARS)
      .trim()
    if (clean.length < 3) continue
    const mine = out.filter((o) => o.for === who)
    if (mine.length >= MAX_PER_DAY || mine.filter((o) => o.area === area).length >= MAX_PER_AREA) continue
    if (mine.some((o) => o.title.toLowerCase() === clean.toLowerCase())) continue
    const m = typeof minutes === 'number' && Number.isFinite(minutes) ? Math.round(minutes) : 15
    out.push({ area: area as AreaKey, for: who, title: clean, minutes: Math.min(MAX_IDEA_MINUTES, Math.max(MIN_IDEA_MINUTES, m)) })
  }
  return out
}

/** The rows the facts are built from: names and dates only (functions/agents/context.ts loadAreas). */
export type AreaSource = {
  savings: { name: string; owner_id: string | null; target_date: ISODate | null }[]
  wedding: { date: ISODate | null; dateApprox: boolean; venues: number; guests: number }
  trips: { name: string; owner_id: string | null; starts_on: ISODate; ends_on: ISODate | null; confirmed: boolean }[]
  wants: { name: string; owner_id: string | null; need_by: ISODate | null }[]
  checklist: { title: string; due_date: ISODate | null }[]
  people: { name: string; owner_id: string | null; birthday_month: number | null; birthday_day: number | null; see_every_weeks: number | null; last_seen_on: ISODate | null }[]
  languages: { user_id: string; language: string; active: boolean }[]
  coaching: { user_id: string; day: ISODate }[]
  hustles: { user_id: string; name: string }[]
  mealsPlanned: number
  /** The tasks Claude added before that are still open, so it doesn't repeat them. */
  openIdeas: { assignee_id: string | null; needs_both: boolean; ai_area: string; title: string }[]
  /** Goals from the Goals page; owner_id null = together. */
  goals: { owner_id: string | null; area: string; goal: string }[]
}

/** The areas each plan covers: a person's own picks, and for Together any area either of you picked (but not the solo ones). */
export function planAreas(chosen: Record<string, readonly string[]>): { person: Record<string, AreaKey[]>; together: AreaKey[] } {
  const person = Object.fromEntries(Object.entries(chosen).map(([id, areas]) => [id, AREA_KEYS.filter((a) => areas.includes(a))]))
  const together = AREA_KEYS.filter((a) => !SOLO_AREAS.includes(a) && Object.values(person).some((areas) => areas.includes(a)))
  return { person, together }
}

/** The goals and earlier tasks for one plan in one area. */
export function planGoals(src: Pick<AreaSource, 'goals' | 'openIdeas'>, area: AreaKey, who: string) {
  const together = who === TOGETHER
  return {
    goals: src.goals.filter((g) => g.area === area && (together ? g.owner_id === null : g.owner_id === who)).map((g) => g.goal),
    open_tasks_you_added: src.openIdeas
      .filter((o) => o.ai_area === area && (together ? o.needs_both : !o.needs_both && o.assignee_id === who))
      .map((o) => o.title),
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "20 Nov", or "20 Nov 2027" in another year. */
const day = (d: ISODate, today: ISODate) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}${d.slice(0, 4) === today.slice(0, 4) ? '' : ` ${d.slice(0, 4)}`}`
const daysBetween = (from: ISODate, to: ISODate) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
const addDays = (d: ISODate, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
/** The next time a month and day comes round, from today (29 Feb is the 28th in other years). */
function nextDate(today: ISODate, month: number, dom: number): ISODate {
  for (const y of [Number(today.slice(0, 4)), Number(today.slice(0, 4)) + 1]) {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
    const d = `${y}-${String(month).padStart(2, '0')}-${String(month === 2 && dom === 29 && !leap ? 28 : dom).padStart(2, '0')}`
    if (d >= today) return d
  }
  return today
}

/** A few plain facts about each area for one person (theirs and shared things), or for together (shared things only). */
export function areaFacts(src: AreaSource, person: string, today: ISODate): Record<AreaKey, string[]> {
  const mine = (owner: string | null) => owner === null || owner === person
  const goals = src.savings.filter((g) => mine(g.owner_id))
  const trips = src.trips.filter((t) => mine(t.owner_id) && (t.ends_on ?? t.starts_on) >= today).sort((a, b) => a.starts_on.localeCompare(b.starts_on))
  const wants = src.wants.filter((w) => mine(w.owner_id))
  const toBuy = [...wants.map((w) => ({ name: w.name, by: w.need_by })), ...src.checklist.map((c) => ({ name: c.title, by: c.due_date }))]
  const soonest = toBuy.filter((t) => t.by).sort((a, b) => a.by!.localeCompare(b.by!))[0]
  const people = src.people.filter((p) => mine(p.owner_id))
  const birthdays = people
    .filter((p) => p.birthday_month && p.birthday_day)
    .map((p) => ({ name: p.name, on: nextDate(today, p.birthday_month!, p.birthday_day!) }))
    .filter((b) => daysBetween(today, b.on) <= 30)
    .sort((a, b) => a.on.localeCompare(b.on))
  const overdue = people.filter((p) => p.see_every_weeks && (!p.last_seen_on || daysBetween(p.last_seen_on, today) > p.see_every_weeks * 7))
  const languages = src.languages.filter((l) => l.user_id === person && l.active).map((l) => l.language)
  const lastCoaching = src.coaching.filter((c) => c.user_id === person).map((c) => c.day).sort().at(-1)
  const hustles = src.hustles.filter((h) => h.user_id === person).map((h) => h.name)
  const w = src.wedding

  return {
    finance: goals.length
      ? [`Savings goals: ${goals.slice(0, 6).map((g) => (g.target_date ? `${g.name} (by ${day(g.target_date, today)})` : g.name)).join(', ')}`]
      : ['No savings goals set up in the app yet'],
    wedding: [
      w.date ? `Wedding: ${w.dateApprox ? `around ${MONTHS[Number(w.date.slice(5, 7)) - 1]} ${w.date.slice(0, 4)}` : day(w.date, today)}` : 'No wedding date in the app yet',
      `Venues saved: ${w.venues}`,
      `Guests on the list: ${w.guests}`,
    ],
    meals: [`Meals planned for the next 7 days: ${src.mealsPlanned}`],
    holidays: trips.length
      ? trips.slice(0, 5).map((t) => `${t.name}: ${day(t.starts_on, today)}${t.ends_on ? ` to ${day(t.ends_on, today)}` : ''} (${t.confirmed ? 'going' : 'an idea'})`)
      : ['No upcoming trips in the app'],
    shopping: toBuy.length
      ? [`On the shopping list: ${toBuy.length}`, ...(soonest ? [`Needed soonest: ${soonest.name} (${day(soonest.by!, today)})`] : [])]
      : ['The shopping list is empty'],
    // Health stays private: nothing about readings or exercise is shared.
    health: ['No health details are shared; suggest something small and general'],
    table_tennis: [lastCoaching ? `Last coaching session logged: ${day(lastCoaching, today)}` : 'No coaching sessions logged in the app'],
    side_hustles: hustles.length ? [`Side hustles: ${hustles.join(', ')}`] : ['No side hustles in the app yet'],
    people: [
      ...birthdays.slice(0, 4).map((b) => `${b.name}: birthday ${day(b.on, today)}`),
      ...(overdue.length ? [`Not seen for a while: ${overdue.slice(0, 4).map((p) => p.name).join(', ')}`] : []),
      ...(people.length ? [] : ['No friends or family in the app yet']),
    ],
    languages: languages.length ? [`Studying: ${languages.join(', ')}`] : ['Not studying a language in the app yet'],
  }
}

/** The days the meal count covers: today and the next six. */
export const mealWindow = (today: ISODate): [ISODate, ISODate] => [today, addDays(today, 6)]
