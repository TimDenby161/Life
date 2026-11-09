// Fitness Coach: reads logged exercise sessions only (a description, when and
// how long; never weight or periods) and the person's own weekly goals, and
// suggests the next sensible session. Pure; each person hears only about their
// own training.
//
// Rules, in order of priority:
//   0. Events (tournaments, races) from the goals: a taper in the six days
//      before, which also holds back conditioning and strength, and an easy
//      day after.
//   1. Load: a week well above the person's usual, or too many days in a row,
//      gets recovery advice and nothing that adds volume. Someone aiming for six
//      or more active days a week gets the rest-day nudge after seven in a row.
//   2. Goals (if set): a required activity not done yet late in the week, an
//      "at most" activity over its limit, active days behind pace, and on
//      Mondays a review of last week. When you both have the same activity
//      still to do, it becomes one suggestion to do it together.
//   3. Balance: no strength or no mobility in two weeks.
//   4. Table tennis: one conditioning session a week for anyone who plays,
//      rotating footwork, explosiveness and endurance.
//   5. Without goals: a gap, for someone who usually trains.
// Missing logs are just missing logs: wording says "nothing logged", never
// "you haven't exercised".
import { addDays, daysBetween, type ISODate, isoWeekday, isoWeekKey, nextWeekday, shortDay } from './dates.ts'
import { similarTitles } from './taskManager.ts'
import type { Action, Member, OpenTask, SuggestionDraft } from './types.ts'

export const HISTORY_DAYS = 42
export const SPIKE_RATIO = 1.5
export const SPIKE_MIN_MINUTES = 240
export const STREAK_DAYS = 6
export const GAP_DAYS = 4
export const MAX_PER_PERSON = 3
/** A once-a-week activity is nudged from Thursday (four days left, today included). */
export const NUDGE_DAYS_LEFT = 4
/** Days before an event when the taper starts, and when hard sessions stop. */
export const TAPER_DAYS = 6
export const FRESH_DAYS = 3

export type Session = { user_id: string; description: string; started_at: string; duration_minutes: number }

/** `max`: times is a limit, not a target (e.g. table tennis at most twice a week). */
export type ActivityGoal = { name: string; times: number; optional?: boolean; max?: boolean }
export type FitnessEvent = { name: string; date: ISODate }
export type FitnessGoals = { activeDays: number | null; activities: ActivityGoal[]; events: FitnessEvent[] }

const STRENGTH = /\b(gym|weights?|strength|workout|press[- ]?ups?|squats?|deadlifts?|kettlebells?|circuits?|lunges?|plank)\b/i
const MOBILITY = /\b(yoga|pilates|stretch(ing)?|mobility|foam roll(ing)?)\b/i
const TABLE_TENNIS = /\b(table tennis|tt|ping ?pong)\b/i

/** Other ways the same activity gets logged. */
const ALIASES: Record<string, RegExp> = {
  'table tennis': TABLE_TENNIS,
  run: /\b(run|runs|running|jog|jogging|parkrun)\b/i,
  gym: STRENGTH,
  yoga: /\byoga\b/i,
  swim: /\b(swim|swims|swimming)\b/i,
  cycle: /\b(cycle|cycling|bike|ride)\b/i,
}

/** Does a logged session count as this activity? By its words, plus a few common aliases. */
export function matchesActivity(description: string, name: string): boolean {
  const key = name.trim().toLowerCase()
  const alias = ALIASES[key] ?? ALIASES[key.replace(/s$/, '')]
  if (alias) return alias.test(description)
  const words = key.split(/\s+/).filter(Boolean)
  const text = description.toLowerCase()
  return words.length > 0 && words.every((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text))
}

/** Goals as saved in agent_settings.config, cleaned; null when there are none. */
export function parseFitnessGoals(config: unknown): FitnessGoals | null {
  const c = (config ?? {}) as { activeDays?: unknown; activities?: unknown; events?: unknown }
  const activeDays = Number.isInteger(c.activeDays) && (c.activeDays as number) >= 1 && (c.activeDays as number) <= 7 ? (c.activeDays as number) : null
  const activities = (Array.isArray(c.activities) ? c.activities : [])
    .map((a) => a as { name?: unknown; times?: unknown; optional?: unknown; max?: unknown })
    .filter((a) => typeof a.name === 'string' && a.name.trim() && Number.isInteger(a.times) && (a.times as number) >= 1 && (a.times as number) <= 7)
    .slice(0, 8)
    .map((a) => ({ name: (a.name as string).trim().slice(0, 40), times: a.times as number, optional: a.optional === true, max: a.max === true }))
  const events = (Array.isArray(c.events) ? c.events : [])
    .map((e) => e as { name?: unknown; date?: unknown })
    .filter((e) => typeof e.name === 'string' && e.name.trim() && typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date))
    .slice(0, 12)
    .map((e) => ({ name: (e.name as string).trim().slice(0, 60), date: e.date as ISODate }))
  return activeDays || activities.length || events.length ? { activeDays, activities, events } : null
}

export const TT_DRILLS = [
  'Table tennis footwork: 6 × 30s side-to-side shuffles and crossover steps, 30s rest',
  'Table tennis explosiveness: 4 × 5 lateral bounds and 4 × 5 split-step jumps, full rest between',
  'Table tennis endurance: 20 min intervals, 30s hard and 30s easy',
]

export function formatMinutesShort(m: number) {
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`
}

const weekNumber = (today: ISODate) => Number(isoWeekKey(today).slice(-2))
const lower = (name: string) => (name === name.toUpperCase() ? name : name.toLowerCase())

type Dated = Session & { date: ISODate }

/** Monday's suggestions: last week against the goals. */
function weekReview(today: ISODate, goals: FitnessGoals, mine: Dated[]): { title: string; reason: string } {
  const from = addDays(today, -7)
  const lastWeek = mine.filter((s) => s.date >= from && s.date < today)
  const active = new Set(lastWeek.map((s) => s.date)).size
  const parts = goals.activities.map((a) => {
    const n = lastWeek.filter((s) => matchesActivity(s.description, a.name)).length
    if (a.max) return `${lower(a.name)} ${n} (at most ${a.times}${n > a.times ? ', over' : ''})`
    return a.optional ? `${lower(a.name)} ${n} (optional)` : `${lower(a.name)} ${n} of ${a.times}${n >= a.times ? ' ✓' : ''}`
  })
  return {
    title: goals.activeDays ? `Last week: ${active} of ${goals.activeDays} active days` : `Last week: ${active} active days`,
    reason: parts.length ? `${parts.join(', ')}.`.replace(/^./, (c) => c.toUpperCase()) : 'No activity goals set.',
  }
}

function personAdvice(today: ISODate, member: Member, sessions: Session[], open: OpenTask[], goals: FitnessGoals | null): Omit<SuggestionDraft, 'recipients'>[] {
  const mine: Dated[] = sessions.filter((s) => s.user_id === member.id).map((s) => ({ ...s, date: s.started_at.slice(0, 10) }))
  if (!mine.length && !goals) return []
  const week = isoWeekKey(today)
  const key = (what: string) => `fitness:${member.id.slice(0, 8)}:${what}:${week}`
  const minutesBetween = (from: number, to: number) =>
    mine.filter((s) => s.date > addDays(today, -from) && s.date <= addDays(today, -to)).reduce((n, s) => n + s.duration_minutes, 0)
  const lastWeek = minutesBetween(7, 0)
  const usual = Math.round(minutesBetween(35, 7) / 4)
  const days = new Set(mine.map((s) => s.date))
  let streak = 0
  for (let d = days.has(today) ? today : addDays(today, -1); days.has(d); d = addDays(d, -1)) streak++
  const recent = (re: RegExp, n: number) => mine.some((s) => re.test(s.description) && s.date > addDays(today, -n))
  const playsTT = recent(TABLE_TENNIS, HISTORY_DAYS) || Boolean(goals?.activities.some((a) => matchesActivity('table tennis', a.name)))
  const hasTask = (title: string) => open.some((t) => similarTitles(t.title, title))
  const task = (title: string, due: ISODate): Action => ({ type: 'create_task', title, list: 'personal', due_date: due })
  const out: Omit<SuggestionDraft, 'recipients'>[] = []

  // 0. Events: taper before, easy day after.
  const upcoming = (goals?.events ?? []).filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0]
  const daysToEvent = upcoming ? daysBetween(today, upcoming.date) : null
  /** Close enough to an event that hard conditioning and strength would leave you tired for it. */
  const fresh = daysToEvent !== null && daysToEvent <= FRESH_DAYS
  if (upcoming && daysToEvent! <= TAPER_DAYS) {
    const when = daysToEvent === 0 ? 'today' : daysToEvent === 1 ? 'tomorrow' : `on ${shortDay(upcoming.date, today)}`
    const sharpen = `Light hit before ${upcoming.name}: 30 min, serves and receive`
    out.push({
      dedupe_key: `fitness:${member.id.slice(0, 8)}:event:${upcoming.date}`,
      kind: 'event_taper',
      severity: daysToEvent! <= 2 ? 2 : 1,
      title: `${upcoming.name} ${when}`,
      reason:
        daysToEvent === 0
          ? 'Eat well beforehand, warm up properly and take water and a snack for between matches.'
          : `Keep sessions short and sharp from now${fresh ? '' : `, nothing hard in the last ${FRESH_DAYS} days`}: no heavy legs or long conditioning. A light hit the day before and a good night’s sleep matter more than extra training.`,
      task_id: null,
      action: daysToEvent! >= 2 && !hasTask(sharpen) ? task(sharpen, addDays(upcoming.date, -1)) : null,
    })
  }
  const justDone = (goals?.events ?? []).find((e) => e.date === addDays(today, -1))
  if (justDone) {
    out.push({
      dedupe_key: `fitness:${member.id.slice(0, 8)}:after:${justDone.date}`,
      kind: 'event_recovery',
      severity: 1,
      title: `After ${justDone.name}: an easy day`,
      reason: 'A walk or 15 minutes of stretching helps legs recover. Note one thing that worked and one to practise next.',
      task_id: null,
      action: null,
    })
  }

  // 1. Too much: recovery only.
  if (usual >= 60 && lastWeek >= SPIKE_MIN_MINUTES && lastWeek > usual * SPIKE_RATIO) {
    const title = 'Recovery: 20 min mobility and easy stretching'
    out.push({
      dedupe_key: key('load'),
      kind: 'training_load',
      severity: 2,
      title: `A big week: ${formatMinutesShort(lastWeek)} against your usual ${formatMinutesShort(usual)}`,
      reason: 'Jumping well above your usual load is when niggles start. Keep the next day or two easy.',
      task_id: null,
      action: hasTask(title) ? null : task(title, addDays(today, 1)),
    })
  }
  const restAfter = goals?.activeDays && goals.activeDays >= STREAK_DAYS ? goals.activeDays + 1 : STREAK_DAYS
  if (streak >= restAfter) {
    out.push({
      dedupe_key: key('streak'),
      kind: 'rest_day',
      severity: 2,
      title: `${streak} days in a row`,
      reason: goals?.activeDays
        ? `Your goal is ${goals.activeDays} active days a week, which leaves room for a rest day. Take it now and the next sessions will be sharper.`
        : 'A rest day lets the training sink in and keeps the next sessions sharp.',
      task_id: null,
      action: null,
    })
  }
  if (out.some((s) => s.kind === 'training_load' || s.kind === 'rest_day')) return out

  // 2. Goals.
  if (goals) {
    const monday = addDays(today, 1 - isoWeekday(today))
    const daysLeft = 8 - isoWeekday(today)
    const thisWeek = mine.filter((s) => s.date >= monday && s.date <= today)
    for (const a of goals.activities.filter((g) => g.max)) {
      const n = thisWeek.filter((s) => matchesActivity(s.description, a.name)).length
      if (n <= a.times) continue
      out.push({
        dedupe_key: key(`over:${a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}:${n}`),
        kind: 'over_limit',
        severity: 1,
        title: `${n} ${lower(a.name)} sessions this week`,
        reason: `You set a limit of ${a.times === 1 ? 'once' : `${a.times} times`} a week, for balance. Something else, or a rest, for the rest of the week.`,
        task_id: null,
        action: null,
      })
    }
    for (const a of goals.activities.filter((g) => !g.optional && !g.max)) {
      const need = a.times - thisWeek.filter((s) => matchesActivity(s.description, a.name)).length
      const title = `${a.name} session`
      if (need <= 0 || daysLeft > NUDGE_DAYS_LEFT + need - 1 || hasTask(title)) continue
      out.push({
        dedupe_key: key(`goal:${a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`),
        kind: 'goal_activity',
        severity: daysLeft <= 2 ? 2 : 1,
        title: need === a.times ? `No ${lower(a.name)} logged yet this week` : `${need} more ${lower(a.name)} to go this week`,
        reason: `Your goal is ${lower(a.name)} ${a.times === 1 ? 'once' : `${a.times} times`} a week, and ${daysLeft === 1 ? 'today is the last day' : `there are ${daysLeft} days left`}.`,
        task_id: null,
        action: task(title, daysLeft <= 2 || isoWeekday(today) >= 6 ? today : nextWeekday(today, 6)),
      })
    }

    const elapsed = isoWeekday(today) - 1
    const active = new Set(thisWeek.filter((s) => s.date < today).map((s) => s.date)).size
    const expected = goals.activeDays ? Math.floor((goals.activeDays * elapsed) / 7) : 0
    const easy = '20 min walk or mobility'
    if (goals.activeDays && elapsed >= 2 && active < expected && !hasTask(easy)) {
      out.push({
        dedupe_key: key('pace'),
        kind: 'goal_pace',
        severity: 1,
        title: `${active} active ${active === 1 ? 'day' : 'days'} logged so far this week`,
        reason: `Your goal is ${goals.activeDays} a week. A short, easy session today counts and keeps it on track.`,
        task_id: null,
        action: task(easy, today),
      })
    }

    if (isoWeekday(today) === 1 && mine.length) {
      const review = weekReview(today, goals, mine)
      out.push({ dedupe_key: key('review'), kind: 'fitness_week', severity: 1, ...review, task_id: null, action: null })
    }
  }

  // 3. Balance over the last two weeks.
  if (mine.filter((s) => s.date > addDays(today, -14)).length >= 3) {
    const strength = playsTT
      ? 'Explosive strength for table tennis: 3 × 5 squat jumps, 3 × 8 split squats, 3 × 10 calf raises'
      : 'Strength: 3 × 10 squats, press-ups and rows'
    const mobility = 'Mobility: 15 min hips, ankles and upper back'
    if (fresh) {
      // Nothing that leaves the legs heavy just before an event.
    } else if (!recent(STRENGTH, 14) && !hasTask(strength)) {
      out.push({
        dedupe_key: key('strength'),
        kind: 'add_strength',
        severity: 1,
        title: 'No strength work logged in two weeks',
        reason: `Strength protects joints and adds power${playsTT ? ' to the first step and the swing' : ''}. One short session a week is enough.`,
        task_id: null,
        action: task(strength, addDays(today, 1)),
      })
    } else if (!recent(MOBILITY, 14) && !hasTask(mobility)) {
      out.push({
        dedupe_key: key('mobility'),
        kind: 'add_mobility',
        severity: 1,
        title: 'No mobility work logged in two weeks',
        reason: `Hips and ankles that move well${playsTT ? ' make low, fast footwork easier and' : ''} keep injuries away.`,
        task_id: null,
        action: task(mobility, addDays(today, 1)),
      })
    }
  }

  // 4. One table tennis conditioning session a week.
  if (playsTT && !fresh) {
    const drill = TT_DRILLS[weekNumber(today) % TT_DRILLS.length]
    if (!hasTask(drill)) {
      out.push({
        dedupe_key: key('tt'),
        kind: 'tt_conditioning',
        severity: 1,
        title: `This week’s table tennis conditioning: ${drill.split(':')[0].replace('Table tennis ', '')}`,
        reason: `${drill.split(': ')[1]}. Off the table, fresh, not straight after a match.`,
        task_id: null,
        action: task(drill, addDays(today, 1)),
      })
    }
  }

  // 5. Without goals: a gap, for someone who usually logs a few sessions a week.
  const lastDate = [...days].sort().at(-1)
  const gap = lastDate ? daysBetween(lastDate, today) : 0
  const perWeek = Math.round((mine.filter((s) => s.date > addDays(today, -28)).length / 4) * 10) / 10
  if (!goals && gap >= GAP_DAYS && perWeek >= 1) {
    const easy = playsTT ? TT_DRILLS[0] : '30 min brisk walk or easy run'
    out.push({
      dedupe_key: key('gap'),
      kind: 'get_moving',
      severity: 1,
      title: `Nothing logged for ${gap} days`,
      reason: `You usually log about ${perWeek} sessions a week. Something short and easy gets things going again.`,
      task_id: null,
      action: hasTask(easy) ? null : task(easy, today),
    })
  }

  return out.slice(0, MAX_PER_PERSON)
}

export function analyseFitness(
  today: ISODate,
  members: Member[],
  sessions: Session[],
  open: OpenTask[],
  enabled: string[],
  goalsFor: (userId: string) => FitnessGoals | null = () => null,
): SuggestionDraft[] {
  const out = members
    .filter((m) => enabled.includes(m.id))
    .flatMap((m) => personAdvice(today, m, sessions, open, goalsFor(m.id)).map((s) => ({ ...s, recipients: [m.id] })))
  return together(today, members, out)
}

/** The activity a goal nudge is about, from its dedupe key (fitness:<id>:goal:<activity>:<week>). */
const goalActivity = (s: SuggestionDraft) => (s.kind === 'goal_activity' ? s.dedupe_key.split(':')[3] : null)

/**
 * The same activity still to do for both of you this week: one suggestion to do
 * it together (a joint task for two) instead of one each.
 */
function together(today: ISODate, members: Member[], drafts: SuggestionDraft[]): SuggestionDraft[] {
  if (members.length < 2) return drafts
  const out = [...drafts]
  const byActivity = new Map<string, SuggestionDraft[]>()
  for (const s of drafts) {
    const a = goalActivity(s)
    if (a) byActivity.set(a, [...(byActivity.get(a) ?? []), s])
  }
  for (const [activity, pair] of byActivity) {
    if (pair.length < 2) continue
    const name = pair[0].action?.type === 'create_task' ? pair[0].action.title.replace(/ session$/, '') : activity
    const lowered = lower(name)
    for (const s of pair) out.splice(out.indexOf(s), 1)
    out.push({
      dedupe_key: `fitness:together:${activity}:${isoWeekKey(today)}`,
      kind: 'goal_together',
      severity: Math.max(...pair.map((s) => s.severity)) as SuggestionDraft['severity'],
      title: `You both still have ${lowered} to do this week: go together?`,
      reason: 'It’s on both your weekly goals, and a plan with someone else is harder to skip.',
      task_id: null,
      action: { type: 'create_task', title: `${name} together`, list: 'joint', needs_both: true, due_date: pair[0].action?.type === 'create_task' ? pair[0].action.due_date : today },
      recipients: pair.flatMap((s) => s.recipients),
    })
  }
  return out
}
