import { format, startOfWeek } from 'date-fns'
import { CalendarDays, Check, ChevronLeft, ChevronRight, Plus, Sparkles, Users, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { QueryState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { addDaysISO, parseISODate, todayISO, toISODate } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useCalendarEvents, useCalendarIntegrations } from '@/modules/calendar/api'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import {
  type PlanCell,
  useDeleteExerciseName,
  useExerciseGoals,
  useExerciseNames,
  useExercisePlan,
  useExerciseSessions,
  useSaveDay,
  useSaveExerciseName,
} from '../api'
import { type DayBoxes, type Goal, type Item, type Person, sameActivity, splitActivities, TT_MATCH, TT_TOURNAMENT, weekBoxes } from '../lib/weekPlan'

const onError = (e: unknown) => toast.error(getErrorMessage(e))
type Opening = { box: DayBoxes; person: Person }

/**
 * The exercise week: Monday to Sunday, a column each. Every box is exercise
 * from your calendar, something you set or logged, the coach's suggestion, or
 * Rest. Something you do together is one bar across both columns.
 */
export function ExerciseWeek() {
  const { me, partner } = useHousehold()
  const today = todayISO()
  const [monday, setMonday] = useState(() => toISODate(startOfWeek(new Date(), { weekStartsOn: 1 })))
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(monday, i))
  const plan = useExercisePlan(monday, days[6])
  const goals = useExerciseGoals()
  const names = useExerciseNames()
  const sessions = useExerciseSessions()
  const events = useCalendarEvents(monday, days[6])
  const integrations = useCalendarIntegrations()
  const [opening, setOpening] = useState<Opening | null>(null)

  const people: Person[] = [me, ...(partner ? [partner] : [])].map((m) => {
    const g = goals.data?.find((x) => x.user_id === m.id)
    return { id: m.id, name: m.display_name, goals: (Array.isArray(g?.activities) ? g.activities : []) as Goal[] }
  })
  const owners = new Map((integrations.data ?? []).map((i) => [i.id, i.owner_id]))
  const week = weekBoxes({
    days,
    today,
    people,
    events: events.data?.status === 'ok' ? events.data.events : [],
    owners,
    names: names.data ?? [],
    saved: plan.data ?? [],
    logged: sessions.data ?? [],
  })
  const quick = [...new Set([...people.flatMap((p) => p.goals.map((g) => g.name)), TT_MATCH, TT_TOURNAMENT])]
  const noGoals = goals.data ? people.filter((p) => !p.goals.length) : []
  const cols = people.length === 2 ? 'grid-cols-[2.75rem_1fr_1fr]' : 'grid-cols-[2.75rem_1fr]'

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="icon" aria-label="Week before" onClick={() => setMonday(addDaysISO(monday, -7))}><ChevronLeft /></Button>
        <span className="text-sm font-medium">{format(parseISODate(monday), 'd MMM')} – {format(parseISODate(days[6]), 'd MMM')}</span>
        <Button variant="ghost" size="icon" aria-label="Week after" onClick={() => setMonday(addDaysISO(monday, 7))}><ChevronRight /></Button>
      </div>
      {events.data && events.data.status !== 'ok' ? <p className="text-xs text-muted-foreground">Calendar unavailable: {events.data.message}</p> : null}
      <QueryState query={plan}>
        {() => (
          <Card className="overflow-hidden p-0">
            <div className={cn('grid border-b bg-muted/40 text-xs font-medium text-muted-foreground', cols)}>
              <span />
              {people.map((p) => <span key={p.id} className="truncate px-2 py-2">{p.name}</span>)}
            </div>
            <div className="divide-y">
              {week.map((box) => {
                const isToday = box.day === today
                const ownRow = !box.both.length || people.some((p) => box.people[p.id].length)
                return (
                  <div key={box.day} className={cn('grid', cols, isToday && 'bg-primary/5')}>
                    <span className={cn('row-span-2 px-2 py-2 text-xs font-medium', isToday ? 'text-primary' : 'text-muted-foreground')}>
                      {format(parseISODate(box.day), 'EEE')}
                    </span>
                    {box.both.length ? (
                      <button
                        type="button"
                        className="col-span-2 m-1 rounded-lg border border-primary/30 bg-primary/5 px-2 py-1.5 text-left hover:bg-primary/10"
                        aria-label={`Both, ${format(parseISODate(box.day), 'EEEE')}: ${box.both.map((i) => i.activity).join(', ')}`}
                        onClick={() => setOpening({ box, person: people[0] })}
                      >
                        <Users className="mr-1 inline size-3.5 align-[-2px] text-primary" aria-hidden />
                        <span className="sr-only">Both: </span>
                        <Chips items={box.both} inline />
                      </button>
                    ) : null}
                    {ownRow
                      ? people.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            className="min-h-11 min-w-0 px-2 py-2 text-left text-sm hover:bg-muted/60"
                            aria-label={`${p.name}, ${format(parseISODate(box.day), 'EEEE')}: ${box.people[p.id].map((i) => i.activity).join(', ') || (box.both.length ? 'nothing else' : 'Rest')}`}
                            onClick={() => setOpening({ box, person: p })}
                          >
                            {box.people[p.id].length ? (
                              <Chips items={box.people[p.id]} />
                            ) : box.both.length ? null : (
                              <span className="text-muted-foreground/70">Rest</span>
                            )}
                          </button>
                        ))
                      : null}
                  </div>
                )
              })}
            </div>
          </Card>
        )}
      </QueryState>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span><CalendarDays className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />Calendar</span>
        <span className="font-semibold text-primary">You set</span>
        <span><Check className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />Logged</span>
        <span><Sparkles className="mr-1 inline size-3.5 align-[-2px] text-primary" aria-hidden />Coach suggests</span>
        <span><Users className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />Both</span>
      </p>
      {noGoals.length ? (
        <p className="text-xs text-muted-foreground">
          No weekly goals for {noGoals.map((p) => p.name).join(' or ')}, so the coach has nothing to plan.{' '}
          <Link to="?view=goals" className="font-medium text-primary underline-offset-2 hover:underline">Set them in Goals</Link>
        </p>
      ) : null}
      <CalendarNames people={people} />
      {opening ? (
        <DayDialog
          key={`${opening.box.day}:${opening.person.id}`}
          box={opening.box}
          person={opening.person}
          partner={people.find((p) => p.id !== opening.person.id)}
          saved={plan.data ?? []}
          quick={quick}
          onClose={() => setOpening(null)}
        />
      ) : null}
    </div>
  )
}

function Chips({ items, inline }: { items: Item[]; inline?: boolean }) {
  return (
    <>
      {items.map((i) => (
        <span
          key={`${i.source}:${i.activity}`}
          className={cn(inline ? 'mr-2 inline' : 'block', 'break-words text-sm', i.source === 'you' && 'font-semibold text-primary')}
        >
          {i.source === 'calendar' ? <CalendarDays className="mr-1 inline size-3.5 align-[-2px] text-muted-foreground" aria-hidden /> : null}
          {i.source === 'logged' ? <Check className="mr-1 inline size-3.5 align-[-2px] text-success" aria-hidden /> : null}
          {i.source === 'coach' ? <Sparkles className="mr-1 inline size-3.5 align-[-2px] text-primary" aria-label="Coach suggests" /> : null}
          {i.activity}
          {i.time ? <span className="ml-1 text-xs font-normal text-muted-foreground">{i.time}</span> : null}
          {i.title ? <span className={cn('text-xs font-normal text-muted-foreground', inline ? 'ml-1' : 'block')}>{i.title}</span> : null}
        </span>
      ))}
    </>
  )
}

type Entry = { activity: string; both: boolean }

function DayDialog({
  box,
  person,
  partner,
  saved,
  quick,
  onClose,
}: {
  box: DayBoxes
  person: Person
  partner?: Person
  saved: PlanCell[]
  quick: string[]
  onClose: () => void
}) {
  const saveDay = useSaveDay()
  const saveName = useSaveExerciseName()
  const mineRow = saved.find((s) => s.day === box.day && s.owner_id === person.id)
  const bothRow = saved.find((s) => s.day === box.day && s.owner_id === null)
  // Fixed: from the calendar or logged. Editable: what you set, or the coach's suggestion if you haven't.
  const fixed = [...box.both.map((i) => ({ ...i, both: true })), ...box.people[person.id].map((i) => ({ ...i, both: false }))].filter(
    (i) => i.source === 'calendar' || i.source === 'logged',
  )
  const [entries, setEntries] = useState<Entry[]>(() => [
    ...(bothRow ? splitActivities(bothRow.activity) : box.both.filter((i) => i.source === 'coach').map((i) => i.activity)).map((a) => ({ activity: a, both: true })),
    ...(mineRow ? splitActivities(mineRow.activity) : box.people[person.id].filter((i) => i.source === 'coach').map((i) => i.activity)).map((a) => ({
      activity: a,
      both: false,
    })),
  ])
  const [typed, setTyped] = useState('')
  const [teaching, setTeaching] = useState<string | null>(null)
  const has = (x: string) => entries.some((e) => sameActivity(e.activity, x))
  const add = (x: string) => {
    const v = x.trim().replace(/,/g, ' ').slice(0, 60)
    if (v && !has(v)) setEntries([...entries, { activity: v, both: false }])
  }
  const remove = (x: string) => setEntries(entries.filter((e) => e.activity !== x))
  const toggleBoth = (x: string) => setEntries(entries.map((e) => (e.activity === x ? { ...e, both: !e.both } : e)))
  const all = typed.trim() && !has(typed.trim()) ? [...entries, { activity: typed.trim().replace(/,/g, ' '), both: false }] : entries
  const mine = all.filter((e) => !e.both).map((e) => e.activity).join(', ')
  const both = all.filter((e) => e.both).map((e) => e.activity).join(', ')
  const tooLong = mine.length > 200 || both.length > 200
  const unknown = box.unknown.filter((u) => u.owner === null || u.owner === person.id)
  const notExercise = (title: string, owner: string | null) => saveName.mutate({ owner_id: owner, phrase: title, activity: null }, { onError })

  const save = (rest: boolean) =>
    saveDay.mutate(
      {
        day: box.day,
        person: person.id,
        mine: { id: mineRow?.id, activity: rest ? null : mine || null },
        // Rest is just your own box: something you share stays.
        both: rest ? undefined : both ? { id: bothRow?.id, activity: both } : { id: bothRow?.id, activity: null, remove: true },
      },
      { onSuccess: onClose, onError },
    )

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent title={`${person.name}, ${format(parseISODate(box.day), 'EEEE d MMM')}`}>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save(false) }}>
          {fixed.length ? (
            <ul className="grid gap-1.5">
              {fixed.map((i) => (
                <li key={`${i.source}:${i.activity}`} className="flex items-center gap-2 rounded-lg border py-1.5 pl-3 pr-1 text-sm">
                  {i.source === 'calendar' ? <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <Check className="size-4 shrink-0 text-success" aria-hidden />}
                  <span className="min-w-0 flex-1 break-words">
                    {i.activity}
                    {i.both ? <span className="ml-1 text-xs text-muted-foreground">· both</span> : null}
                    {i.title ? <span className="block text-xs text-muted-foreground">{i.title}</span> : null}
                  </span>
                  {i.source === 'calendar' ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={saveName.isPending}
                      onClick={() => notExercise(i.title ?? i.activity, i.both ? null : person.id)}
                    >
                      Not exercise
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {entries.length ? (
            <ul className="grid gap-1.5">
              {entries.map((e) => (
                <li key={e.activity} className="flex items-center gap-1 rounded-lg border bg-primary/5 py-1 pl-3 pr-1 text-sm font-medium">
                  <span className="min-w-0 flex-1 break-words">{e.activity}</span>
                  {partner ? (
                    <Button
                      type="button"
                      size="sm"
                      variant={e.both ? 'default' : 'outline'}
                      aria-pressed={e.both}
                      aria-label={`${e.activity} with ${partner.name}`}
                      onClick={() => toggleBoth(e.activity)}
                    >
                      <Users /> Both
                    </Button>
                  ) : null}
                  <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" aria-label={`Take off ${e.activity}`} onClick={() => remove(e.activity)}><X /></Button>
                </li>
              ))}
            </ul>
          ) : !fixed.length ? (
            <p className="text-sm text-muted-foreground">Rest</p>
          ) : null}

          <div className="flex gap-2">
            <Input
              aria-label="Add exercise"
              placeholder="Add exercise…"
              maxLength={60}
              className="min-w-0 flex-1"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(typed); setTyped('') } }}
            />
            <Button type="button" variant="outline" size="icon" className="size-10 shrink-0" aria-label="Add" disabled={!typed.trim()} onClick={() => { add(typed); setTyped('') }}><Plus /></Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {quick.map((x) => (
              <Button key={x} type="button" size="sm" variant={has(x) ? 'default' : 'outline'} aria-pressed={has(x)} onClick={() => (has(x) ? remove(entries.find((e) => sameActivity(e.activity, x))!.activity) : add(x))}>{x}</Button>
            ))}
          </div>

          {unknown.length ? (
            <div className="grid gap-1.5 border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground">Also in the calendar</p>
              {unknown.map((u) =>
                teaching === u.title ? (
                  <TeachName key={u.title} title={u.title} owner={u.owner} quick={quick} onDone={() => setTeaching(null)} />
                ) : (
                  <div key={u.title} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 break-words">{u.title}</span>
                    <Button type="button" size="sm" variant="outline" onClick={() => setTeaching(u.title)}>It's exercise</Button>
                  </div>
                ),
              )}
            </div>
          ) : null}

          {tooLong ? <p className="text-sm text-destructive">That's too much for one day.</p> : null}
          <DialogFooter>
            <Button variant="ghost" type="button" className="sm:mr-auto" disabled={saveDay.isPending} onClick={() => save(true)}>Rest</Button>
            <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saveDay.isPending || tooLong}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Teach a calendar name: this title (or the part you keep) always means this exercise. */
function TeachName({ title, owner, quick, onDone }: { title: string; owner: string | null; quick: string[]; onDone: () => void }) {
  const save = useSaveExerciseName()
  const [phrase, setPhrase] = useState(title)
  const [activity, setActivity] = useState('')
  const submit = (a: string) =>
    phrase.trim() && a.trim() && save.mutate({ owner_id: owner, phrase, activity: a }, { onSuccess: onDone, onError })

  return (
    <div className="grid gap-2 rounded-lg border p-2">
      <Input aria-label="Calendar name" maxLength={60} value={phrase} onChange={(e) => setPhrase(e.target.value)} />
      <p className="text-xs text-muted-foreground">Any entry with this in its name will count. Keep just the part that's always there (e.g. "Crusaders").</p>
      <div className="flex flex-wrap gap-2">
        {quick.map((x) => <Button key={x} type="button" size="sm" variant="outline" disabled={save.isPending} onClick={() => submit(x)}>{x}</Button>)}
      </div>
      <div className="flex gap-2">
        <Input aria-label="Exercise it is" placeholder="Or type what it is…" maxLength={40} className="min-w-0 flex-1" value={activity} onChange={(e) => setActivity(e.target.value)} />
        <Button type="button" size="sm" disabled={save.isPending || !activity.trim()} onClick={() => submit(activity)}>Save</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  )
}

/** The calendar names the coach knows, each removable. */
function CalendarNames({ people }: { people: Person[] }) {
  const names = useExerciseNames()
  const del = useDeleteExerciseName()
  if (!names.data?.length) return null
  const whose = (id: string | null) => (id ? people.find((p) => p.id === id)?.name ?? '' : 'Anyone')
  return (
    <details className="rounded-xl border bg-card px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium">Calendar names ({names.data.length})</summary>
      <ul className="mt-2 divide-y">
        {names.data.map((n) => (
          <li key={n.id} className="flex items-center gap-2 py-1.5">
            <span className="min-w-0 flex-1 break-words">
              {n.phrase} <span className="text-muted-foreground">→ {n.activity ?? 'Not exercise'}</span>
              <span className="block text-xs text-muted-foreground">{whose(n.owner_id)}</span>
            </span>
            <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Forget ${n.phrase}`} disabled={del.isPending} onClick={() => del.mutate(n.id, { onError })}><X /></Button>
          </li>
        ))}
      </ul>
    </details>
  )
}
