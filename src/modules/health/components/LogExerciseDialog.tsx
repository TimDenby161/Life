import { format } from 'date-fns'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/misc'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { useAddExercise, useExerciseSessions } from '../api'

const MAIN = ['Table Tennis', 'Yoga', 'Gym', 'Run', 'Padel', 'Workout', 'Pilates']
const MINUTES = [15, 30, 45, 60]

function nowLocalInput() {
  return format(new Date(), "yyyy-MM-dd'T'HH:mm")
}

const BOTH = 'both'

/** Log a session: who (me, my partner, or both of us), what, how many minutes, when (now by default). */
export function LogExerciseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me, partner } = useHousehold()
  const sessions = useExerciseSessions().data ?? []
  const [who, setWho] = useState(me.id)
  const add = useAddExercise()
  const [description, setDescription] = useState('')
  const [duration, setDuration] = useState('')
  const [when, setWhen] = useState(nowLocalInput)
  const [error, setError] = useState<string | null>(null)

  // The main activities, then anything else either of you has logged recently.
  const all = [...MAIN, ...sessions.map((s) => s.description.trim()).filter((d) => d.length <= 30)]
  const suggestions = [...new Map(all.map((d) => [d.toLowerCase(), d])).keys()]
    .map((key) => all.find((d) => d.toLowerCase() === key)!)
    .slice(0, 10)
  const people = who === BOTH && partner ? [me.id, partner.id] : [who]

  const close = () => {
    setDescription('')
    setDuration('')
    setWho(me.id)
    setError(null)
    add.reset()
    onClose()
  }
  const chip = (selected: boolean) =>
    cn('h-8 rounded-full border px-3 text-sm transition-colors', selected ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setWhen(nowLocalInput())
        else close()
      }}
    >
      <DialogContent title="Log exercise">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            const mins = Number.parseInt(duration, 10)
            if (!description.trim()) return setError('Say what you did')
            if (!Number.isFinite(mins) || mins <= 0 || mins > 1440) return setError('Enter how many minutes')
            add.mutate({ people, description: description.trim(), started_at: new Date(when).toISOString(), duration_minutes: mins }, { onSuccess: close })
          }}
        >
          {partner ? (
            <Segmented
              aria-label="Who"
              value={who}
              onChange={setWho}
              options={[
                { value: me.id, label: me.display_name },
                { value: partner.id, label: partner.display_name },
                { value: BOTH, label: 'Both of us' },
              ]}
            />
          ) : null}
          <Field label="What did you do?" htmlFor="ex-desc">
            <div className="grid gap-2">
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button key={s} type="button" className={chip(description.trim().toLowerCase() === s.toLowerCase())} onClick={() => { setDescription(s); setError(null) }}>
                    {s}
                  </button>
                ))}
              </div>
              <Input id="ex-desc" value={description} maxLength={500} placeholder="Or type it, e.g. 5k run" onChange={(e) => { setDescription(e.target.value); setError(null) }} />
            </div>
          </Field>
          <Field label="Minutes" htmlFor="ex-min">
            <div className="flex flex-wrap items-center gap-1.5">
              {MINUTES.map((m) => (
                <button key={m} type="button" className={chip(duration === String(m))} onClick={() => { setDuration(String(m)); setError(null) }}>
                  {m}
                </button>
              ))}
              <Input id="ex-min" inputMode="numeric" className="h-8 w-24 rounded-full" placeholder="Other" value={MINUTES.map(String).includes(duration) ? '' : duration} onChange={(e) => { setDuration(e.target.value); setError(null) }} />
            </div>
          </Field>
          <Field label="When" htmlFor="ex-when">
            <Input id="ex-when" type="datetime-local" value={when} max={nowLocalInput()} onChange={(e) => setWhen(e.target.value)} />
          </Field>
          {error || add.error ? <p className="text-sm text-destructive">{error ?? getErrorMessage(add.error)}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            <Button type="submit" disabled={add.isPending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
