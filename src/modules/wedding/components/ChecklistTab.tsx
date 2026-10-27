import { ListChecks, ListPlus, Plus, Trash2 } from 'lucide-react'
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
import { useAddChecklistTasks, useDeleteChecklistTask, useToggleChecklistTask, useUpdateChecklistTask, useWeddingChecklist, useWeddingSettings } from '../api'
import { ASSUMED_WEDDING_DATE, missingStarterTasks } from '../lib/starterChecklist'

export function ChecklistTab() {
  const { members } = useHousehold()
  const settings = useWeddingSettings()
  const tasks = useWeddingChecklist(settings.data?.task_category_id)
  const update = useUpdateChecklistTask()
  const toggle = useToggleChecklistTask()
  const del = useDeleteChecklistTask()
  const addMany = useAddChecklistTasks()
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const today = todayISO()
  const onError = (err: unknown) => toast.error(getErrorMessage(err))

  if (settings.isPending || tasks.isPending) return <ListSkeleton rows={5} />
  if (settings.error ?? tasks.error) return <ErrorState error={settings.error ?? tasks.error} onRetry={() => { settings.refetch(); tasks.refetch() }} />
  const weddingDate = settings.data?.wedding_date ?? null
  const missing = missingStarterTasks(tasks.data, weddingDate ?? ASSUMED_WEDDING_DATE, today)
  const addUsual = () =>
    addMany.mutate(missing, { onSuccess: () => toast.success(`Added ${missing.length} tasks`), onError })
  const datesFrom = weddingDate ? 'counting back from your wedding date' : 'counting back from 1 September 2028 until you set the exact date'

  return (
    <div className="grid gap-3">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!title.trim()) return
          addMany.mutate([{ title: title.trim(), due_date: due || null }], { onSuccess: () => { setTitle(''); setDue('') }, onError })
        }}
      >
        <Input aria-label="New task" placeholder="Add a task, e.g. Book the venue" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} className="min-w-48 flex-1" />
        <Input aria-label="Due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="w-40" />
        <Button type="submit" variant="secondary" disabled={!title.trim() || addMany.isPending}><Plus /> Add</Button>
        {tasks.data.length && missing.length ? (
          <Button type="button" variant="ghost" disabled={addMany.isPending} onClick={addUsual} title={`Adds ${missing.length} usual tasks with due dates ${datesFrom}`}>
            <ListPlus /> Add the usual tasks
          </Button>
        ) : null}
      </form>

      {!tasks.data.length ? (
        <Card>
          <EmptyState
            icon={ListChecks}
            title="Nothing on the checklist yet"
            description={`Add tasks above, or start from the usual wedding checklist, with due dates ${datesFrom}. Everything here is also on the Tasks page.`}
            action={
              <Button variant="outline" disabled={addMany.isPending} onClick={addUsual}>
                <ListPlus /> Add the usual checklist
              </Button>
            }
          />
        </Card>
      ) : (
        <Card className="divide-y overflow-hidden">
          {tasks.data.map((t) => {
            const overdue = !t.done && t.due_date && t.due_date < today
            return (
              <div key={t.id} className="group flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                <Checkbox
                  checked={t.done}
                  aria-label={`${t.done ? 'Reopen' : 'Done'}: ${t.title}`}
                  disabled={toggle.isPending}
                  onCheckedChange={() => toggle.mutate(t, { onError })}
                />
                <div className="min-w-0 flex-1">
                  <p className={cn('truncate', t.done && 'text-muted-foreground line-through')}>{t.title}</p>
                  {t.due_date || t.completed_at ? (
                    <p className={cn('text-xs', overdue ? 'text-destructive' : 'text-muted-foreground')}>
                      {t.completed_at ? `Done ${formatDay(t.completed_at.slice(0, 10))}` : `Due ${formatDay(t.due_date!)}${overdue ? ' · overdue' : ''}`}
                    </p>
                  ) : null}
                </div>
                <NativeSelect
                  aria-label={`Who's doing ${t.title}`}
                  value={t.assignee_id ?? ''}
                  onChange={(e) => update.mutate({ id: t.id, patch: { assignee_id: e.target.value || null } }, { onError })}
                  className="h-8 w-28 text-[13px]"
                >
                  <option value="">Anyone</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
                </NativeSelect>
                <Input
                  aria-label={`Due date for ${t.title}`}
                  type="date"
                  value={t.due_date ?? ''}
                  onChange={(e) => update.mutate({ id: t.id, patch: { due_date: e.target.value || null } }, { onError })}
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
