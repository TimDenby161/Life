import { ListChecks, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, NativeSelect } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/misc'
import { formatDay, todayISO } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { useAddWeddingTasks, useDeleteWeddingTask, useSaveWeddingTask, useWeddingTasks } from '../api'

/** A starting point; dates are left for the couple to set. */
const STARTER = [
  'Set the budget', 'Draft the guest list', 'Book the venue', 'Book the registrar or officiant', 'Book the photographer',
  'Book catering', 'Choose outfits', 'Send save-the-dates', 'Book music', 'Order flowers', 'Send invitations',
  'Order the cake', 'Buy rings', 'Give notice of marriage', 'Plan the seating', 'Book the honeymoon',
]

export function ChecklistTab() {
  const { members } = useHousehold()
  const tasks = useWeddingTasks()
  const save = useSaveWeddingTask()
  const del = useDeleteWeddingTask()
  const addMany = useAddWeddingTasks()
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const today = todayISO()
  const onError = (err: unknown) => toast.error(getErrorMessage(err))

  if (tasks.isPending) return <ListSkeleton rows={5} />
  if (tasks.error) return <ErrorState error={tasks.error} onRetry={() => tasks.refetch()} />

  return (
    <div className="grid gap-3">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!title.trim()) return
          save.mutate({ title: title.trim(), due_date: due || null }, { onSuccess: () => { setTitle(''); setDue('') }, onError })
        }}
      >
        <Input aria-label="New task" placeholder="Add a task, e.g. Book the venue" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} className="min-w-48 flex-1" />
        <Input aria-label="Due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="w-40" />
        <Button type="submit" variant="secondary" disabled={!title.trim() || save.isPending}><Plus /> Add</Button>
      </form>

      {!tasks.data.length ? (
        <Card>
          <EmptyState
            icon={ListChecks}
            title="Nothing on the checklist yet"
            description="Add tasks above, or start from the usual wedding checklist and add dates as you go."
            action={
              <Button variant="outline" disabled={addMany.isPending} onClick={() => addMany.mutate(STARTER, { onError })}>
                <Plus /> Add the usual checklist
              </Button>
            }
          />
        </Card>
      ) : (
        <Card className="divide-y overflow-hidden">
          {tasks.data.map((t) => {
            const overdue = !t.done_at && t.due_date && t.due_date < today
            return (
              <div key={t.id} className="group flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                <Checkbox
                  checked={Boolean(t.done_at)}
                  aria-label={`${t.done_at ? 'Reopen' : 'Done'}: ${t.title}`}
                  onCheckedChange={(v) => save.mutate({ id: t.id, title: t.title, done_at: v ? new Date().toISOString() : null }, { onError })}
                />
                <div className="min-w-0 flex-1">
                  <p className={cn('truncate', t.done_at && 'text-muted-foreground line-through')}>{t.title}</p>
                  {t.due_date || t.done_at ? (
                    <p className={cn('text-xs', overdue ? 'text-destructive' : 'text-muted-foreground')}>
                      {t.done_at ? `Done ${formatDay(t.done_at.slice(0, 10))}` : `Due ${formatDay(t.due_date!)}${overdue ? ' · overdue' : ''}`}
                    </p>
                  ) : null}
                </div>
                <NativeSelect
                  aria-label={`Who's doing ${t.title}`}
                  value={t.assignee_id ?? ''}
                  onChange={(e) => save.mutate({ id: t.id, title: t.title, assignee_id: e.target.value || null }, { onError })}
                  className="h-8 w-28 text-[13px]"
                >
                  <option value="">Anyone</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
                </NativeSelect>
                <Input
                  aria-label={`Due date for ${t.title}`}
                  type="date"
                  value={t.due_date ?? ''}
                  onChange={(e) => save.mutate({ id: t.id, title: t.title, due_date: e.target.value || null }, { onError })}
                  className="h-8 w-36 text-[13px]"
                />
                <Button variant="ghost" size="icon-sm" aria-label={`Delete ${t.title}`} onClick={() => del.mutate(t.id, { onError })}>
                  <Trash2 />
                </Button>
              </div>
            )
          })}
        </Card>
      )}
    </div>
  )
}
