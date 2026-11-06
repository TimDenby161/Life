// Career: keeps each person's own goals moving with regular check-ins and
// target dates. Pure. It never searches for jobs, applies or contacts anyone.
//
//   career:<id>:review:<last>   no check-in for the goal's review period
//   career:<id>:soon:<date>     target date within four weeks
//   career:<id>:late:<date>     target date passed, goal still open
//   career:start:<person>       no goals yet (once)
//
// Goals are readable by both of you, but reminders only go to their owner.
import { daysBetween, type ISODate, nextWeekday } from './dates.ts'
import { longDate } from './lifeAdmin.ts'
import type { SuggestionDraft } from './types.ts'

export const SOON_DAYS = 28

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
