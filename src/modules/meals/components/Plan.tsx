import { format } from 'date-fns'
import { CalendarDays, CookingPot, Minus, Plus, Sparkles, Timer, X, Zap } from 'lucide-react'
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
  type PantryRow,
  type PlanSlot,
  type SlotNoteRow,
  useAddPantry,
  useDeletePantry,
  useSaveSlotNote,
  useSetAvailable,
} from '../api'
import { type Effort, MAX_PLAN_DAYS, PLAN_DAYS } from '../../../../supabase/functions/_shared/meals.ts'
import { MealInput } from './WeekMeals'

export { PLAN_DAYS }
const SLOTS: { slot: PlanSlot; label: string }[] = [
  { slot: 'lunch', label: 'Lunch' },
  { slot: 'dinner', label: 'Dinner' },
]

const onError = (e: unknown) => toast.error(getErrorMessage(e))

/** Ingredients you already have: Claude plans meals that use them, puts them in the recipes and leaves them off the shopping list. */
function Have({ pantry }: { pantry: PantryRow[] }) {
  const [text, setText] = useState('')
  const add = useAddPantry()
  const del = useDeletePantry()
  const submit = () => {
    const name = text.replace(/\s+/g, ' ').trim()
    if (!name) return
    if (pantry.some((p) => p.name.toLowerCase() === name.toLowerCase())) return setText('')
    add.mutate(name, { onSuccess: () => setText(''), onError })
  }

  return (
    <Card className="p-2">
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Input
          aria-label="An ingredient you already have"
          placeholder="Already have…"
          maxLength={60}
          autoComplete="off"
          enterKeyHint="done"
          className="h-8 text-sm"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" size="icon-sm" variant="outline" aria-label="Add" disabled={!text.trim() || add.isPending}>
          <Plus />
        </Button>
      </form>
      {pantry.length ? (
        <ul className="mt-1.5 flex flex-wrap gap-1">
          {pantry.map((p) => (
            <li key={p.id} className="flex max-w-full items-center rounded-full border bg-muted/40 pl-2.5 text-xs">
              <span className="truncate">{p.name}</span>
              <button
                type="button"
                className="grid size-6 place-items-center rounded-full text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${p.name}`}
                onClick={() => del.mutate(p.id, { onError })}
              >
                <X className="size-3" />
              </button>
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
      className="relative grid size-6 shrink-0 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => set.mutate({ day, slot, person_id: person.id, available: !available, exists: Boolean(row) }, { onError })}
    >
      <Avatar name={person.display_name} color={person.avatar_color} size="xs" className={cn('transition-opacity', !shown && 'opacity-25 grayscale')} />
      {!shown ? <span className="absolute inset-x-0.5 top-1/2 h-0.5 -rotate-45 rounded bg-foreground/70" aria-hidden /> : null}
      {fromCalendar ? <CalendarDays className="absolute -bottom-1 -right-1 size-2.5 rounded-sm bg-card text-muted-foreground" aria-hidden /> : null}
    </button>
  )
}

const EFFORT: Record<Effort | 'any', { icon: typeof Zap; title: string; next: Effort | null }> = {
  any: { icon: Timer, title: 'Any length', next: 'quick' },
  quick: { icon: Zap, title: 'Quick', next: 'long' },
  long: { icon: CookingPot, title: 'Longer cook', next: null },
}

/** Quick or a longer cook for one meal: tap to go any → quick → long → any. Shows the tap straight away. */
function EffortToggle({ note, day, slot, what }: { note: SlotNoteRow | undefined; day: string; slot: PlanSlot; what: string }) {
  const save = useSaveSlotNote()
  const saved = (note?.effort ?? null) as Effort | null
  const shown = save.isPending && save.variables ? save.variables.effort : saved
  const { icon: Icon, title } = EFFORT[shown ?? 'any']
  return (
    <button
      type="button"
      aria-label={`${title}, ${what}. Tap to change`}
      title={title}
      className={cn(
        'grid size-6 shrink-0 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        shown ? 'bg-primary/10 text-primary' : 'text-muted-foreground/50 hover:text-muted-foreground',
      )}
      onClick={() => save.mutate({ day, slot, note: note?.note ?? '', effort: EFFORT[saved ?? 'any'].next, exists: Boolean(note) }, { onError })}
    >
      <Icon className="size-3.5" />
    </button>
  )
}

/**
 * The next few days, a line each: who is in for lunch and dinner, and what you want for that meal.
 * A day can be added at the foot, or an added one taken off.
 */
function Grid({
  from,
  count,
  onCount,
  people,
  availability,
  notes,
}: {
  from: string
  count: number
  onCount: (days: number) => void
  people: Member[]
  availability: AvailabilityRow[]
  notes: SlotNoteRow[]
}) {
  const save = useSaveSlotNote()
  const days = Array.from({ length: count }, (_, i) => addDaysISO(from, i))
  const cols = 'grid grid-cols-[2.25rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-2'

  return (
    <Card className="p-2">
      <div className={cn(cols, 'pb-1 text-xs font-medium text-muted-foreground')}>
        <span />
        {SLOTS.map((s) => (
          <span key={s.slot} className="px-0.5">{s.label}</span>
        ))}
      </div>
      {days.map((day, i) => {
        const date = parseISODate(day)
        const dayName = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : format(date, 'EEEE')
        return (
          <div key={day} className={cn(cols, 'border-t py-1.5')}>
            <span className={cn('grid text-center leading-tight', i === 0 && 'text-primary')}>
              <span className="text-xs font-semibold">{format(date, 'EEE')}</span>
              <span className="text-[11px] text-muted-foreground tabular-nums">{format(date, 'd')}</span>
            </span>
            {SLOTS.map(({ slot, label }) => {
              const what = `${dayName} ${label.toLowerCase()}`
              const note = notes.find((n) => n.day === day && n.slot === slot)
              return (
                <div key={slot} className="flex min-w-0 items-center gap-1">
                  <div className="flex shrink-0 -space-x-1">
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
                  <EffortToggle note={note} day={day} slot={slot} what={what} />
                  <MealInput
                    value={note?.note ?? ''}
                    label={`What you want, ${what}`}
                    placeholder="Anything?"
                    maxLength={120}
                    className="h-8 min-w-0 px-2 text-sm"
                    onSave={(text) => save.mutate({ day, slot, note: text, effort: (note?.effort ?? null) as Effort | null, exists: Boolean(note) }, { onError })}
                  />
                </div>
              )
            })}
          </div>
        )
      })}
      {count < MAX_PLAN_DAYS || count > PLAN_DAYS ? (
        <div className="flex gap-1 border-t pt-1">
          {count < MAX_PLAN_DAYS ? (
            <Button variant="ghost" size="sm" className="h-7 flex-1 text-muted-foreground" onClick={() => onCount(count + 1)}>
              <Plus /> Add a day
            </Button>
          ) : null}
          {count > PLAN_DAYS ? (
            <Button variant="ghost" size="sm" className="h-7 flex-1 text-muted-foreground" onClick={() => onCount(count - 1)}>
              <Minus /> Remove a day
            </Button>
          ) : null}
        </div>
      ) : null}
      <p className="flex flex-wrap items-center gap-x-3 border-t pt-1.5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Zap className="size-3" aria-hidden /> quick
        </span>
        <span className="flex items-center gap-1">
          <CookingPot className="size-3" aria-hidden /> longer cook
        </span>
      </p>
    </Card>
  )
}

/**
 * Plan, sized to fit a phone screen: what you already have, then a line per
 * day (who is in for lunch and dinner, filled overnight from the calendars, and
 * what you want for each, and quick or a longer cook; days can be added, up to
 * a week), then Plan meals: Claude fills the empty meals and you go to Meals to
 * look them over, swap any, and press Complete for the recipes and list.
 */
export function Plan({
  from,
  days,
  onDays,
  pantry,
  availability,
  notes,
  busy,
  onPlan,
}: {
  from: string
  /** How many days to plan (PLAN_DAYS unless some were added). */
  days: number
  onDays: (days: number) => void
  pantry: PantryRow[]
  availability: AvailabilityRow[]
  notes: SlotNoteRow[]
  /** What is happening now ("Planning meals…"), or null. */
  busy: string | null
  onPlan: () => void
}) {
  const { me, partner } = useHousehold()
  const people = partner ? [me, partner] : [me]
  return (
    <div className="grid gap-2 md:max-w-xl">
      <Have pantry={pantry} />
      <Grid from={from} count={days} onCount={onDays} people={people} availability={availability} notes={notes} />
      <Button onClick={onPlan} disabled={Boolean(busy)} className="w-full">
        <Sparkles /> {busy ?? 'Plan meals'}
      </Button>
    </div>
  )
}
