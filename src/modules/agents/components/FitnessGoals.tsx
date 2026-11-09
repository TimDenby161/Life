import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect } from '@/components/ui/input'
import { getErrorMessage } from '@/lib/errors'
import { type ActivityGoal, type FitnessEvent, parseFitnessGoals } from '../../../../supabase/functions/_shared/agents/fitness.ts'
import type { AgentSchedule } from '../../../../supabase/functions/_shared/agents/registry.ts'
import { type AgentSetting, useSaveAgentSetting } from '../api'

const TIMES = [1, 2, 3, 4, 5, 6, 7]
type Kind = 'goal' | 'max' | 'optional'
const kindOf = (a: ActivityGoal): Kind => (a.max ? 'max' : a.optional ? 'optional' : 'goal')

/** My weekly fitness goals, saved with my Fitness Coach settings (only I can see them). */
export function FitnessGoals({ row }: { row: AgentSetting | undefined }) {
  const save = useSaveAgentSetting()
  const saved = parseFitnessGoals(row?.config)
  const [activeDays, setActiveDays] = useState(saved?.activeDays ?? 0)
  const [activities, setActivities] = useState<ActivityGoal[]>(saved?.activities ?? [])
  const [events, setEvents] = useState<FitnessEvent[]>(saved?.events ?? [])
  const set = (i: number, patch: Partial<ActivityGoal>) => setActivities(activities.map((a, j) => (j === i ? { ...a, ...patch } : a)))
  const setEvent = (i: number, patch: Partial<FitnessEvent>) => setEvents(events.map((e, j) => (j === i ? { ...e, ...patch } : e)))
  const valid = activities.filter((a) => a.name.trim())

  return (
    <form
      className="grid gap-2 rounded-xl border p-3"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate(
          {
            agentId: 'health_coach',
            enabled: row?.enabled ?? true,
            schedule: (row?.schedule ?? 'daily') as AgentSchedule,
            config: {
              activeDays: activeDays || null,
              activities: valid.map((a) => ({ name: a.name.trim(), times: a.times, optional: Boolean(a.optional), max: Boolean(a.max) })),
              events: events.filter((e) => e.name.trim() && e.date).map((e) => ({ name: e.name.trim(), date: e.date })),
            },
          },
          { onSuccess: () => toast.success('Goals saved'), onError: (err) => toast.error(getErrorMessage(err)) },
        )
      }}
    >
      <h4 className="text-sm font-semibold">My weekly goals</h4>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        Active days a week
        <NativeSelect aria-label="Active days a week" className="h-8 w-auto" value={activeDays} onChange={(e) => setActiveDays(Number(e.target.value))}>
          <option value={0}>No goal</option>
          {TIMES.map((n) => <option key={n} value={n}>{n}</option>)}
        </NativeSelect>
      </label>
      <ul className="grid gap-2">
        {activities.map((a, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
            <Input aria-label="Activity" placeholder="e.g. Padel" className="h-8 min-w-32 flex-1" maxLength={40} value={a.name} onChange={(e) => set(i, { name: e.target.value })} />
            <NativeSelect aria-label={`${a.name || 'Activity'} kind`} className="h-8 w-auto" value={kindOf(a)} onChange={(e) => set(i, { max: e.target.value === 'max', optional: e.target.value === 'optional' })}>
              <option value="goal">At least</option>
              <option value="max">At most</option>
              <option value="optional">Optional</option>
            </NativeSelect>
            <NativeSelect aria-label={`${a.name || 'Activity'} times a week`} className="h-8 w-auto" value={a.times} onChange={(e) => set(i, { times: Number(e.target.value) })}>
              {TIMES.map((n) => <option key={n} value={n}>{n}× a week</option>)}
            </NativeSelect>
            <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove" onClick={() => setActivities(activities.filter((_, j) => j !== i))}>
              <X />
            </Button>
          </li>
        ))}
      </ul>
      <h4 className="mt-1 text-sm font-semibold">Tournaments and events</h4>
      <ul className="grid gap-2">
        {events.map((ev, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
            <Input aria-label="Event" placeholder="e.g. County Championships" className="h-8 min-w-32 flex-1" maxLength={60} value={ev.name} onChange={(e) => setEvent(i, { name: e.target.value })} />
            <Input type="date" aria-label={`${ev.name || 'Event'} date`} className="h-8 w-auto" value={ev.date} onChange={(e) => setEvent(i, { date: e.target.value })} />
            <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove event" onClick={() => setEvents(events.filter((_, j) => j !== i))}>
              <X />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="ghost" disabled={activities.length >= 8} onClick={() => setActivities([...activities, { name: '', times: 1 }])}>
          <Plus /> Activity
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={events.length >= 12} onClick={() => setEvents([...events, { name: '', date: '' }])}>
          <Plus /> Event
        </Button>
        <Button type="submit" size="sm" className="ml-auto" disabled={save.isPending}>Save goals</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Sessions count by their words: “Table tennis” also matches TT, “Run” matches jog and parkrun. Optional ones are tracked but never nagged
        about; “at most” is a limit. In the week before an event the coach tapers your training.
      </p>
    </form>
  )
}
