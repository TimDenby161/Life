import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect } from '@/components/ui/input'
import { getErrorMessage } from '@/lib/errors'
import { LANGUAGE_NAMES, type LanguageTarget, parseLanguageTargets } from '../../../../supabase/functions/_shared/agents/languages.ts'
import { type AgentSetting, useSaveAgentConfig } from '../api'

/** Target dates for my languages, saved with my Language Coach settings. */
export function LanguageTargets({ row }: { row: AgentSetting | undefined }) {
  const save = useSaveAgentConfig('language_coach', row)
  const [targets, setTargets] = useState<LanguageTarget[]>(parseLanguageTargets(row?.config))
  const set = (i: number, patch: Partial<LanguageTarget>) => setTargets(targets.map((t, j) => (j === i ? { ...t, ...patch } : t)))

  return (
    <form
      className="grid gap-2 rounded-xl border p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate(
          { targets: targets.filter((t) => t.by).map((t) => ({ language: t.language, by: t.by, label: t.label.trim() })) },
          { onSuccess: () => toast.success('Targets saved'), onError: (err) => toast.error(getErrorMessage(err)) },
        )
      }}
    >
      <h4 className="font-semibold">My targets</h4>
      <ul className="grid gap-2">
        {targets.map((t, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            <NativeSelect aria-label="Language" className="h-8 w-auto" value={t.language} onChange={(e) => set(i, { language: e.target.value })}>
              {Object.entries(LANGUAGE_NAMES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </NativeSelect>
            <Input aria-label="What for" placeholder="e.g. Guatemala" className="h-8 min-w-28 flex-1" maxLength={40} value={t.label} onChange={(e) => set(i, { label: e.target.value })} />
            <Input type="date" aria-label="By" className="h-8 w-auto" value={t.by} onChange={(e) => set(i, { by: e.target.value })} />
            <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove target" onClick={() => setTargets(targets.filter((_, j) => j !== i))}>
              <X />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="ghost" disabled={targets.length >= 4} onClick={() => setTargets([...targets, { language: 'es', by: '', label: '' }])}>
          <Plus /> Target
        </Button>
        <Button type="submit" size="sm" className="ml-auto" disabled={save.isPending}>Save targets</Button>
      </div>
      <p className="text-xs text-muted-foreground">Each week brings a speaking topic for the target that comes first; other languages keep to reviews until then.</p>
    </form>
  )
}
