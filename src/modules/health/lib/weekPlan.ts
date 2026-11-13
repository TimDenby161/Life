// The coach's draft of the exercise week: each person's weekly activity goals
// spread over Monday to Sunday, with any activity you both have put on the same
// days in the Together column. Pure; the page saves it only into an empty week.
// Exercise already in your calendars fills its box directly and counts towards
// the goals.
import { WORK_EVENT } from '../../../../supabase/functions/_shared/agents/calendar.ts'
import { matchesActivity } from '../../../../supabase/functions/_shared/agents/fitness.ts'

export type Goal = { name: string; times: number; optional?: boolean; max?: boolean }
/** owner null = Together. */
export type DraftCell = { day: number; owner: string | null; activity: string }

const key = (name: string) => name.trim().toLowerCase()

/** Days (0 = Monday) for n sessions, as evenly spaced as the week allows, avoiding busy days where it can. */
function spread(n: number, load: number[]): number[] {
  const picked: number[] = []
  for (let i = 0; i < Math.min(n, 7); i++) {
    let best = -1
    let bestScore = -Infinity
    for (let d = 0; d < 7; d++) {
      if (picked.includes(d)) continue
      // Far from this activity's other days (wrapping round the week), then the least busy day, then the earlier one.
      const gap = picked.length ? Math.min(...picked.map((p) => Math.min(Math.abs(p - d), 7 - Math.abs(p - d)))) : 7
      const score = gap * 10 - load[d] * 15 - d * 0.1
      if (score > bestScore) { bestScore = score; best = d }
    }
    picked.push(best)
  }
  return picked.sort((a, b) => a - b)
}

/**
 * Draft a week for the given people (their ids and goals). Optional activities
 * are left out; "at most" ones are planned at their limit. Bigger goals are
 * placed first. Shared activities go in Together, `min` of the two counts.
 */
export function draftWeek(people: { id: string; goals: Goal[] }[], booked: DraftCell[] = []): DraftCell[] {
  const wanted = people.map((p) => ({
    id: p.id,
    goals: p.goals
      .filter((g) => !g.optional && g.name.trim() && g.times > 0)
      .map((g) => {
        // Sessions already in the calendar (yours or together) count towards the goal.
        const done = booked.filter((b) => (b.owner === p.id || b.owner === null) && matchesActivity(b.activity, g.name)).length
        return { name: g.name.trim(), times: Math.max(0, Math.min(7, g.times) - done) }
      }),
  }))
  const load = Object.fromEntries(wanted.map((p) => [p.id, Array<number>(7).fill(0)]))
  // Days with something already booked are the last choice.
  for (const b of booked) for (const p of wanted) if (b.owner === p.id || b.owner === null) load[p.id][b.day] += 1
  const cells: DraftCell[] = []

  // Together first, so both people's days line up.
  if (wanted.length === 2) {
    const [a, b] = wanted
    for (const ga of a.goals) {
      const gb = b.goals.find((g) => key(g.name) === key(ga.name))
      if (!gb) continue
      const n = Math.min(ga.times, gb.times)
      const both = load[a.id].map((x, d) => x + load[b.id][d])
      for (const day of spread(n, both)) {
        cells.push({ day, owner: null, activity: ga.name })
        load[a.id][day]++
        load[b.id][day]++
      }
      ga.times -= n
      gb.times -= n
    }
  }

  for (const p of wanted) {
    for (const g of [...p.goals].sort((x, y) => y.times - x.times)) {
      for (const day of spread(g.times, load[p.id])) {
        cells.push({ day, owner: p.id, activity: g.name })
        load[p.id][day]++
      }
    }
  }
  return cells
}

/** Several activities on one day read as one cell: "Gym, Run". */
export function joinDay(cells: DraftCell[]): DraftCell[] {
  const out = new Map<string, DraftCell>()
  for (const c of [...cells].sort((a, b) => a.day - b.day)) {
    const k = `${c.day}:${c.owner}`
    const had = out.get(k)
    out.set(k, had ? { ...had, activity: `${had.activity}, ${c.activity}`.slice(0, 60) } : c)
  }
  return [...out.values()]
}

/** Words that mean an event is exercise, besides your own goal names. */
const EXERCISE =
  /\b(gym|weights|workout|run|runs|running|parkrun|jog|jogging|yoga|pilates|barre|swim|swimming|cycle|cycling|spin|bike ride|table tennis|tt|ping ?pong|tennis|padel|squash|badminton|football|5[- ]a[- ]side|netball|hockey|golf|climbing|bouldering|hike|hiking|hiit|crossfit|boxing|zumba|dance class|stretch(ing)?|exercise)\b/i

type CalEvent = { title: string; start: string; allDay: boolean; calendarId: string; hidden?: boolean }

/**
 * Exercise in the calendars this week, as boxes: on the calendar owner's
 * column, or a shared calendar's on Together unless the title names just one
 * of you. Work events never count. Hidden titles aren't shown.
 */
export function calendarExercise(
  events: CalEvent[],
  owners: Map<string, string | null>,
  people: { id: string; name: string; goals: Goal[] }[],
  days: string[],
): DraftCell[] {
  const names = people.flatMap((p) => p.goals.map((g) => g.name))
  const cells: DraftCell[] = []
  for (const e of events) {
    if (e.hidden || WORK_EVENT.test(e.title)) continue
    const goal = names.find((n) => matchesActivity(e.title, n))
    if (!goal && !EXERCISE.test(e.title)) continue
    const day = days.indexOf(e.allDay ? e.start.slice(0, 10) : localDate(e.start))
    if (day < 0) continue
    let owner = owners.get(e.calendarId) ?? null
    if (owner === null) {
      const named = people.filter((p) => new RegExp(`\\b${p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(e.title))
      if (named.length === 1) owner = named[0].id
    }
    cells.push({ day, owner, activity: (goal ?? e.title.trim()).slice(0, 40) })
  }
  return joinDay(cells)
}

function localDate(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
