// The goals at the top of each person's briefing: one short line each, from
// the goals they've set with the agents. Pure. Bare values, no label words:
// "Graham Spicer 1★ · 6 days", "Weight · 90.4 → 87.0".
//
// Weight is health data, so only its owner sees it. None of this goes to the
// AI summary (llm.ts builds its input field by field) or a notification.
import { daysBetween, type ISODate } from './dates.ts'
import type { FitnessGoals } from './fitness.ts'
import { LANGUAGE_NAMES, type LanguageTarget } from './languages.ts'
import { averageTo, type FoodGoals, kg, type WeightReading } from './nutrition.ts'
import { nextGoal, type ProjectsConfig } from './projects.ts'
import { formatPounds } from './types.ts'

export const EVENT_DAYS = 60
export const MAX_GOALS = 6

export type GoalLine = { label: string; value: string }

export type GoalInputs = {
  fitness: FitnessGoals | null
  food: FoodGoals | null
  /** This person's readings only. */
  weights: WeightReading[]
  projects: ProjectsConfig
  languages: LanguageTarget[]
  /** Savings goals with a target date that this person shares or owns. */
  savings: { name: string; saved: number; target: number }[]
}

const countdown = (today: ISODate, date: ISODate) => {
  const days = daysBetween(today, date)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days < 21) return `${days} days`
  if (days < 75) return `${Math.round(days / 7)} weeks`
  return `${Math.round(days / 30.44)} months`
}

/** Whole pounds, "£6,000". */
const pounds = (minor: number) => formatPounds(Math.round(minor / 100) * 100)

export function goalLines(today: ISODate, g: GoalInputs): GoalLine[] {
  const out: GoalLine[] = []
  const event = (g.fitness?.events ?? []).filter((e) => e.date >= today && daysBetween(today, e.date) <= EVENT_DAYS).sort((a, b) => a.date.localeCompare(b.date))[0]
  if (event) out.push({ label: event.name, value: countdown(today, event.date) })

  if (g.food?.targetKg) {
    const latest = g.weights.map((w) => w.date).sort().at(-1)
    const now = latest ? averageTo(g.weights, latest) : null
    if (now !== null) out.push({ label: 'Weight', value: `${kg(now)} → ${kg(g.food.targetKg)}` })
  }

  for (const p of g.projects.projects) {
    const goal = nextGoal(p)
    out.push({ label: p.name, value: goal ? `${p.users}/${goal} paid` : `${p.users} paid` })
  }

  const target = g.languages.filter((t) => t.by >= today).sort((a, b) => a.by.localeCompare(b.by))[0]
  if (target) out.push({ label: target.label || LANGUAGE_NAMES[target.language], value: `${LANGUAGE_NAMES[target.language]} · ${countdown(today, target.by)}` })

  for (const s of g.savings) out.push({ label: s.name, value: `${pounds(s.saved)}/${pounds(s.target)}` })
  return out.slice(0, MAX_GOALS)
}
