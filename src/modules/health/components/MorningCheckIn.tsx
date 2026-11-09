import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { toISODate, todayISO } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { useUserId } from '@/modules/auth/AuthProvider'
import { useAddMeasurement, useMeasurements, useMetricDefinitions } from '../api'

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

/**
 * Home, each morning until done: today's weight, last night's sleep and the
 * watch's sleep score, in one go. Only asks for what hasn't been logged today;
 * Skip hides it until tomorrow.
 */
export function MorningCheckIn() {
  const me = useUserId()
  const defs = useMetricDefinitions()
  const measurements = useMeasurements()
  const add = useAddMeasurement()
  const [skipped, setSkipped] = useState(skippedToday)
  const [weight, setWeight] = useState('')
  const [hours, setHours] = useState('')
  const [minutes, setMinutes] = useState('')
  const [score, setScore] = useState('')
  const today = todayISO()

  const defOf = (key: Key) => defs.data?.find((d) => d.key === key && d.owner_id === null)
  const done = (key: Key) =>
    (measurements.data ?? []).some((m) => m.user_id === me && m.metric_id === defOf(key)?.id && toISODate(new Date(m.measured_at)) === today)
  const missing = KEYS.filter((k) => defOf(k) && !done(k))
  if (skipped || !defs.data || !measurements.data || !missing.length) return null

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

  return (
    <Card className="grid gap-2 p-3">
      <h2 className="text-sm font-semibold">Morning check-in</h2>
      <form
        className="flex flex-wrap items-end gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready.length) save()
        }}
      >
        {needs('weight') ? (
          <label className="grid gap-1 text-xs text-muted-foreground">
            Weight
            <Input aria-label="Weight in kg" inputMode="decimal" placeholder="kg" className="h-9 w-20" value={weight} onChange={(e) => setWeight(e.target.value)} />
          </label>
        ) : null}
        {needs('sleep_duration') ? (
          <label className="grid gap-1 text-xs text-muted-foreground">
            Slept
            <span className="flex gap-1">
              <Input aria-label="Hours slept" inputMode="numeric" placeholder="h" className="h-9 w-12" value={hours} onChange={(e) => setHours(e.target.value)} />
              <Input aria-label="Minutes slept" inputMode="numeric" placeholder="m" className="h-9 w-12" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </span>
          </label>
        ) : null}
        {needs('sleep_score') ? (
          <label className="grid gap-1 text-xs text-muted-foreground">
            Sleep score
            <Input aria-label="Sleep score" inputMode="numeric" placeholder="0-100" className="h-9 w-16" value={score} onChange={(e) => setScore(e.target.value)} />
          </label>
        ) : null}
        <div className="ml-auto flex gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={skip}>Skip</Button>
          <Button type="submit" size="sm" disabled={!ready.length || add.isPending}>Save</Button>
        </div>
      </form>
    </Card>
  )
}
