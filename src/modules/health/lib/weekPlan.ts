// The Coach week, worked out in one place. Every box is one of: exercise from
// a calendar, exercise you set or logged, the coach's suggestion, or Rest.
// Something you both do goes once, across both columns. Pure, so the same
// calendar, goals and boxes always give the same week.
//
//   1. Calendar: a remembered name ("GS1" = TT match) decides first, then star
//      events ("1*" = tournament), goal names and common exercise words. Work
//      and hidden titles never count.
//   2. Boxes you set by hand (Rest included, which keeps the coach off).
//   3. Exercise you logged.
//   4. The same exercise for both of you on a day becomes one shared item.
//   5. The coach fills what's left of the weekly goals, from today on, in boxes
//      you haven't set, away from match and tournament days and the day before
//      a tournament.
import { WORK_EVENT } from '../../../../supabase/functions/_shared/agents/calendar.ts'
import { matchesActivity } from '../../../../supabase/functions/_shared/agents/fitness.ts'

export type Goal = { name: string; times: number; optional?: boolean; max?: boolean }
export type Source = 'calendar' | 'you' | 'logged' | 'coach'
/** title: the calendar entry's own name, when it differs from the activity. */
export type Item = { activity: string; source: Source; title?: string }
export type DayBoxes = {
  day: string
  /** Done together: shown once, across both columns. */
  both: Item[]
  /** Each person's own, by id. */
  people: Record<string, Item[]>
  /** Calendar entries that day nobody recognised, by owner id ('' = shared), for teaching. */
  unknown: { title: string; owner: string | null }[]
}

export type CalEvent = { title: string; start: string; allDay: boolean; calendarId: string; hidden?: boolean }
export type ExerciseName = { owner_id: string | null; phrase: string; activity: string | null }
/** owner_id null = both of you; activity null = Rest set by hand. */
export type SavedBox = { day: string; owner_id: string | null; activity: string | null }
export type Logged = { user_id: string; description: string; started_at: string }
export type Person = { id: string; name: string; goals: Goal[] }

export const TT_MATCH = 'TT match'
export const TT_TOURNAMENT = 'TT tournament'

/** Words that mean an event is exercise, besides your own goal names. */
const EXERCISE =
  /\b(gym|weights|workout|run|runs|running|parkrun|jog|jogging|yoga|pilates|barre|swim|swimming|cycle|cycling|spin|bike ride|table tennis|tt|ping ?pong|tennis|padel|squash|badminton|football|5[- ]a[- ]side|netball|hockey|golf|climbing|bouldering|hike|hiking|hiit|crossfit|boxing|zumba|dance class|stretch(ing)?|exercise)\b/i
/** Table tennis tournaments are named by star rating: "Graham Spicer 1*", "Bristol 2 star". */
const STAR_EVENT = /(^|\s)[1-5]\s?(\*|stars?\b)/i
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const containsPhrase = (title: string, phrase: string) => new RegExp(`(^|[^a-z0-9])${escape(phrase.trim())}($|[^a-z0-9])`, 'i').test(title)
/** Same exercise, however it was written ("Run" and "Parkrun", "Table tennis" and "TT match"). */
export const sameActivity = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase() || matchesActivity(a, b) || matchesActivity(b, a)
export const splitActivities = (value: string | null | undefined) => (value ?? '').split(',').map((x) => x.trim()).filter(Boolean)
const isFixture = (activity: string) => activity === TT_MATCH || activity === TT_TOURNAMENT

/** A calendar title's meaning: a remembered name first (longest wins), then built-in rules. undefined = not recognised. */
export function classify(title: string, owner: string | null, names: ExerciseName[], goals: string[]): string | null | undefined {
  const known = names
    .filter((n) => (n.owner_id === null || owner === null || n.owner_id === owner) && containsPhrase(title, n.phrase))
    .sort((a, b) => b.phrase.length - a.phrase.length)[0]
  if (known) return known.activity
  if (STAR_EVENT.test(title)) return TT_TOURNAMENT
  const goal = goals.find((g) => matchesActivity(title, g))
  if (goal) return goal
  if (EXERCISE.test(title)) return title.trim().slice(0, 40)
  return undefined
}

function localDate(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Add unless that exercise is already there (earlier sources win). */
function addTo(list: Item[], item: Item, also: Item[] = []) {
  if (![...list, ...also].some((x) => sameActivity(x.activity, item.activity))) list.push(item)
}

/** Days for n sessions, as evenly spaced as possible, cheapest days first. `cost` Infinity = not allowed. */
function spread(n: number, cost: number[], already: number[]): number[] {
  const picked: number[] = []
  for (let i = 0; i < n; i++) {
    let best = -1
    let bestScore = -Infinity
    for (let d = 0; d < cost.length; d++) {
      if (picked.includes(d) || cost[d] === Infinity) continue
      const others = [...already, ...picked]
      const gap = others.length ? Math.min(...others.map((p) => Math.abs(p - d))) : 7
      const score = Math.min(gap, 3) * 10 - cost[d] * 15 - d * 0.1
      if (score > bestScore) { bestScore = score; best = d }
    }
    if (best < 0) break
    picked.push(best)
  }
  return picked
}

export function weekBoxes({
  days,
  today,
  people,
  events = [],
  owners = new Map(),
  names = [],
  saved = [],
  logged = [],
}: {
  days: string[]
  today: string
  people: Person[]
  events?: CalEvent[]
  owners?: Map<string, string | null>
  names?: ExerciseName[]
  saved?: SavedBox[]
  logged?: Logged[]
}): DayBoxes[] {
  const goalNames = people.flatMap((p) => p.goals.map((g) => g.name))
  const week: DayBoxes[] = days.map((day) => ({ day, both: [], people: Object.fromEntries(people.map((p) => [p.id, []])), unknown: [] }))
  const at = (day: string) => week.find((w) => w.day === day)

  // 1. Calendar.
  for (const e of events) {
    if (e.hidden || WORK_EVENT.test(e.title)) continue
    const box = at(e.allDay ? e.start.slice(0, 10) : localDate(e.start))
    if (!box) continue
    let owner = owners.get(e.calendarId) ?? null
    if (owner === null) {
      const named = people.filter((p) => containsPhrase(e.title, p.name))
      if (named.length === 1) owner = named[0].id
    }
    if (owner !== null && !box.people[owner]) continue
    const activity = classify(e.title, owner, names, goalNames)
    if (activity === null) continue
    if (activity === undefined) {
      if (!box.unknown.some((u) => u.title === e.title)) box.unknown.push({ title: e.title.trim(), owner })
      continue
    }
    const item: Item = { activity, source: 'calendar', ...(e.title.trim().toLowerCase() !== activity.toLowerCase() ? { title: e.title.trim() } : {}) }
    addTo(owner === null ? box.both : box.people[owner], item, owner === null ? [] : box.both)
  }

  // 2. Set by hand.
  const handSet = new Set<string>()
  for (const s of saved) {
    const box = at(s.day)
    if (!box || (s.owner_id !== null && !box.people[s.owner_id])) continue
    if (s.owner_id === null) {
      for (const a of splitActivities(s.activity)) addTo(box.both, { activity: a, source: 'you' })
      if (s.activity) for (const p of people) handSet.add(`${s.day}:${p.id}`)
    } else {
      handSet.add(`${s.day}:${s.owner_id}`)
      for (const a of splitActivities(s.activity)) addTo(box.people[s.owner_id], { activity: a, source: 'you' }, box.both)
    }
  }

  // 3. Logged.
  for (const l of logged) {
    const box = at(localDate(l.started_at))
    if (box?.people[l.user_id]) addTo(box.people[l.user_id], { activity: l.description.trim().slice(0, 40), source: 'logged' }, box.both)
  }

  // 4. Same exercise for both on one day: once, across both.
  if (people.length === 2) {
    const [a, b] = people
    for (const box of week) {
      for (const item of [...box.people[a.id]]) {
        const twin = box.people[b.id].find((x) => sameActivity(x.activity, item.activity))
        if (!twin) continue
        box.people[a.id] = box.people[a.id].filter((x) => x !== item)
        box.people[b.id] = box.people[b.id].filter((x) => x !== twin)
        addTo(box.both, item)
      }
    }
  }

  // 5. The coach: what's left of each goal, from today on, in boxes nobody set.
  const placeCoach = (owners: string[], goal: string, n: number) => {
    const theirs = (w: DayBoxes) => [...w.both, ...owners.flatMap((o) => w.people[o])]
    const tournamentDays = week.flatMap((w, i) => (theirs(w).some((x) => x.activity === TT_TOURNAMENT) ? [i] : []))
    const fixedDays = week.flatMap((w, i) =>
      [...w.both, ...owners.flatMap((o) => w.people[o])].some((x) => sameActivity(x.activity, goal)) ? [i] : [],
    )
    const cost = week.map((w, i) => {
      if (w.day < today || owners.some((o) => handSet.has(`${w.day}:${o}`))) return Infinity
      const mine = theirs(w)
      // One coach session a day, and none on a match or tournament day.
      if (mine.some((x) => isFixture(x.activity) || x.source === 'coach')) return Infinity
      if (tournamentDays.includes(i + 1)) return 5
      return mine.length
    })
    for (const d of spread(n, cost, fixedDays)) {
      const item: Item = { activity: goal, source: 'coach' }
      if (owners.length === 2) addTo(week[d].both, item)
      else addTo(week[d].people[owners[0]], item, week[d].both)
    }
  }
  const left = (p: Person, g: Goal) => {
    const done = week.reduce((n, w) => n + [...w.both, ...w.people[p.id]].filter((x) => sameActivity(x.activity, g.name)).length, 0)
    return Math.max(0, Math.min(7, g.times) - done)
  }
  const wanted = people.map((p) => ({ p, goals: p.goals.filter((g) => !g.optional && g.name.trim() && g.times > 0) }))
  // Shared goals first, so you do them together.
  if (wanted.length === 2) {
    const [a, b] = wanted
    for (const ga of a.goals) {
      const gb = b.goals.find((g) => sameActivity(g.name, ga.name))
      if (gb) placeCoach([a.p.id, b.p.id], ga.name, Math.min(left(a.p, ga), left(b.p, gb)))
    }
  }
  for (const { p, goals } of wanted) {
    for (const g of [...goals].sort((x, y) => y.times - x.times)) placeCoach([p.id], g.name, left(p, g))
  }
  return week
}
