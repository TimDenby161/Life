import { format, startOfWeek } from 'date-fns'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
import { type PlanCell, useExerciseGoals, useExercisePlan, useSaveDraft, useSetPlanCell } from '../api'
import { calendarExercise, draftWeek, type Goal, joinDay } from '../lib/weekPlan'

const onError = (e: unknown) => toast.error(getErrorMessage(e))
type Column = { owner: string | null; label: string }
type Editing = { day: string; column: Column; cell?: PlanCell; current: string | null }

/**
 * The exercise week: Monday to Sunday down the side, each of you and Together
 * across. The coach drafts an empty week from your weekly fitness goals; tap a
 * day to change it, and your change stays.
 */
export function ExerciseWeek() {
  const { me, partner } = useHousehold()
  const today = todayISO()
  const [monday, setMonday] = useState(() => toISODate(startOfWeek(new Date(), { weekStartsOn: 1 })))
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(monday, i))
  const plan = useExercisePlan(monday, days[6])
  const goals = useExerciseGoals()
  const draft = useSaveDraft()
  const [editing, setEditing] = useState<Editing | null>(null)
  const columns: Column[] = [
    { owner: me.id, label: me.display_name },
    ...(partner ? [{ owner: partner.id, label: partner.display_name }] : []),
    ...(partner ? [{ owner: null, label: 'Together' }] : []),
  ]

  // Exercise already in your calendars fills its box (unless you've changed that box).
  const events = useCalendarEvents(monday, days[6])
  const integrations = useCalendarIntegrations()
  const people = columns
    .filter((c) => c.owner)
    .map((c) => {
      const g = goals.data?.find((x) => x.user_id === c.owner)
      return { id: c.owner!, name: c.label, goals: (Array.isArray(g?.activities) ? g.activities : []) as Goal[] }
    })
  const calendarReady = !events.isPending && !integrations.isPending
  const booked =
    events.data?.status === 'ok' && integrations.data
      ? calendarExercise(events.data.events, new Map(integrations.data.map((i) => [i.id, i.owner_id])), people, days)
      : []

  // Draft once per empty week, from this week on, around what's already booked.
  const drafted = useRef(new Set<string>())
  useEffect(() => {
    if (!plan.data || !goals.data || !calendarReady || plan.data.length || days[6] < today || drafted.current.has(monday)) return
    drafted.current.add(monday)
    const cells = joinDay(draftWeek(people.filter((p) => p.goals.length), booked)).filter((c) => !booked.some((b) => b.day === c.day && b.owner === c.owner))
    if (cells.length) draft.mutate(cells.map((c) => ({ day: days[c.day], owner_id: c.owner, activity: c.activity })), { onError })
  })

  const cellFor = (day: string, owner: string | null) => plan.data?.find((c) => c.day === day && c.owner_id === owner)
  const suggestions = [
    ...new Set((goals.data ?? []).flatMap((g) => (Array.isArray(g.activities) ? (g.activities as Goal[]) : []).map((a) => a.name))),
  ]

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="icon" aria-label="Week before" onClick={() => setMonday(addDaysISO(monday, -7))}><ChevronLeft /></Button>
        <span className="text-sm font-medium">{format(parseISODate(monday), 'd MMM')} – {format(parseISODate(days[6]), 'd MMM')}</span>
        <Button variant="ghost" size="icon" aria-label="Week after" onClick={() => setMonday(addDaysISO(monday, 7))}><ChevronRight /></Button>
      </div>
      <QueryState query={plan}>
        {() => (
          <Card className="overflow-hidden p-0">
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <th className="w-14 px-2 py-2 text-left font-medium" />
                  {columns.map((c) => <th key={c.label} className="truncate px-2 py-2 text-left font-medium">{c.label}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y">
                {days.map((day) => (
                  <tr key={day} className={cn(day === today && 'bg-primary/5')}>
                    <th scope="row" className={cn('px-2 py-1 text-left text-xs font-medium', day === today ? 'text-primary' : 'text-muted-foreground')}>
                      {format(parseISODate(day), 'EEE')}
                    </th>
                    {columns.map((c) => {
                      const saved = cellFor(day, c.owner)
                      // Changed by one of you rather than drafted by the coach.
                      const changed = saved && !saved.by_coach
                      const fromCalendar = changed ? undefined : booked.find((b) => days[b.day] === day && b.owner === c.owner)
                      const cell = fromCalendar ? { ...saved, activity: fromCalendar.activity } : saved
                      return (
                        <td key={c.label} className="p-0">
                          <button
                            type="button"
                            className={cn(
                              'block min-h-11 w-full break-words px-2 py-2 text-left hover:bg-muted/60',
                              changed && 'bg-primary/10 font-semibold text-primary hover:bg-primary/15',
                              fromCalendar && 'bg-muted/50',
                            )}
                            aria-label={`${c.label}, ${format(parseISODate(day), 'EEEE')}: ${cell?.activity ?? 'nothing'}`}
                            onClick={() => setEditing({ day, column: c, cell: saved, current: cell?.activity ?? null })}
                          >
                            {fromCalendar ? <CalendarDays className="mr-1 inline size-3.5 align-[-2px] text-muted-foreground" aria-hidden /> : null}
                            {cell?.activity ?? <span className={changed ? 'text-primary' : 'text-muted-foreground/50'}>{changed ? 'Rest' : '–'}</span>}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </QueryState>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="inline-block size-3 rounded-sm bg-primary/20" aria-hidden /> Changed by you
        <CalendarDays className="ml-3 size-3.5" aria-hidden /> From your calendar
      </p>
      {editing ? <CellDialog editing={editing} suggestions={suggestions} onClose={() => setEditing(null)} /> : null}
    </div>
  )
}

function CellDialog({ editing, suggestions, onClose }: { editing: Editing; suggestions: string[]; onClose: () => void }) {
  const set = useSetPlanCell()
  const [activity, setActivity] = useState(editing.current ?? '')
  const save = (value: string | null) =>
    set.mutate({ id: editing.cell?.id, day: editing.day, owner_id: editing.column.owner, activity: value?.trim() || null }, { onSuccess: onClose, onError })

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent title={`${editing.column.label}, ${format(parseISODate(editing.day), 'EEEE d MMM')}`}>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); save(activity) }}>
          <Input aria-label="Exercise" placeholder="Rest" maxLength={60} value={activity} onChange={(e) => setActivity(e.target.value)} />
          {suggestions.length ? (
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <Button key={s} type="button" size="sm" variant="outline" onClick={() => save(s)}>{s}</Button>
              ))}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" type="button" className="sm:mr-auto" disabled={set.isPending} onClick={() => save(null)}>Rest</Button>
            <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={set.isPending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
