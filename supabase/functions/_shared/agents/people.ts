// Friends: birthdays coming up and people you haven't seen for a while, from
// the People list. Pure. A person with an owner reminds only that owner; a
// joint friend reminds both of you. It never messages anyone.
//
//   people:<id>:bday:<date>        birthday within a week
//   people:<id>:meet:<since>       not seen for longer than you'd like
import { addDays, daysBetween, type ISODate, nextWeekday, shortDay } from './dates.ts'
import { similarTitles } from './taskManager.ts'
import type { OpenTask, SuggestionDraft } from './types.ts'

export const BIRTHDAY_DAYS = 7
export const MAX_MEETUPS = 2

export type Person = {
  id: string
  owner_id: string | null
  name: string
  birthday_month: number | null
  birthday_day: number | null
  see_every_weeks: number | null
  last_seen_on: ISODate | null
  created_at: string
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

/** The next birthday on or after today; 29 Feb falls on 28 Feb in other years. */
export function nextBirthday(today: ISODate, month: number, day: number): ISODate {
  const at = (y: number) => {
    const d = month === 2 && day === 29 && !isLeap(y) ? 28 : day
    return `${y}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  const year = Number(today.slice(0, 4))
  return at(year) >= today ? at(year) : at(year + 1)
}

export function analysePeople(today: ISODate, people: Person[], open: OpenTask[], enabled: string[]): SuggestionDraft[] {
  if (!enabled.length) return []
  const out: SuggestionDraft[] = []
  const hasTask = (title: string) => open.some((t) => similarTitles(t.title, title))
  const meetups = new Map<string, number>()
  const saturday = nextWeekday(today, 6)

  // Longest overdue first, so the cap keeps the ones that matter most.
  const overdue = (p: Person) => {
    if (!p.see_every_weeks) return -1
    return daysBetween(p.last_seen_on ?? p.created_at.slice(0, 10), today) - p.see_every_weeks * 7
  }
  for (const p of [...people].sort((a, b) => overdue(b) - overdue(a))) {
    const recipients = p.owner_id ? enabled.filter((id) => id === p.owner_id) : enabled
    if (!recipients.length) continue
    const list = p.owner_id ? 'personal' : 'joint'

    if (p.birthday_month && p.birthday_day) {
      const date = nextBirthday(today, p.birthday_month, p.birthday_day)
      const days = daysBetween(today, date)
      const title = `Card or plan for ${p.name}’s birthday`
      if (days <= BIRTHDAY_DAYS && !hasTask(title)) {
        out.push({
          dedupe_key: `people:${p.id}:bday:${date}`,
          kind: 'birthday',
          severity: days <= 2 ? 2 : 1,
          title: `${p.name}’s birthday is ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `on ${shortDay(date, today)}`}`,
          reason: days <= 2 ? 'A message, a call or a card that arrives late still counts.' : 'Enough time for a card to arrive or to plan something.',
          task_id: null,
          action: { type: 'create_task', title, list, due_date: days <= 3 ? today : addDays(date, -3) },
          recipients,
        })
      }
    }

    if (overdue(p) >= 0) {
      const since = p.last_seen_on ?? p.created_at.slice(0, 10)
      const title = `Arrange to see ${p.name}`
      const count = Math.max(...recipients.map((r) => meetups.get(r) ?? 0))
      if (count >= MAX_MEETUPS || hasTask(title)) continue
      recipients.forEach((r) => meetups.set(r, (meetups.get(r) ?? 0) + 1))
      const weeks = Math.round(daysBetween(since, today) / 7)
      out.push({
        dedupe_key: `people:${p.id}:meet:${since}`,
        kind: 'meet_up',
        severity: 1,
        title: p.last_seen_on ? `${weeks} weeks since you saw ${p.name}` : `When will you next see ${p.name}?`,
        reason: `You’d like to see them every ${p.see_every_weeks === 1 ? 'week' : `${p.see_every_weeks} weeks`}. Suggest a date, then press Saw them on the People page afterwards.`,
        task_id: null,
        action: { type: 'create_task', title, list, due_date: saturday },
        recipients,
      })
    }
  }
  return out
}
