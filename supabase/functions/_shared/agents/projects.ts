// Side Projects: keeps each person's side projects growing towards paying
// users, and finds sponsors for a team. Pure. It never posts, emails or
// contacts anyone: experiments and pitches are suggestions you carry out.
//
//   proj:<id>:<project>:try:<week>      Mondays: one growth experiment to try
//   proj:<id>:<project>:count:<date>    paid users not updated for two weeks
//   proj:<id>:<project>:hit:<goal>      a users goal reached
//   proj:<id>:sponsor:<month>           first week of the month: sponsors to
//                                       approach, with a pitch to copy
//
// Users are counted by hand on the Side Projects card: the app can't see the
// projects themselves.
import { addDays, daysBetween, type ISODate, isoWeekday, isoWeekKey, nextWeekday } from './dates.ts'
import { similarTitles } from './taskManager.ts'
import type { OpenTask, SuggestionDraft } from './types.ts'

export const STALE_DAYS = 14

export type Project = { name: string; users: number; goals: number[]; updated_on: ISODate | null }
export type ProjectsConfig = { projects: Project[]; sponsorTeam: string | null }

/** One a week, in turn. Each is small enough for an evening and says how to tell if it worked. */
export const EXPERIMENTS = [
  'Post one bold prediction before the weekend’s biggest match, then a follow-up with the result. Count replies and sign-ups.',
  'Share one useful free chart where fans already talk (a subreddit or Discord), following its self-promotion rules. Count clicks.',
  'Offer the first 10 people a free month in return for five minutes of feedback. Ask what would make them pay.',
  'Reply to five big accounts’ match threads with one stat from the site, no link. See how many visit your profile.',
  'Ask five people who’d use it what would make them pay, and write the answers down.',
  'Make the call to action obvious: “Try it free” in your bio and a pinned post that shows what paying users get.',
  'Write a short thread on one surprising finding from your model, with a chart. Compare it with a normal post.',
  'Email or message everyone who signed up but didn’t pay, and ask what stopped them.',
]

/** Who to approach for team sponsorship, one group a month. */
export const SPONSORS = [
  { who: 'local businesses near your club (cafés, gyms, physios, estate agents)', task: 'local businesses' },
  { who: 'table tennis brands and shops (Butterfly, Stiga, Tibhar, Joola, Donic, local TT shops)', task: 'table tennis brands' },
  { who: 'the employers of people on your team (many set money aside for community or staff sport)', task: 'team members’ employers' },
  { who: 'drinks and sports nutrition brands (Monster, Red Bull and others take requests through their websites; a long shot for a club team)', task: 'drinks brands' },
]

export function parseProjectsConfig(config: unknown): ProjectsConfig {
  const c = (config ?? {}) as { projects?: unknown; sponsorTeam?: unknown }
  const projects = (Array.isArray(c.projects) ? c.projects : [])
    .map((p) => p as { name?: unknown; users?: unknown; goals?: unknown; updated_on?: unknown })
    .filter((p) => typeof p.name === 'string' && p.name.trim())
    .slice(0, 4)
    .map((p) => ({
      name: (p.name as string).trim().slice(0, 40),
      users: Number.isInteger(p.users) && (p.users as number) >= 0 ? (p.users as number) : 0,
      goals: (Array.isArray(p.goals) ? p.goals : []).filter((g): g is number => Number.isInteger(g) && g > 0).sort((a, b) => a - b).slice(0, 5),
      updated_on: typeof p.updated_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.updated_on) ? p.updated_on : null,
    }))
  const team = typeof c.sponsorTeam === 'string' && c.sponsorTeam.trim() ? c.sponsorTeam.trim().slice(0, 60) : null
  return { projects, sponsorTeam: team }
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)

/** The next goal not yet reached; null when all are. */
export const nextGoal = (p: Project) => p.goals.find((g) => g > p.users) ?? null

/** A pitch to copy: what the team offers in return. */
export function sponsorPitch(team: string): string {
  return `Hi, I play for ${team} in the British Clubs League, one of the top club competitions in the country. We’re looking for a sponsor for this season: your logo on our playing shirts and on our social posts from every match, in return for help with kit or entry fees. Could I send you the details? Thanks.`
}

export function analyseProjects(today: ISODate, open: OpenTask[], enabled: string[], configFor: (userId: string) => ProjectsConfig): SuggestionDraft[] {
  const out: SuggestionDraft[] = []
  const week = isoWeekKey(today)
  const hasTask = (title: string) => open.some((t) => similarTitles(t.title, title))
  for (const person of enabled) {
    const { projects, sponsorTeam } = configFor(person)
    const id = person.slice(0, 8)
    const base = { task_id: null, recipients: [person] }
    projects.forEach((p, i) => {
      const key = `proj:${id}:${slug(p.name)}`
      const goal = nextGoal(p)
      const reached = [...p.goals].reverse().find((g) => g <= p.users)
      if (reached) {
        out.push({
          ...base,
          dedupe_key: `${key}:hit:${reached}`,
          kind: 'project_milestone',
          severity: 1,
          title: `${p.name}: ${p.users} paid users`,
          reason: `Past your goal of ${reached}${goal ? `. Next: ${goal}` : ''}. Worth asking the newest ones what made them pay.`,
          action: null,
        })
      }
      if (!p.updated_on || daysBetween(p.updated_on, today) >= STALE_DAYS) {
        out.push({
          ...base,
          dedupe_key: `${key}:count:${p.updated_on ?? 'never'}`,
          kind: 'project_count',
          severity: 1,
          title: `How many paid users does ${p.name} have now?`,
          reason: 'Update the number on the Side Projects card in AI Hub → Agents, so each week’s experiment can be judged by it.',
          action: null,
        })
      }
      // Mondays, one experiment for each project, offset so two projects don't get the same one.
      if (isoWeekday(today) === 1) {
        const experiment = EXPERIMENTS[(Number(week.slice(-2)) + i * 3) % EXPERIMENTS.length]
        const title = `${p.name}: this week’s growth experiment`
        if (!hasTask(title)) {
          out.push({
            ...base,
            dedupe_key: `${key}:try:${week}`,
            kind: 'project_experiment',
            severity: 1,
            title,
            reason: `${experiment} ${goal ? `Now ${p.users} of ${goal} paid users.` : `${p.users} paid users.`}`,
            action: { type: 'create_task', title, list: 'personal', due_date: addDays(today, 3) },
          })
        }
      }
    })
    if (sponsorTeam && Number(today.slice(8, 10)) <= 7) {
      const month = Number(today.slice(5, 7))
      const target = SPONSORS[month % SPONSORS.length]
      const title = `Send 3 sponsorship emails to ${target.task}`
      if (!hasTask(title)) {
        out.push({
          ...base,
          dedupe_key: `proj:${id}:sponsor:${today.slice(0, 7)}`,
          kind: 'sponsor_pitch',
          severity: 1,
          title: `${sponsorTeam} sponsorship: try ${target.task} this month`,
          reason: `Approach ${target.who}. A pitch to copy and adapt: “${sponsorPitch(sponsorTeam)}”`,
          action: { type: 'create_task', title, list: 'personal', due_date: nextWeekday(today, 6) },
        })
      }
    }
  }
  return out
}
