import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect } from '@/components/ui/input'
import { getErrorMessage } from '@/lib/errors'
import { DEFAULT_PACE_KG, parseFoodGoals } from '../../../../supabase/functions/_shared/agents/nutrition.ts'
import { type AgentSetting, useSaveAgentConfig } from '../api'

const LIMITS = [0, 1, 2, 3, 4, 5, 6, 7]
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const PACES = [0.25, 0.5, 0.75, 1]

/** My weight target and takeaway limits, saved with my Weight & Food settings. */
export function FoodGoals({ row }: { row: AgentSetting | undefined }) {
  const save = useSaveAgentConfig('nutrition', row)
  const saved = parseFoodGoals(row?.config)
  const [target, setTarget] = useState(saved?.targetKg?.toString() ?? '')
  const [pace, setPace] = useState(saved?.weeklyKg ?? DEFAULT_PACE_KG)
  const [solo, setSolo] = useState(saved?.soloTakeaways ?? -1)
  const [shared, setShared] = useState(saved?.sharedTakeaways ?? -1)
  const [planDay, setPlanDay] = useState(saved?.mealPlanDay ?? 0)
  const targetKg = target.trim() ? Number(target) : null

  return (
    <form
      className="grid gap-2 rounded-xl border p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate(
          {
            targetKg,
            weeklyKg: pace,
            soloTakeaways: solo < 0 ? null : solo,
            sharedTakeaways: shared < 0 ? null : shared,
            mealPlanDay: planDay || null,
          },
          { onSuccess: () => toast.success('Goals saved'), onError: (err) => toast.error(getErrorMessage(err)) },
        )
      }}
    >
      <h4 className="font-semibold">My goals</h4>
      <label className="flex flex-wrap items-center gap-2">
        Target weight
        <Input aria-label="Target weight in kg" inputMode="decimal" className="h-8 w-20" placeholder="kg" value={target} onChange={(e) => setTarget(e.target.value)} />
        kg at
        <NativeSelect aria-label="Pace" className="h-8 w-auto" value={pace} onChange={(e) => setPace(Number(e.target.value))}>
          {PACES.map((p) => <option key={p} value={p}>{p} kg a week</option>)}
        </NativeSelect>
      </label>
      <label className="flex flex-wrap items-center gap-2">
        Takeaways on my own
        <NativeSelect aria-label="Takeaways on my own a week" className="h-8 w-auto" value={solo} onChange={(e) => setSolo(Number(e.target.value))}>
          <option value={-1}>No limit</option>
          {LIMITS.map((n) => <option key={n} value={n}>{n} a week</option>)}
        </NativeSelect>
      </label>
      <label className="flex flex-wrap items-center gap-2">
        Takeaways together
        <NativeSelect aria-label="Takeaways together a week" className="h-8 w-auto" value={shared} onChange={(e) => setShared(Number(e.target.value))}>
          <option value={-1}>No limit</option>
          {LIMITS.map((n) => <option key={n} value={n}>{n} a week</option>)}
        </NativeSelect>
      </label>
      <label className="flex flex-wrap items-center gap-2">
        Plan meals on
        <NativeSelect aria-label="Meal planning day" className="h-8 w-auto" value={planDay} onChange={(e) => setPlanDay(Number(e.target.value))}>
          <option value={0}>No reminder</option>
          {DAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
        </NativeSelect>
      </label>
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={save.isPending || (targetKg !== null && !(targetKg >= 30 && targetKg <= 250))}>Save goals</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Weigh in on the Health page and log takeaways there. Anything about your weight goes only to you, and never to the AI sentence or a
        notification.
      </p>
    </form>
  )
}
