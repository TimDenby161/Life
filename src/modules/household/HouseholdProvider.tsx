import { useQuery } from '@tanstack/react-query'
import { createContext, useContext, useMemo } from 'react'
import { supabase, type Tables } from '@/lib/supabase'
import { unwrap } from '@/lib/utils'
import { useUserId } from '@/modules/auth/AuthProvider'

export type Member = Tables<'profiles'> & { role: string }
export type Household = Tables<'households'>

type HouseholdContextValue = {
  household: Household
  members: Member[]
  me: Member
  /** The other member (Tim <-> Sophie). Undefined in a one-person household. */
  partner: Member | undefined
  member: (id: string | null | undefined) => Member | undefined
}

const HouseholdContext = createContext<HouseholdContextValue | null>(null)

export const householdKeys = { all: ['household'] as const }

async function fetchHousehold() {
  const rows = unwrap(
    await supabase
      .from('household_members')
      .select('role, household:households(*), profile:profiles(*)')
      .order('joined_at')
      // Fail visibly (with Retry) rather than leaving the splash up forever.
      .abortSignal(AbortSignal.timeout(15_000)),
  )
  if (rows.length === 0) return null
  const household = rows[0].household
  if (!household) return null
  const members = rows.flatMap((r) => (r.profile ? [{ ...r.profile, role: r.role }] : []))
  return { household, members }
}

export function useHouseholdQuery() {
  return useQuery({ queryKey: householdKeys.all, queryFn: fetchHousehold, staleTime: 5 * 60_000 })
}

export function HouseholdProvider({
  data,
  children,
}: {
  data: { household: Household; members: Member[] }
  children: React.ReactNode
}) {
  const userId = useUserId()
  const value = useMemo<HouseholdContextValue>(() => {
    const byId = new Map(data.members.map((m) => [m.id, m]))
    const me = byId.get(userId)
    if (!me) throw new Error('Signed-in user is not a member of this household')
    return {
      household: data.household,
      members: data.members,
      me,
      partner: data.members.find((m) => m.id !== userId),
      member: (id) => (id ? byId.get(id) : undefined),
    }
  }, [data, userId])
  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>
}

export function useHousehold() {
  const ctx = useContext(HouseholdContext)
  if (!ctx) throw new Error('useHousehold must be used inside HouseholdProvider')
  return ctx
}
