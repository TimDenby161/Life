// Career: keeps each person's own goals moving with regular check-ins and
// target dates. Pure. It never searches for jobs, applies or contacts anyone.
//
//   career:<id>:review:<last>   no check-in for the goal's review period
//   career:<id>:soon:<date>     target date within four weeks
//   career:<id>:late:<date>     target date passed, goal still open
//   career:start:<person>       no goals yet (once)
//   career:prep:<person>:<date>:<title>     a work event in the next three
//                                           days, from your calendar
//   career:reflect:<person>:<date>:<title>  the day after it
//
// Goals are readable by both of you, but reminders only go to their owner.
// Event coaching reads calendar titles only, for the words you choose (e.g.
// "client", "congress"); it never says anything about who was there.
import type { CalEvent } from './calendar.ts'
import { addDays, daysBetween, type ISODate, localNow, nextWeekday, shortDay } from './dates.ts'
import { longDate } from './lifeAdmin.ts'
import type { SuggestionDraft } from './types.ts'

export const SOON_DAYS = 28
export const PREP_DAYS = 3

export type CareerConfig = { eventWords: string[] }

/** Settings as saved in agent_settings.config, cleaned. */
export function parseCareerConfig(config: unknown): CareerConfig {
  const words = (config as { eventWords?: unknown } | null)?.eventWords
  return {
    eventWords: (Array.isArray(words) ? words : [])
      .filter((w): w is string => typeof w === 'string' && w.trim().length > 1)
      .map((w) => w.trim().toLowerCase().slice(0, 30))
      .slice(0, 10),
  }
}

/** The local first and last day of an event. */
function eventDays(e: CalEvent, timeZone: string): { first: ISODate; last: ISODate } {
  if (e.allDay) return { first: e.start.slice(0, 10), last: addDays(e.end.slice(0, 10), -1) }
  return { first: localNow(new Date(e.start), timeZone).date, last: localNow(new Date(e.end), timeZone).date }
}

const slug = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)

/**
 * Coaching around work events: confidence comes from preparing a few openers
 * beforehand and noticing what went well afterwards.
 */
export function analyseEvents(
  today: ISODate,
  events: CalEvent[],
  enabled: string[],
  configFor: (userId: string) => CareerConfig,
  timeZone = 'Europe/London',
): SuggestionDraft[] {
  const out: SuggestionDraft[] = []
  for (const person of enabled) {
    const words = configFor(person).eventWords
    if (!words.length) continue
    const seen = new Set<string>()
    for (const e of events) {
      if (e.hidden || (e.owner_id !== null && e.owner_id !== person)) continue
      const title = e.title.toLowerCase()
      if (!words.some((w) => title.includes(w)) || seen.has(e.title)) continue
      const { first, last } = eventDays(e, timeZone)
      const ahead = daysBetween(today, first)
      const key = `${person.slice(0, 8)}:${first}:${slug(e.title)}`
      if (ahead >= 0 && ahead <= PREP_DAYS) {
        seen.add(e.title)
        out.push({
          dedupe_key: `career:prep:${key}`,
          kind: 'event_prep',
          severity: ahead <= 1 ? 2 : 1,
          title: `${e.title} ${ahead === 0 ? 'today' : ahead === 1 ? 'tomorrow' : `on ${shortDay(first, today)}`}: prepare three openers`,
          reason:
            'Ten minutes beforehand makes the conversations easier: find out who’s coming, write three openers (their work, their journey, what they hope to get from the day), and set one small goal, like starting two conversations yourself.',
          task_id: null,
          action: { type: 'create_task', title: `Prep for ${e.title}: who’s coming, 3 openers, 1 goal`.slice(0, 200), list: 'personal', due_date: ahead === 0 ? today : addDays(first, -1) },
          recipients: [person],
        })
      } else if (last === addDays(today, -1)) {
        seen.add(e.title)
        out.push({
          dedupe_key: `career:reflect:${key}`,
          kind: 'event_reflect',
          severity: 1,
          title: `How did ${e.title} go?`,
          reason: 'Write down one conversation that went well and why. Noticing what works is what builds confidence for the next one.',
          task_id: null,
          action: { type: 'create_task', title: `Note one thing that went well at ${e.title}`.slice(0, 200), list: 'personal', due_date: today },
          recipients: [person],
        })
      }
    }
  }
  return out
}

export type Goal = {
  id: string
  user_id: string
  title: string
  target_date: ISODate | null
  review_days: number
  last_reviewed_on: ISODate | null
  created_at: string
  done_at: string | null
}

export function analyseCareer(today: ISODate, goals: Goal[], enabled: string[]): SuggestionDraft[] {
  const out: SuggestionDraft[] = []
  const saturday = nextWeekday(today, 6)
  for (const person of enabled) {
    const mine = goals.filter((g) => g.user_id === person)
    if (!mine.length) {
      out.push({
        dedupe_key: `career:start:${person}`,
        kind: 'career_start',
        severity: 1,
        title: 'Add a career goal',
        reason: 'A qualification, a promotion, a skill or a move: add it on the Career card in AI Hub → Agents with a target date, and you’ll get a nudge to check in on it.',
        task_id: null,
        action: null,
        recipients: [person],
      })
      continue
    }
    for (const g of mine) {
      if (g.done_at) continue
      const recipients = [person]
      if (g.target_date && g.target_date < today) {
        out.push({
          dedupe_key: `career:${g.id}:late:${g.target_date}`,
          kind: 'goal_late',
          severity: 2,
          title: `“${g.title}” was due ${longDate(g.target_date)}`,
          reason: 'Mark it done, give it a new date, or remove it, on the Career card.',
          task_id: null,
          action: null,
          recipients,
        })
        continue
      }
      if (g.target_date && daysBetween(today, g.target_date) <= SOON_DAYS) {
        const days = daysBetween(today, g.target_date)
        out.push({
          dedupe_key: `career:${g.id}:soon:${g.target_date}`,
          kind: 'goal_soon',
          severity: 2,
          title: `“${g.title}” is due ${days <= 1 ? (days === 0 ? 'today' : 'tomorrow') : `in ${days < 14 ? `${days} days` : `${Math.round(days / 7)} weeks`}`}`,
          reason: `Target: ${longDate(g.target_date)}. What’s left? A task for the next step keeps it moving.`,
          task_id: null,
          action: { type: 'create_task', title: `Next step: ${g.title}`, list: 'personal', due_date: saturday < g.target_date ? saturday : today },
          recipients,
        })
        continue
      }
      const since = g.last_reviewed_on ?? g.created_at.slice(0, 10)
      const gap = daysBetween(since, today)
      if (gap >= g.review_days) {
        out.push({
          dedupe_key: `career:${g.id}:review:${since}`,
          kind: 'goal_review',
          severity: 1,
          title: `Check in on “${g.title}”`,
          reason: `${g.last_reviewed_on ? `Last check-in ${gap} days ago.` : `Added ${gap} days ago, no check-in yet.`}${g.target_date ? ` Target: ${longDate(g.target_date)}.` : ''} Press Checked in on the Career card once you’ve looked at it.`,
          task_id: null,
          action: { type: 'create_task', title: `Review progress: ${g.title}`, list: 'personal', due_date: saturday },
          recipients,
        })
      }
    }
  }
  return out
}
