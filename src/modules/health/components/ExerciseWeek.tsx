import { format, startOfWeek } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
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
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { type PlanCell, useExerciseGoals, useExercisePlan, useSaveDraft, useSetPlanCell } from '../api'
import { draftWeek, type Goal, joinDay } from '../lib/weekPlan'

const onError = (e: unknown) => toast.error(getErrorMessage(e))
type Column = { owner: string | null; label: string }
type Editing = { day: string; column: Column; cell?: PlanCell }

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

  // Draft once per empty week, from this week on.
  const drafted = useRef(new Set<string>())
  useEffect(() => {
    if (!plan.data || !goals.data || plan.data.length || days[6] < today || drafted.current.has(monday)) return
    drafted.current.add(monday)
    const people = goals.data
      .filter((g) => columns.some((c) => c.owner === g.user_id))
      .map((g) => ({ id: g.user_id, goals: (Array.isArray(g.activities) ? g.activities : []) as Goal[] }))
    const cells = joinDay(draftWeek(people))
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
                      const cell = cellFor(day, c.owner)
                      return (
                        <td key={c.label} className="p-0">
                          <button
                            type="button"
                            className="block min-h-11 w-full break-words px-2 py-2 text-left hover:bg-muted/60"
                            aria-label={`${c.label}, ${format(parseISODate(day), 'EEEE')}: ${cell?.activity ?? 'nothing'}`}
                            onClick={() => setEditing({ day, column: c, cell })}
                          >
                            {cell?.activity ?? <span className="text-muted-foreground/50">–</span>}
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
      {editing ? <CellDialog editing={editing} suggestions={suggestions} onClose={() => setEditing(null)} /> : null}
    </div>
  )
}

function CellDialog({ editing, suggestions, onClose }: { editing: Editing; suggestions: string[]; onClose: () => void }) {
  const set = useSetPlanCell()
  const [activity, setActivity] = useState(editing.cell?.activity ?? '')
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
