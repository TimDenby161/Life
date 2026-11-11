import { format } from 'date-fns'
import { CalendarDays, Plus, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { addDaysISO, parseISODate } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { type Member, useHousehold } from '@/modules/household/HouseholdProvider'
import {
  type AvailabilityRow,
  type MealWishRow,
  type PlanSlot,
  type SlotNoteRow,
  useAddWish,
  useDeleteWish,
  useSaveSlotNote,
  useSetAvailable,
} from '../api'
import { PLAN_DAYS } from '../../../../supabase/functions/_shared/meals.ts'
import { MealInput } from './WeekMeals'

export { PLAN_DAYS }
const SLOTS: { slot: PlanSlot; label: string }[] = [
  { slot: 'lunch', label: 'Lunch' },
  { slot: 'dinner', label: 'Dinner' },
]

const onError = (e: unknown) => toast.error(getErrorMessage(e))

/** Meals either of you wants soon: typed fresh, or picked from ones you've had (the suggestions). */
function Wishes({ wishes }: { wishes: MealWishRow[] }) {
  const [text, setText] = useState('')
  const add = useAddWish()
  const del = useDeleteWish()
  const submit = () => {
    const name = text.replace(/\s+/g, ' ').trim()
    if (!name) return
    if (wishes.some((w) => w.name.toLowerCase() === name.toLowerCase())) return setText('')
    add.mutate(name, { onSuccess: () => setText(''), onError })
  }

  return (
    <Card className="p-3">
      <h2 className="mb-2 px-0.5 text-sm font-semibold">Want</h2>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Input
          aria-label="A meal you want"
          placeholder="Fish pie"
          list="meal-names"
          maxLength={80}
          autoComplete="off"
          enterKeyHint="done"
          className="h-9"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" size="icon" variant="outline" aria-label="Add" disabled={!text.trim() || add.isPending}>
          <Plus />
        </Button>
      </form>
      {wishes.length ? (
        <ul className="mt-2.5 flex flex-wrap gap-1.5">
          {wishes.map((w) => (
            <li key={w.id} className="flex max-w-full items-center gap-0.5 rounded-full border bg-muted/40 py-0.5 pl-3 pr-0.5 text-sm">
              <span className="truncate">{w.name}</span>
              <Button
                size="icon-sm"
                variant="ghost"
                className="size-6 rounded-full text-muted-foreground"
                aria-label={`Remove ${w.name}`}
                onClick={() => del.mutate(w.id, { onError })}
              >
                <X className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  )
}

/** One person's in/out for a meal: tap to switch. A calendar icon marks an out that came from the calendar. */
function PersonToggle({ person, row, day, slot, what }: { person: Member; row: AvailabilityRow | undefined; day: string; slot: PlanSlot; what: string }) {
  const set = useSetAvailable()
  const available = row?.available ?? true
  // Shows the tap straight away.
  const shown = set.isPending && set.variables ? set.variables.available : available
  const fromCalendar = row?.source === 'calendar' && !shown
  return (
    <button
      type="button"
      aria-pressed={shown}
      aria-label={`${person.display_name}, ${what}`}
      title={fromCalendar ? 'Out, from the calendar' : shown ? 'In' : 'Out'}
      className="relative grid size-8 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => set.mutate({ day, slot, person_id: person.id, available: !available, exists: Boolean(row) }, { onError })}
    >
      <Avatar name={person.display_name} color={person.avatar_color} size="sm" className={cn('transition-opacity', !shown && 'opacity-25 grayscale')} />
      {!shown ? <span className="absolute inset-x-1 top-1/2 h-0.5 -rotate-45 rounded bg-foreground/70" aria-hidden /> : null}
      {fromCalendar ? <CalendarDays className="absolute -bottom-0.5 -right-0.5 size-3 rounded-sm bg-card text-muted-foreground" aria-hidden /> : null}
    </button>
  )
}

/** The next few days: who is in for lunch and dinner, and anything you want for that meal. */
function Grid({ from, people, availability, notes }: { from: string; people: Member[]; availability: AvailabilityRow[]; notes: SlotNoteRow[] }) {
  const save = useSaveSlotNote()
  const days = Array.from({ length: PLAN_DAYS }, (_, i) => addDaysISO(from, i))
  const dayLabel = (day: string, i: number) => (i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : format(parseISODate(day), 'EEEE'))

  return (
    <Card className="p-3">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-1">
        {SLOTS.map((s) => (
          <h2 key={s.slot} className="px-0.5 text-xs font-medium text-muted-foreground">
            {s.label}
          </h2>
        ))}
        {days.map((day, i) => (
          <div key={day} className="col-span-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t pt-2">
            <h3 className="col-span-2 px-0.5 text-sm font-semibold">
              {dayLabel(day, i)} <span className="font-normal text-muted-foreground">{format(parseISODate(day), 'd MMM')}</span>
            </h3>
            {SLOTS.map(({ slot, label }) => {
              const what = `${dayLabel(day, i)} ${label.toLowerCase()}`
              const note = notes.find((n) => n.day === day && n.slot === slot)
              return (
                <div key={slot} className="grid min-w-0 gap-1.5 pb-1">
                  <div className="flex gap-1">
                    {people.map((p) => (
                      <PersonToggle
                        key={p.id}
                        person={p}
                        day={day}
                        slot={slot}
                        what={what}
                        row={availability.find((a) => a.day === day && a.slot === slot && a.person_id === p.id)}
                      />
                    ))}
                  </div>
                  <MealInput
                    value={note?.note ?? ''}
                    label={`What you want, ${what}`}
                    placeholder="Anything?"
                    maxLength={120}
                    className="h-8 text-sm"
                    onSave={(text) => save.mutate({ day, slot, note: text, exists: Boolean(note) }, { onError })}
                  />
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </Card>
  )
}

/**
 * Plan: meals you want, then who is in for the next four days' lunches and
 * dinners (filled overnight from the calendars). The button has Claude put
 * meals in the empty slots, then write the shopping list and recipes.
 */
export function Plan({
  from,
  wishes,
  availability,
  notes,
  busy,
  onPlan,
}: {
  from: string
  wishes: MealWishRow[]
  availability: AvailabilityRow[]
  notes: SlotNoteRow[]
  /** What is happening now ("Planning meals…"), or null. */
  busy: string | null
  onPlan: () => void
}) {
  const { me, partner } = useHousehold()
  const people = partner ? [me, partner] : [me]
  return (
    <>
      <div className="grid gap-3 md:grid-cols-2 md:items-start">
        <Wishes wishes={wishes} />
        <Grid from={from} people={people} availability={availability} notes={notes} />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={onPlan} disabled={Boolean(busy)} className="w-full sm:w-auto">
          <Sparkles /> {busy ?? 'Plan meals'}
        </Button>
      </div>
    </>
  )
}
