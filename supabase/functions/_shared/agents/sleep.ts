// Sleep Coach: hours slept and the watch's sleep score, from Home's morning
// check-in, against each person's target (e.g. 8 hours before a 7am alarm).
// Pure. Sleep is health data: everything goes only to its owner, and none of
// it reaches the AI summary or a notification.
//
//   sleep:<id>:short:<date>    last night under target: a bedtime for tonight,
//                              warning when the evening runs late
//   sleep:<id>:week:<week>     Mondays: last week's nights against the target
import { busyBlocks, type CalEvent, DEFAULT_WINDOW, type DayWindow, toMinutes, type TravelRule } from './calendar.ts'
import { addDays, type ISODate, isoWeekday, isoWeekKey } from './dates.ts'
import { formatMinutes } from './taskManager.ts'
import type { Member, SuggestionDraft } from './types.ts'

/** Time it takes to fall asleep, so "in bed by" is this much before sleep starts. */
export const SETTLE_MINUTES = 15
/** Nights this far under target count as short. */
export const SHORT_BY_HOURS = 0.25
/** Short nights in a row that make it pressing. */
export const SHORT_STREAK = 3
/** Home this close to bedtime leaves no time to wind down (after sport especially). */
export const WIND_DOWN_MINUTES = 90

export type SleepGoals = { targetHours: number; wakeTime: string }
/** One morning's check-in: hours slept the night before and the sleep score, either may be missing. */
export type Night = { user_id: string; date: ISODate; hours: number | null; score: number | null }

/** Goals as saved in agent_settings.config, cleaned; null when there's no target. */
export function parseSleepGoals(config: unknown): SleepGoals | null {
  const c = (config ?? {}) as { targetHours?: unknown; wakeTime?: unknown }
  const target = typeof c.targetHours === 'number' && c.targetHours >= 5 && c.targetHours <= 11 ? c.targetHours : null
  if (target === null) return null
  const wake = typeof c.wakeTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(c.wakeTime) ? c.wakeTime : '07:00'
  return { targetHours: target, wakeTime: wake }
}

/** Readings (one per metric) grouped into nights, latest of each per morning. */
export function nightsFrom(readings: { user_id: string; date: ISODate; key: string; value: number }[]): Night[] {
  const byKey = new Map<string, Night>()
  for (const r of [...readings].sort((a, b) => a.date.localeCompare(b.date))) {
    const k = `${r.user_id}|${r.date}`
    const n = byKey.get(k) ?? { user_id: r.user_id, date: r.date, hours: null, score: null }
    if (r.key === 'sleep_duration') n.hours = r.value
    if (r.key === 'sleep_score') n.score = r.value
    byKey.set(k, n)
  }
  return [...byKey.values()]
}

const hm = (hours: number) => formatMinutes(Math.round(hours * 60))
const clock = (minutes: number) => {
  const m = ((minutes % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Plans stop this long before bed, to wind down. */
export const PLAN_STOPS_BEFORE_BED = 30

/** The part of the day for jobs: from the alarm to half an hour before bed; 7am to 10pm without a sleep goal. */
export function planWindow(goals: SleepGoals | null): DayWindow {
  if (!goals) return DEFAULT_WINDOW
  return { start: toMinutes(goals.wakeTime), end: toMinutes(bedtime(goals)) - PLAN_STOPS_BEFORE_BED }
}

/** When to be in bed to sleep the target before waking: wake time less the target and time to settle. */
export function bedtime(goals: SleepGoals): string {
  return clock(toMinutes(goals.wakeTime) - Math.round(goals.targetHours * 60) - SETTLE_MINUTES)
}

const TIPS = [
  'Get up at the same time every day, weekends too: it sets when you get sleepy.',
  'No caffeine after 2pm. It lasts longer than it feels.',
  'Screens off half an hour before bed, or at least dimmed.',
  'A cool, dark room helps: blackout blinds or an eye mask.',
  'Hard exercise late in the evening makes it harder to drop off: wind down with a shower and stretching.',
  'Alcohol knocks you out but wrecks the second half of the night.',
  'Daylight in the morning, even ten minutes outside, makes evenings sleepier.',
]

export function analyseSleep(
  today: ISODate,
  members: Member[],
  nights: Night[],
  enabled: string[],
  goalsFor: (userId: string) => SleepGoals | null,
  calendar: CalEvent[] = [],
  travelFor: (userId: string) => TravelRule[] = () => [],
  timeZone = 'Europe/London',
): SuggestionDraft[] {
  const out: SuggestionDraft[] = []
  for (const m of members.filter((x) => enabled.includes(x.id))) {
    const goals = goalsFor(m.id)
    if (!goals) continue
    const id = m.id.slice(0, 8)
    const mine = nights.filter((n) => n.user_id === m.id && n.hours !== null).sort((a, b) => a.date.localeCompare(b.date))
    const bed = bedtime(goals)
    const short = (n: Night) => n.hours! < goals.targetHours - SHORT_BY_HOURS

    const last = mine.find((n) => n.date === today)
    if (last && short(last)) {
      let streak = 0
      for (let i = mine.length - 1; i >= 0 && short(mine[i]) && mine[i].date === addDays(today, -(mine.length - 1 - i)); i--) streak++
      // The evening's last commitment (with travel home), if it runs close to bedtime.
      const lateEnd = busyBlocks(calendar, m.id, today, timeZone, travelFor(m.id))
        .map((b) => b.to)
        .filter((to) => to >= '19:00')
        .sort()
        .at(-1)
      const tight = lateEnd && toMinutes(lateEnd) > toMinutes(bed) - WIND_DOWN_MINUTES
      out.push({
        dedupe_key: `sleep:${id}:short:${today}`,
        kind: 'sleep_short',
        severity: streak >= SHORT_STREAK ? 2 : 1,
        title: `${hm(last.hours!)} last night${last.score !== null ? `, score ${last.score}` : ''}`,
        reason: [
          `In bed by ${bed} tonight gets you ${hm(goals.targetHours)} before your ${goals.wakeTime} alarm.`,
          streak >= SHORT_STREAK ? `That’s ${streak} short nights in a row, so tonight matters more than anything else on the list.` : '',
          tight ? `You’re busy until ${lateEnd}, so go straight to bed after: no screens, a shower and lights out.` : '',
        ]
          .filter(Boolean)
          .join(' '),
        task_id: null,
        action: { type: 'create_task', title: `In bed by ${bed}`, list: 'personal', due_date: today },
        recipients: [m.id],
      })
    }

    if (isoWeekday(today) === 1) {
      const week = mine.filter((n) => n.date >= addDays(today, -6) && n.date <= today)
      if (week.length) {
        const avg = week.reduce((s, n) => s + n.hours!, 0) / week.length
        const scored = week.filter((n) => n.score !== null)
        const enough = week.filter((n) => !short(n)).length
        out.push({
          dedupe_key: `sleep:${id}:week:${isoWeekKey(today)}`,
          kind: 'sleep_week',
          severity: avg < goals.targetHours - 1 ? 2 : 1,
          title: `Last week: ${hm(avg)} a night on average`,
          reason: [
            `${enough} of ${week.length} logged nights reached ${hm(goals.targetHours)}${scored.length ? `; sleep score ${Math.round(scored.reduce((s, n) => s + n.score!, 0) / scored.length)} on average` : ''}.`,
            `This week: ${TIPS[Number(isoWeekKey(today).slice(-2)) % TIPS.length]}`,
          ].join(' '),
          task_id: null,
          action: null,
          recipients: [m.id],
        })
      }
    }
  }
  return out
}

/** Average hours over the last seven mornings, for the briefing line; null without any. */
export function weekAverage(today: ISODate, nights: Night[]): number | null {
  const week = nights.filter((n) => n.hours !== null && n.date > addDays(today, -7) && n.date <= today)
  return week.length ? week.reduce((s, n) => s + n.hours!, 0) / week.length : null
}
