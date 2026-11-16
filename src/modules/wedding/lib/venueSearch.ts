/**
 * "Find more" on the Venues card: a wedding job for the morning Claude routine,
 * which treats any wedding job with "venues" in its title as venue hunting and
 * adds what it finds to the list. The area is in the title, so it needn't ask.
 */
export const VENUE_SEARCH_PREFIX = 'Find wedding venues in '
export const MAX_AREA_CHARS = 60

export function venueSearchTitle(area: string): string | null {
  const a = area.replace(/\s+/g, ' ').trim()
  return a && a.length <= MAX_AREA_CHARS ? `${VENUE_SEARCH_PREFIX}${a}` : null
}

/** Areas asked for that Claude hasn't searched yet (open jobs with no result). */
export function waitingAreas(tasks: { title: string; done: boolean; ai_result: unknown }[]): string[] {
  return tasks.filter((t) => !t.done && !t.ai_result && t.title.startsWith(VENUE_SEARCH_PREFIX)).map((t) => t.title.slice(VENUE_SEARCH_PREFIX.length))
}
