import { useQuery } from '@tanstack/react-query'
import { supabase, type Tables } from '@/lib/supabase'
import { unwrap } from '@/lib/utils'
import type { CalendarEvent } from './lib/grid'

export type CalendarIntegration = Tables<'calendar_integrations'>

export type EventsResult =
  | { status: 'ok'; events: CalendarEvent[]; fetchedAt: string }
  | { status: 'not_configured' | 'error'; message: string }

export const calendarKeys = {
  all: ['calendar'] as const,
  integrations: ['calendar', 'integrations'] as const,
  events: (from: string, to: string) => ['calendar', 'events', from, to] as const,
}

export async function fetchIntegrations() {
  return unwrap(await supabase.from('calendar_integrations').select('*').order('created_at'))
}

/** Events come from the calendar-events Edge Function; credentials never reach the browser. */
export async function fetchEvents(timeMin: string, timeMax: string): Promise<EventsResult> {
  const { data, error } = await supabase.functions.invoke<EventsResult>('calendar-events', { body: { timeMin, timeMax } })
  if (error) {
    // Non-2xx responses still carry our JSON body.
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null)
    if (body?.status) return body as EventsResult
    return { status: 'error', message: 'The calendar service could not be reached.' }
  }
  return data ?? { status: 'error', message: 'Empty response' }
}

export function useCalendarIntegrations() {
  return useQuery({ queryKey: calendarKeys.integrations, queryFn: fetchIntegrations, staleTime: 5 * 60_000 })
}

export function useCalendarEvents(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: calendarKeys.events(from, to),
    queryFn: () => fetchEvents(new Date(`${from}T00:00:00`).toISOString(), new Date(`${to}T23:59:59`).toISOString()),
    enabled,
    staleTime: 2 * 60_000,
    refetchInterval: 5 * 60_000,
  })
}
