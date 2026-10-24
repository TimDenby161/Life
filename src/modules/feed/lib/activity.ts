// Groups automatic activity so the feed stays calm: consecutive events of the
// same type by the same person within a time window collapse into one entry.
export type ActivityEvent = {
  id: string
  actor_id: string | null
  event_type: string
  summary: string
  created_at: string
}

export type ActivityGroup = { key: string; actorId: string | null; eventType: string; events: ActivityEvent[]; latestAt: string }

export function groupActivity(events: readonly ActivityEvent[], windowMinutes = 90): ActivityGroup[] {
  const sorted = [...events].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const groups: ActivityGroup[] = []
  for (const e of sorted) {
    const last = groups.at(-1)
    const oldest = last?.events.at(-1)
    if (
      last &&
      oldest &&
      last.actorId === e.actor_id &&
      last.eventType === e.event_type &&
      Date.parse(oldest.created_at) - Date.parse(e.created_at) <= windowMinutes * 60_000
    ) {
      last.events.push(e)
    } else {
      groups.push({ key: e.id, actorId: e.actor_id, eventType: e.event_type, events: [e], latestAt: e.created_at })
    }
  }
  return groups
}

const VERBS: Record<string, [string, string]> = {
  'task.completed': ['completed', 'tasks'],
  'task.created': ['added', 'tasks'],
}

export function groupSummary(group: ActivityGroup, actorName: string): string {
  if (group.events.length === 1) return group.events[0].summary
  const [verb, noun] = VERBS[group.eventType] ?? ['did', 'things']
  return `${actorName} ${verb} ${group.events.length} ${noun}`
}
