import { addMonths, addWeeks, format, isSameMonth, parseISO, startOfMonth } from 'date-fns'
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, MapPin, Settings } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState, ErrorState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Segmented, Skeleton } from '@/components/ui/misc'
import { colorOf } from '@/lib/colors'
import { addDaysISO, formatDay, type ISODate, todayISO, toISODate } from '@/lib/dates'
import { cn, groupBy } from '@/lib/utils'
import type { OccurrenceWithTask } from '@/modules/tasks/api'
import { useOpenOccurrences } from '@/modules/tasks/hooks'
import { useCalendarEvents, useCalendarIntegrations } from './api'
import { bucketByDay, type CalendarEvent, formatEventTime, monthGrid, plainText, weekDays } from './lib/grid'

type View = 'month' | 'week' | 'agenda'

export default function CalendarPage() {
  const [view, setView] = useState<View>('week')
  const [cursor, setCursor] = useState(todayISO())
  const [selected, setSelected] = useState<CalendarEvent | null>(null)
  const integrations = useCalendarIntegrations()
  const embed = integrations.data?.find((i) => i.enabled && i.mode === 'embed')
  const connected = integrations.data?.some((i) => i.enabled && i.mode === 'service_account')

  const range = useMemo(() => {
    if (view === 'month') {
      const grid = monthGrid(toISODate(startOfMonth(parseISO(cursor))))
      return { from: grid[0][0], to: grid.at(-1)!.at(-1)! }
    }
    if (view === 'week') {
      const days = weekDays(cursor)
      return { from: days[0], to: days[6] }
    }
    return { from: cursor, to: addDaysISO(cursor, 41) }
  }, [view, cursor])

  const events = useCalendarEvents(range.from, range.to, Boolean(connected))
  const tasks = useOpenOccurrences()
  const tasksByDay = useMemo(
    () => groupBy((tasks.data ?? []).filter((o) => o.due_date && o.due_date >= range.from && o.due_date <= range.to), (o) => o.due_date!),
    [tasks.data, range],
  )
  const eventList = events.data?.status === 'ok' ? events.data.events : []
  const byDay = useMemo(() => bucketByDay(eventList), [eventList])

  const step = (dir: 1 | -1) =>
    setCursor((c) =>
      view === 'month'
        ? toISODate(addMonths(parseISO(c), dir))
        : view === 'week'
          ? toISODate(addWeeks(parseISO(c), dir))
          : addDaysISO(c, dir * 42),
    )
  const title =
    view === 'month'
      ? format(parseISO(cursor), 'MMMM yyyy')
      : `${format(parseISO(range.from), 'd MMM')} – ${format(parseISO(range.to), 'd MMM yyyy')}`

  return (
    <>
      <PageHeader title="Calendar" description="Your shared Google Calendar, with task due dates alongside." />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Previous" onClick={() => step(-1)}><ChevronLeft /></Button>
          <Button variant="outline" size="sm" onClick={() => setCursor(todayISO())}>Today</Button>
          <Button variant="ghost" size="icon-sm" aria-label="Next" onClick={() => step(1)}><ChevronRight /></Button>
          <h2 className="ml-2 font-semibold">{title}</h2>
        </div>
        <Segmented aria-label="View" size="sm" value={view} onChange={setView} options={[{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }, { value: 'agenda', label: 'Agenda' }]} />
      </div>

      <CalendarStatus integrationsPending={integrations.isPending} connected={Boolean(connected)} embedUrl={embed?.embed_url ?? null} result={events.data} pending={events.isPending && Boolean(connected)} error={events.error} retry={() => events.refetch()} />

      {view === 'month' ? (
        <MonthView month={cursor} byDay={byDay} tasksByDay={tasksByDay} onSelect={setSelected} />
      ) : view === 'week' ? (
        <WeekView days={weekDays(cursor)} byDay={byDay} tasksByDay={tasksByDay} onSelect={setSelected} />
      ) : (
        <AgendaView from={range.from} to={range.to} byDay={byDay} tasksByDay={tasksByDay} onSelect={setSelected} />
      )}

      <EventDialog event={selected} onClose={() => setSelected(null)} />
    </>
  )
}

function CalendarStatus({
  integrationsPending,
  connected,
  embedUrl,
  result,
  pending,
  error,
  retry,
}: {
  integrationsPending: boolean
  connected: boolean
  embedUrl: string | null
  result: ReturnType<typeof useCalendarEvents>['data']
  pending: boolean
  error: unknown
  retry: () => void
}) {
  if (integrationsPending) return null
  if (!connected) {
    return (
      <Card className="mb-4">
        {embedUrl ? (
          <div className="p-2">
            <p className="px-2 pb-2 text-xs text-muted-foreground">
              Showing Google's embedded view. It only displays if this browser is signed in to a Google account that can see the calendar.
            </p>
            <iframe title="Google Calendar" src={embedUrl} className="h-[70dvh] w-full rounded-lg border-0 bg-white" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer" />
          </div>
        ) : (
          <EmptyState
            icon={CalendarDays}
            title="Google Calendar isn't connected yet"
            description="Task due dates still appear below. Connect your shared calendar in Settings."
            action={<Button variant="outline" size="sm" asChild><Link to="/settings#calendar"><Settings /> Calendar settings</Link></Button>}
          />
        )}
      </Card>
    )
  }
  if (pending) return <Skeleton className="mb-4 h-1 w-full" />
  if (error) return <Card className="mb-4"><ErrorState error={error} onRetry={retry} /></Card>
  if (result && result.status !== 'ok') {
    return (
      <Card className={cn('mb-4 flex items-center justify-between gap-3 p-4 text-sm', result.status === 'error' && 'border-destructive/30')}>
        <span className="text-muted-foreground">{result.status === 'not_configured' ? 'Calendar unavailable: ' : 'Calendar error: '}{result.message}</span>
        <Button variant="outline" size="sm" onClick={retry}>Retry</Button>
      </Card>
    )
  }
  return null
}

type DayProps = {
  byDay: Map<ISODate, CalendarEvent[]>
  tasksByDay: Record<string, OccurrenceWithTask[]>
  onSelect: (e: CalendarEvent) => void
}

function EventChip({ event, day, onSelect, compact }: { event: CalendarEvent; day: ISODate; onSelect: (e: CalendarEvent) => void; compact?: boolean }) {
  const c = colorOf(event.color)
  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      className={cn('flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-xs hover:brightness-95', event.allDay ? cn(c.soft, c.text, 'py-0.5 font-medium') : 'py-0.5 hover:bg-muted')}
    >
      {!event.allDay ? <span className={cn('size-1.5 shrink-0 rounded-full', c.dot)} /> : null}
      {!event.allDay && !compact ? <span className="shrink-0 text-muted-foreground tabular">{formatEventTime(event, day).split('–')[0]}</span> : null}
      <span className="truncate">{event.title}</span>
    </button>
  )
}

function TaskChip({ occ }: { occ: OccurrenceWithTask }) {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate(`/tasks?task=${occ.task_id}`)} className="flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-xs text-muted-foreground hover:bg-muted">
      <CheckCircle2 className="size-3 shrink-0" />
      <span className="truncate">{occ.task.title}</span>
    </button>
  )
}

function MonthView({ month, byDay, tasksByDay, onSelect }: DayProps & { month: ISODate }) {
  const grid = monthGrid(toISODate(startOfMonth(parseISO(month))))
  const today = todayISO()
  const monthDate = parseISO(month)
  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-7 border-b text-center text-xs font-medium text-muted-foreground">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="py-2">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {grid.flat().map((day) => {
          const events = byDay.get(day) ?? []
          const tasks = tasksByDay[day] ?? []
          const items = events.length + tasks.length
          return (
            <div key={day} className={cn('min-h-20 border-b border-r p-1 sm:min-h-28 [&:nth-child(7n)]:border-r-0', !isSameMonth(parseISO(day), monthDate) && 'bg-muted/40 text-muted-foreground')}>
              <div className={cn('mb-0.5 grid size-6 place-items-center rounded-full text-xs tabular', day === today && 'bg-primary font-semibold text-primary-foreground')}>{Number(day.slice(8))}</div>
              <div className="hidden gap-0.5 sm:grid">
                {events.slice(0, 3).map((e) => <EventChip key={e.id} event={e} day={day} onSelect={onSelect} compact />)}
                {tasks.slice(0, Math.max(0, 3 - events.length)).map((o) => <TaskChip key={o.id} occ={o} />)}
                {items > 3 ? <span className="px-1.5 text-[11px] text-muted-foreground">+{items - 3} more</span> : null}
              </div>
              {/* Phones: dots only; the agenda view carries the detail. */}
              <div className="flex flex-wrap gap-0.5 px-1 sm:hidden">
                {events.slice(0, 4).map((e) => <span key={e.id} className={cn('size-1.5 rounded-full', colorOf(e.color).dot)} />)}
                {tasks.length ? <span className="size-1.5 rounded-full bg-muted-foreground/50" /> : null}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function WeekView({ days, byDay, tasksByDay, onSelect }: DayProps & { days: ISODate[] }) {
  const today = todayISO()
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-7">
      {days.map((day) => {
        const events = byDay.get(day) ?? []
        const tasks = tasksByDay[day] ?? []
        return (
          <Card key={day} className={cn('min-h-32 p-2', day === today && 'border-primary/50')}>
            <p className={cn('mb-1.5 px-1 text-xs font-semibold', day === today ? 'text-primary' : 'text-muted-foreground')}>{format(parseISO(day), 'EEE d')}</p>
            <div className="grid gap-0.5">
              {events.map((e) => <EventChip key={e.id} event={e} day={day} onSelect={onSelect} />)}
              {tasks.map((o) => <TaskChip key={o.id} occ={o} />)}
              {!events.length && !tasks.length ? <p className="px-1 text-xs text-muted-foreground/60">Nothing planned</p> : null}
            </div>
          </Card>
        )
      })}
    </div>
  )
}

function AgendaView({ from, to, byDay, tasksByDay, onSelect }: DayProps & { from: ISODate; to: ISODate }) {
  const days: ISODate[] = []
  for (let d = from; d <= to; d = addDaysISO(d, 1)) if (byDay.get(d)?.length || tasksByDay[d]?.length) days.push(d)
  if (!days.length) return <Card><EmptyState icon={CalendarDays} title="Nothing coming up" description="No events or task due dates in the next six weeks." /></Card>
  return (
    <Card className="divide-y">
      {days.map((day) => (
        <section key={day} className="grid gap-1 p-3 sm:grid-cols-[8rem_1fr] sm:gap-4">
          <h3 className="text-sm font-semibold">{formatDay(day)}</h3>
          <div className="grid gap-1">
            {(byDay.get(day) ?? []).map((e) => (
              <button key={e.id} type="button" onClick={() => onSelect(e)} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted">
                <span className={cn('h-8 w-1 shrink-0 rounded-full', colorOf(e.color).dot)} />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{e.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{formatEventTime(e, day)}{e.location ? ` · ${e.location}` : ''}</span>
                </span>
              </button>
            ))}
            {(tasksByDay[day] ?? []).map((o) => <TaskChip key={o.id} occ={o} />)}
          </div>
        </section>
      ))}
    </Card>
  )
}

function EventDialog({ event, onClose }: { event: CalendarEvent | null; onClose: () => void }) {
  const description = plainText(event?.description ?? null)
  const when = event
    ? event.allDay
      ? (() => {
          const last = addDaysISO(event.end.slice(0, 10), -1)
          return last === event.start ? `${formatDay(event.start)} · All day` : `${formatDay(event.start)} – ${formatDay(last)} · All day`
        })()
      : `${format(new Date(event.start), 'EEE d MMM, HH:mm')} – ${format(new Date(event.end), toISODate(new Date(event.start)) === toISODate(new Date(event.end)) ? 'HH:mm' : 'EEE d MMM, HH:mm')}`
    : ''
  return (
    <Dialog open={Boolean(event)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={event?.title ?? 'Event'} description={when}>
        {event ? (
          <div className="grid gap-3 text-sm">
            {event.location ? <p className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />{event.location}</p> : null}
            {description ? <p className="whitespace-pre-wrap text-muted-foreground">{description}</p> : null}
            <p className="text-xs text-muted-foreground">From {event.calendarName}. Read-only in Life.</p>
            {event.htmlLink ? (
              <Button variant="outline" size="sm" asChild className="justify-self-start">
                <a href={event.htmlLink} target="_blank" rel="noopener noreferrer"><ExternalLink /> Open in Google Calendar</a>
              </Button>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

