import { format } from 'date-fns'
import { Coffee, type LucideIcon, Merge, Sandwich, Split, Utensils } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { parseISODate, todayISO } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { type Member, useHousehold } from '@/modules/household/HouseholdProvider'
import { isSplit, type Slot, type SlotPlan, SLOTS } from '../../../../supabase/functions/_shared/meals.ts'
import { useMergeSlot, useSaveMeal, useSplitSlot } from '../api'

const SLOT: Record<Slot, { label: string; icon: LucideIcon }> = {
  breakfast: { label: 'Breakfast', icon: Coffee },
  lunch: { label: 'Lunch', icon: Sandwich },
  dinner: { label: 'Dinner', icon: Utensils },
}

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim()

/** A meal you type straight into. Saves when you leave it or press Enter; emptying it clears the meal. */
export function MealInput({
  value,
  label,
  placeholder,
  onSave,
  list = 'meal-names',
  maxLength = 80,
  className,
}: {
  value: string
  label: string
  placeholder: string
  onSave: (name: string) => void
  list?: string
  maxLength?: number
  className?: string
}) {
  const [text, setText] = useState(value)
  const [seen, setSeen] = useState(value)
  const [focused, setFocused] = useState(false)
  // The other person changed it: show theirs, unless you are in the middle of typing.
  if (value !== seen) {
    setSeen(value)
    if (!focused) setText(value)
  }
  return (
    <Input
      aria-label={label}
      placeholder={placeholder}
      list={list || undefined}
      maxLength={maxLength}
      autoComplete="off"
      enterKeyHint="done"
      className={cn('h-9', className)}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        if (tidy(text) !== value) onSave(text)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
    />
  )
}

function SlotRow({ plan, dayName, people, split, onSplit }: { plan: SlotPlan; dayName: string; people: Member[]; split: boolean; onSplit: (open: boolean) => void }) {
  const { me } = useHousehold()
  const save = useSaveMeal()
  const splitSlot = useSplitSlot()
  const merge = useMergeSlot()
  const onError = (e: unknown) => toast.error(getErrorMessage(e))
  const { label, icon: Icon } = SLOT[plan.slot]
  const what = `${dayName} ${label.toLowerCase()}`

  return (
    <li className="flex items-start gap-1.5">
      <Icon className="mt-2 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      {split ? (
        <div className="grid min-w-0 flex-1 gap-1">
          {people.map((p) => {
            const row = plan.personal.find((r) => r.person_id === p.id)
            return (
              <div key={p.id} className="flex items-center gap-2">
                <Avatar name={p.display_name} color={p.avatar_color} size="xs" />
                <MealInput
                  value={row?.name ?? ''}
                  label={`${what}, ${p.display_name}`}
                  placeholder={label}
                  className="h-8 px-2 text-sm"
                  onSave={(name) => save.mutate({ id: row?.id, day: plan.day, slot: plan.slot, person_id: p.id, name }, { onError })}
                />
              </div>
            )
          })}
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          <MealInput
            value={plan.shared?.name ?? ''}
            label={what}
            placeholder={label}
            className="h-8 px-2 text-sm"
            onSave={(name) => save.mutate({ id: plan.shared?.id, day: plan.day, slot: plan.slot, person_id: null, name }, { onError })}
          />
        </div>
      )}
      {people.length > 1 ? (
        <Button
          size="icon-sm"
          variant="ghost"
          className="size-8 text-muted-foreground"
          disabled={splitSlot.isPending || merge.isPending}
          aria-label={split ? `One meal for both, ${what}` : `A meal each, ${what}`}
          title={split ? 'One meal for both' : 'A meal each'}
          onClick={() => {
            onSplit(!split)
            if (split && isSplit(plan)) merge.mutate({ plan, keep: me.id }, { onError })
            else if (!split && plan.shared) splitSlot.mutate({ plan, people: people.map((p) => p.id) }, { onError })
          }}
        >
          {split ? <Merge /> : <Split />}
        </Button>
      ) : null}
    </li>
  )
}

/** The week's 21 slots, a line per day in one card, kept tight so more of the week fits on a phone. Any slot can be split into a meal each. */
export function WeekMeals({ plans }: { plans: SlotPlan[] }) {
  const { me, partner } = useHousehold()
  const people = partner ? [me, partner] : [me]
  // Slots opened for a meal each that have nothing typed in them yet.
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  const today = todayISO()
  const days = Array.from({ length: plans.length / SLOTS.length }, (_, i) => plans.slice(i * SLOTS.length, (i + 1) * SLOTS.length))

  return (
    <Card className="p-2 md:max-w-xl">
      {days.map((slots) => {
        const day = slots[0].day
        const date = parseISODate(day)
        return (
          <section key={day} className="flex gap-2 border-t py-1.5 first:border-t-0 first:pt-0 last:pb-0">
            <h2 className={cn('grid w-9 shrink-0 content-start pt-1 text-center leading-tight', day === today && 'text-primary')}>
              <span className="text-xs font-semibold">{format(date, 'EEE')}</span>
              <span className="text-[11px] font-normal text-muted-foreground tabular-nums">{format(date, 'd')}</span>
            </h2>
            <ul className="grid min-w-0 flex-1 gap-1">
              {slots.map((plan) => {
                const key = `${plan.day}|${plan.slot}`
                return (
                  <SlotRow
                    key={key}
                    plan={plan}
                    dayName={format(date, 'EEEE')}
                    people={people}
                    split={isSplit(plan) || open.has(key)}
                    onSplit={(on) =>
                      setOpen((s) => {
                        const next = new Set(s)
                        if (on) next.add(key)
                        else next.delete(key)
                        return next
                      })
                    }
                  />
                )
              })}
            </ul>
          </section>
        )
      })}
    </Card>
  )
}
