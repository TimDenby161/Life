import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getErrorMessage } from '@/lib/errors'
import { parseCareerConfig } from '../../../../supabase/functions/_shared/agents/career.ts'
import { type AgentSetting, useSaveAgentConfig } from '../api'

/** Which calendar events get coaching before and after, by words in their titles. */
export function EventCoaching({ row }: { row: AgentSetting | undefined }) {
  const save = useSaveAgentConfig('career', row)
  const [words, setWords] = useState(parseCareerConfig(row?.config).eventWords.join(', '))

  return (
    <form
      className="grid gap-2 rounded-xl border p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        const eventWords = parseCareerConfig({ eventWords: words.split(',') }).eventWords
        save.mutate({ eventWords }, { onSuccess: () => toast.success('Saved'), onError: (err) => toast.error(getErrorMessage(err)) })
      }}
    >
      <h4 className="font-semibold">Event coaching</h4>
      <p className="text-muted-foreground">
        For events in your calendar with these words in the title: three openers to prepare in the days before, and what went well the day after.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Event words" placeholder="e.g. client, congress, dinner" className="h-8 min-w-40 flex-1" maxLength={300} value={words} onChange={(e) => setWords(e.target.value)} />
        <Button type="submit" size="sm" disabled={save.isPending}>Save</Button>
      </div>
    </form>
  )
}
