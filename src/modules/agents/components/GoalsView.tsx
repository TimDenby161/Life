import { PageHeader } from '@/components/PageHeader'
import { QueryState } from '@/components/states'
import { Card } from '@/components/ui/card'
import { useUserId } from '@/modules/auth/AuthProvider'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { useExerciseGoals } from '@/modules/health/api'
import { parseFitnessGoals } from '../../../../supabase/functions/_shared/agents/fitness.ts'
import { useAgentSettings } from '../api'
import { FitnessGoals } from './FitnessGoals'

/**
 * The Goals tab: your weekly exercise goals, which the Coach week plans from,
 * and your partner's alongside (each of you sets your own).
 */
export default function GoalsView({ kind }: { kind: 'fitness' }) {
  const settings = useAgentSettings()
  const me = useUserId()
  const { partner } = useHousehold()
  const goals = useExerciseGoals()
  const theirs = parseFitnessGoals({ activities: goals.data?.find((g) => g.user_id === partner?.id)?.activities })?.activities ?? []
  if (kind !== 'fitness') return null

  return (
    <div className="grid gap-4">
      <PageHeader title="Goals" description="Your weekly exercise goals. The coach plans your week from these." />
      <QueryState query={settings}>
        {(rows) => {
          const row = rows.find((s) => s.agent_id === 'health_coach' && s.user_id === me)
          return <FitnessGoals key={row ? 'saved' : 'new'} row={row} />
        }}
      </QueryState>
      {partner ? (
        <Card className="grid gap-1 p-3 text-sm">
          <p className="font-medium">{partner.display_name}</p>
          {theirs.length ? (
            <ul className="text-muted-foreground">
              {theirs.map((a) => (
                <li key={a.name}>
                  {a.name} · {a.max ? `at most ${a.times}` : a.times}× a week{a.optional ? ' (optional)' : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">No goals set yet. {partner.display_name} sets them on this tab.</p>
          )}
        </Card>
      ) : null}
    </div>
  )
}
