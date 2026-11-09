import { useEffect, useState } from 'react'
import { ListSkeleton } from '@/components/states'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { colorOf } from '@/lib/colors'
import { todayISO, todayLabel } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { type CalendarIntegration, useCalendarEvents, useCalendarIntegrations } from '@/modules/calendar/api'
import type { CalendarEvent } from '@/modules/calendar/lib/grid'
import { useHousehold } from '@/modules/household/HouseholdProvider'

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

/**
 * What's left of today in my calendar: my calendars and shared ones that the
 * agents plan around (so not Birthdays), live, without anything already over.
 */
export function upcomingToday(events: CalendarEvent[], integrations: CalendarIntegration[], me: string, now: Date): CalendarEvent[] {
  const mine = new Set(integrations.filter((i) => i.use_for_agents && (i.owner_id === null || i.owner_id === me)).map((i) => i.id))
  const today = todayISO(now)
  return events
    .filter((e) => mine.has(e.calendarId) && (e.allDay ? e.start <= today && today < e.end : new Date(e.end) > now))
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start))
}

export function TodayCalendar({ max, compact = false }: { max?: number; compact?: boolean }) {
  const { me } = useHousehold()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  const today = todayISO(now)
  const integrations = useCalendarIntegrations()
  const events = useCalendarEvents(today, today)
  const result = events.data
  const items = result?.status === 'ok' ? upcomingToday(result.events.filter((e) => !e.hidden), integrations.data ?? [], me.id, now) : []

  return (
    <Card>
      <CardHeader className={compact ? 'p-3 pb-1 sm:p-3 sm:pb-1' : undefined}><CardTitle>{todayLabel(now)}</CardTitle></CardHeader>
      <CardContent className={compact ? 'p-3 pt-1 sm:p-3 sm:pt-1' : undefined}>
        {events.isPending || integrations.isPending ? (
          <ListSkeleton rows={compact ? 2 : 3} />
        ) : result && result.status !== 'ok' ? (
          <p className="text-sm text-muted-foreground">{result.message}</p>
        ) : items.length ? (
          <ul className={cn('grid text-sm', compact ? 'gap-1' : 'gap-1.5')}>
            {items.slice(0, max).map((e) => (
              <li key={e.id} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-muted-foreground tabular">{e.allDay ? 'All day' : `${hhmm(e.start)}–${hhmm(e.end)}`}</span>
                <span className={cn('size-2 shrink-0 rounded-full', colorOf(e.color).dot)} />
                <span className="truncate">{e.title}</span>
              </li>
            ))}
            {max && items.length > max ? <li className="text-xs text-muted-foreground">+{items.length - max} more later</li> : null}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing else in your calendar today.</p>
        )}
      </CardContent>
    </Card>
  )
}
