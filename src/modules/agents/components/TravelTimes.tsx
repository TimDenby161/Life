import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect } from '@/components/ui/input'
import { getErrorMessage } from '@/lib/errors'
import { parseTravel, type TravelRule } from '../../../../supabase/functions/_shared/agents/calendar.ts'
import { formatMinutes } from '../../../../supabase/functions/_shared/agents/taskManager.ts'
import { type AgentSetting, useSaveAgentConfig } from '../api'

const MINUTES = [10, 15, 20, 30, 45, 60, 75, 90, 120]

/** Travel to and from calendar events, so plans don't fill the journey. Saved with my Chief of Staff settings. */
export function TravelTimes({ row }: { row: AgentSetting | undefined }) {
  const save = useSaveAgentConfig('chief_of_staff', row)
  const [rules, setRules] = useState<TravelRule[]>(parseTravel(row?.config))
  const set = (i: number, patch: Partial<TravelRule>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <form
      className="grid gap-2 rounded-xl border p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        // Keep the rest of my Chief of Staff settings as they are.
        const config = { ...((row?.config as Record<string, unknown> | null) ?? {}), travel: parseTravel({ travel: rules }) }
        save.mutate(config, { onSuccess: () => toast.success('Travel times saved'), onError: (err) => toast.error(getErrorMessage(err)) })
      }}
    >
      <h4 className="font-semibold">Travel time</h4>
      <p className="text-muted-foreground">Time to get to and back from events, by a word in their title. It’s blocked out before and after, so your plan for the day doesn’t fill the journey.</p>
      <ul className="grid gap-2">
        {rules.map((r, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            <Input aria-label="Event word" placeholder="e.g. Padel" className="h-8 min-w-28 flex-1" maxLength={30} value={r.word} onChange={(e) => set(i, { word: e.target.value })} />
            <NativeSelect aria-label={`${r.word || 'Event'} travel each way`} className="h-8 w-auto" value={r.minutes} onChange={(e) => set(i, { minutes: Number(e.target.value) })}>
              {MINUTES.map((m) => <option key={m} value={m}>{formatMinutes(m)} each way</option>)}
            </NativeSelect>
            <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove travel time" onClick={() => setRules(rules.filter((_, j) => j !== i))}>
              <X />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="ghost" disabled={rules.length >= 12} onClick={() => setRules([...rules, { word: '', minutes: 60 }])}>
          <Plus /> Travel time
        </Button>
        <Button type="submit" size="sm" className="ml-auto" disabled={save.isPending}>Save</Button>
      </div>
    </form>
  )
}
