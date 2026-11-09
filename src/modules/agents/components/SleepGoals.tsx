import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect } from '@/components/ui/input'
import { getErrorMessage } from '@/lib/errors'
import { bedtime, parseSleepGoals } from '../../../../supabase/functions/_shared/agents/sleep.ts'
import { formatMinutes } from '../../../../supabase/functions/_shared/agents/taskManager.ts'
import { type AgentSetting, useSaveAgentConfig } from '../api'

const TARGETS = [6.5, 7, 7.5, 8, 8.5, 9]

/** My sleep target and alarm time, saved with my Sleep Coach settings. */
export function SleepGoals({ row }: { row: AgentSetting | undefined }) {
  const save = useSaveAgentConfig('sleep', row)
  const saved = parseSleepGoals(row?.config)
  const [target, setTarget] = useState(saved?.targetHours ?? 8)
  const [wake, setWake] = useState(saved?.wakeTime ?? '07:00')

  return (
    <form
      className="grid gap-2 rounded-xl border p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate({ targetHours: target, wakeTime: wake }, { onSuccess: () => toast.success('Sleep goal saved'), onError: (err) => toast.error(getErrorMessage(err)) })
      }}
    >
      <h4 className="font-semibold">My sleep</h4>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect aria-label="Sleep target" className="h-8 w-auto" value={target} onChange={(e) => setTarget(Number(e.target.value))}>
          {TARGETS.map((t) => <option key={t} value={t}>{formatMinutes(t * 60)} a night</option>)}
        </NativeSelect>
        alarm at
        <Input type="time" aria-label="Alarm time" className="h-8 w-auto" value={wake} onChange={(e) => setWake(e.target.value || '07:00')} />
        <Button type="submit" size="sm" className="ml-auto" disabled={save.isPending}>Save</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        In bed by {bedtime({ targetHours: target, wakeTime: wake })}. Log sleep each morning in the check-in on Home; only you get its advice.
      </p>
    </form>
  )
}
