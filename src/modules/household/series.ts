import { chartColor } from '@/lib/colors'
import { useHousehold } from './HouseholdProvider'

/** Each member always gets the same chart colour (colour follows the person, not their rank). */
export function usePersonSeries() {
  const { members } = useHousehold()
  return members.map((m, i) => ({ key: m.id, label: m.display_name, color: chartColor(i) }))
}
