import { ChevronDown, ChevronUp, HeartPulse } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toISODate, todayISO } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { useUserId } from '@/modules/auth/AuthProvider'
import { useAddMeasurement, useMeasurements, useMetricDefinitions, useMorningCheckInOn } from '../api'

/** The readings asked for each morning (Garmin has no personal API, so they're typed in). */
const KEYS = ['weight', 'sleep_duration', 'sleep_score'] as const
type Key = (typeof KEYS)[number]
const SKIP_KEY = 'life.checkin.skipped'

function skippedToday() {
  try {
    return localStorage.getItem(SKIP_KEY) === todayISO()
  } catch {
    return false
  }
}

/** A number from a text box, or null when it's empty or outside min-max. */
const parse = (text: string, min: number, max: number) => {
  const n = Number(text.replace(',', '.'))
  return text.trim() && Number.isFinite(n) && n >= min && n <= max ? n : null
}

/** Each question as it is asked, shortest first. */
const QUESTION: Record<Key, string> = {
  weight: 'Weight?',
  sleep_duration: 'How long did you sleep?',
  sleep_score: 'Sleep score?',
}

/**
 * One of Home's Today's tasks, each morning until done: today's weight, last
 * night's sleep and the watch's sleep score. Tap it to answer; it only asks
 * for what hasn't been logged today, and Skip hides it until tomorrow. Renders
 * an <li>, so it sits in the task list. Each person can switch it off in Settings.
 */
export function MorningCheckIn() {
  const me = useUserId()
  const on = useMorningCheckInOn()
  const defs = useMetricDefinitions()
  const measurements = useMeasurements()
  const add = useAddMeasurement()
  const [skipped, setSkipped] = useState(skippedToday)
  const [open, setOpen] = useState(false)
  const [weight, setWeight] = useState('')
  const [hours, setHours] = useState('')
  const [minutes, setMinutes] = useState('')
  const [score, setScore] = useState('')
  const today = todayISO()

  const defOf = (key: Key) => defs.data?.find((d) => d.key === key && d.owner_id === null)
  const done = (key: Key) =>
    (measurements.data ?? []).some((m) => m.user_id === me && m.metric_id === defOf(key)?.id && toISODate(new Date(m.measured_at)) === today)
  const missing = KEYS.filter((k) => defOf(k) && !done(k))
  if (on.data !== true || skipped || !defs.data || !measurements.data || !missing.length) return null

  const needs = (k: Key) => missing.includes(k)
  const sleepHours = hours.trim() || minutes.trim() ? (parse(hours || '0', 0, 16) ?? NaN) + (parse(minutes || '0', 0, 59) ?? NaN) / 60 : null
  const values: [Key, number | null][] = [
    ['weight', needs('weight') ? parse(weight, 30, 250) : null],
    ['sleep_duration', needs('sleep_duration') && sleepHours !== null && Number.isFinite(sleepHours) && sleepHours > 0 ? sleepHours : null],
    ['sleep_score', needs('sleep_score') ? parse(score, 0, 100) : null],
  ]
  const ready = values.filter(([, v]) => v !== null)

  const save = async () => {
    try {
      const at = new Date().toISOString()
      for (const [key, value] of ready) await add.mutateAsync({ metric_id: defOf(key)!.id, value: Math.round(value! * 100) / 100, measured_at: at })
      toast.success('Logged')
    } catch (e) {
      toast.error(getErrorMessage(e))
    }
  }
  const skip = () => {
    try {
      localStorage.setItem(SKIP_KEY, today)
    } catch {
      // Private browsing: it just comes back next time.
    }
    setSkipped(true)
  }

  const row = 'flex items-center justify-between gap-3 text-sm'
  return (
    <li className="rounded-xl animate-fade-in">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
        onClick={() => setOpen(!open)}
      >
        <HeartPulse className="size-[22px] shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] leading-snug">Morning check-in</span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{missing.map((k) => LABEL[k]).join(' · ')}</span>
        </span>
        {open ? <ChevronUp className="size-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="size-4 shrink-0 text-muted-foreground" />}
      </button>
      {open ? (
        <form
          className="grid gap-2 px-3 pb-3 pt-1"
          onSubmit={(e) => {
            e.preventDefault()
            if (ready.length) void save()
          }}
        >
          {needs('weight') ? (
            <label className={row}>
              {QUESTION.weight}
              <Input aria-label="Weight in kg" inputMode="decimal" placeholder="kg" autoFocus className="h-9 w-20" value={weight} onChange={(e) => setWeight(e.target.value)} />
            </label>
          ) : null}
          {needs('sleep_duration') ? (
            <div className={row}>
              <span id="checkin-slept">{QUESTION.sleep_duration}</span>
              <span className="flex gap-1" role="group" aria-labelledby="checkin-slept">
                <Input aria-label="Hours slept" inputMode="numeric" placeholder="h" autoFocus={!needs('weight')} className="h-9 w-12" value={hours} onChange={(e) => setHours(e.target.value)} />
                <Input aria-label="Minutes slept" inputMode="numeric" placeholder="m" className="h-9 w-12" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
              </span>
            </div>
          ) : null}
          {needs('sleep_score') ? (
            <label className={row}>
              {QUESTION.sleep_score}
              <Input aria-label="Sleep score" inputMode="numeric" placeholder="0-100" className="h-9 w-20" value={score} onChange={(e) => setScore(e.target.value)} />
            </label>
          ) : null}
          <div className="flex justify-end gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={skip}>Skip</Button>
            <Button type="submit" size="sm" disabled={!ready.length || add.isPending}>Save</Button>
          </div>
        </form>
      ) : null}
    </li>
  )
}

const LABEL: Record<Key, string> = { weight: 'Weight', sleep_duration: 'Sleep', sleep_score: 'Sleep score' }
