// When agents are due. The dispatcher runs hourly; these decide, from the
// household's local time, which run keys this tick should claim. A key that has
// already succeeded is refused by agent_claim_run, so asking twice is harmless
// and a missed tick simply catches up on the next one.
import { type ISODate, isoWeekday, isoWeekKey } from './dates.ts'
import type { AgentSchedule } from './registry.ts'

/** Morning runs start on the first tick from this hour. */
export const MORNING_HOUR = 6

export type DueRun = { runKey: string; kind: 'daily' | 'weekly' }

export function dailyKey(today: ISODate) {
  return `daily:${today}`
}

export function weeklyKey(today: ISODate) {
  return `weekly:${isoWeekKey(today)}`
}

/** On-demand runs share a key per ten minutes, so repeated presses don't re-run. */
export function manualKey(now: Date) {
  // "2026-11-06T14:23:45.000Z" -> "manual:2026-11-06T14:20"
  return `manual:${now.toISOString().slice(0, 15)}0`
}

/** A specialist's run: once a day, or once a week (first tick from Monday 6am, catching up later in the week if missed). */
export function agentDue(cadence: 'daily' | 'weekly' | null, today: ISODate, hour: number): DueRun | null {
  if (!cadence || hour < MORNING_HOUR) return null
  return cadence === 'daily' ? { runKey: dailyKey(today), kind: 'daily' } : { runKey: weeklyKey(today), kind: 'weekly' }
}

/**
 * Chief of Staff: every morning for anyone on daily, plus Monday's weekly
 * briefing for everyone. Monday runs once as a weekly that includes the daily.
 */
export function chiefOfStaffDue(today: ISODate, hour: number, schedules: AgentSchedule[]): DueRun | null {
  if (hour < MORNING_HOUR || !schedules.length) return null
  if (isoWeekday(today) === 1) return { runKey: weeklyKey(today), kind: 'weekly' }
  return schedules.includes('daily') ? { runKey: dailyKey(today), kind: 'daily' } : null
}
