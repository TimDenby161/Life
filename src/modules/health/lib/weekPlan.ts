// The coach's draft of the exercise week: each person's weekly activity goals
// spread over Monday to Sunday, with any activity you both have put on the same
// days in the Together column. Pure; the page saves it only into an empty week.

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
export function draftWeek(people: { id: string; goals: Goal[] }[]): DraftCell[] {
  const wanted = people.map((p) => ({
    id: p.id,
    goals: p.goals.filter((g) => !g.optional && g.name.trim() && g.times > 0).map((g) => ({ name: g.name.trim(), times: Math.min(7, g.times) })),
  }))
  const load = Object.fromEntries(wanted.map((p) => [p.id, Array<number>(7).fill(0)]))
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
