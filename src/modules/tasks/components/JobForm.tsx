import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { Segmented } from '@/components/ui/misc'
import { addDaysISO, formatDay, todayISO } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { useTaskCategories, useTaskRooms } from '../hooks'
import { dueInWords, nextDueAfter } from '../lib/jobs'
import type { RecurrenceRule } from '../lib/recurrence'

export type JobValues = {
  title: string
  rule: RecurrenceRule
  assigneeId: string | null
  roomId: string | null
  categoryId: string | null
  lastDone: string | null
}

type Unit = 'daily' | 'weekly' | 'monthly'

const UNITS: { value: Unit; label: string }[] = [
  { value: 'daily', label: 'Days' },
  { value: 'weekly', label: 'Weeks' },
  { value: 'monthly', label: 'Months' },
]

type Props = {
  initial?: Partial<JobValues>
  submitLabel: string
  busy?: boolean
  onSubmit: (values: JobValues) => void
  onCancel: () => void
  onDelete?: () => void
}

export function JobForm({ initial, submitLabel, busy, onSubmit, onCancel, onDelete }: Props) {
  const { members } = useHousehold()
  const rooms = useTaskRooms().data ?? []
  const categories = useTaskCategories().data ?? []
  const [title, setTitle] = useState(initial?.title ?? '')
  const [every, setEvery] = useState(initial?.rule?.interval ?? 1)
  const [unit, setUnit] = useState<Unit>(initial?.rule?.freq === 'yearly' ? 'monthly' : (initial?.rule?.freq ?? 'weekly'))
  const [assigneeId, setAssigneeId] = useState(initial?.assigneeId ?? '')
  const [roomId, setRoomId] = useState(initial?.roomId ?? '')
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '')
  const [lastDone, setLastDone] = useState(initial?.lastDone ?? '')
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const today = todayISO()
  const rule: RecurrenceRule = { freq: unit, ...(every > 1 ? { interval: every } : {}), afterDone: true }
  const nextDue = nextDueAfter(rule, lastDone || null, today)
  const chips = [
    { label: 'Today', value: today },
    { label: 'Yesterday', value: addDaysISO(today, -1) },
    { label: 'Not yet', value: '' },
  ]

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return setError('Give the job a name')
    if (lastDone > today) return setError("Last done can't be in the future")
    onSubmit({ title: title.trim(), rule, assigneeId: assigneeId || null, roomId: roomId || null, categoryId: categoryId || null, lastDone: lastDone || null })
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Job" htmlFor="job-title" error={error}>
        <Input
          id="job-title"
          autoFocus={!initial?.title}
          placeholder="e.g. Change the bed sheets"
          value={title}
          maxLength={200}
          onChange={(e) => {
            setTitle(e.target.value)
            setError(null)
          }}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Room" htmlFor="job-room">
          <NativeSelect id="job-room" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">No particular room</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Category" htmlFor="job-category">
          <NativeSelect id="job-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">None</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <Field label="Comes back every">
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={365}
            aria-label="How many"
            className="w-20 text-center"
            value={every}
            onChange={(e) => setEvery(Math.max(1, Math.min(365, Number.parseInt(e.target.value, 10) || 1)))}
          />
          <Segmented aria-label="Unit" value={unit} onChange={setUnit} options={UNITS} className="flex-1 [&>*]:flex-1" />
        </div>
      </Field>

      <Field label="Last done">
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => setLastDone(c.value)}
              className={cn(
                'rounded-full border px-3 py-1 text-[13px] transition-colors',
                lastDone === c.value ? 'border-primary bg-accent text-accent-foreground' : 'hover:bg-muted',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <Input type="date" aria-label="Last done on" max={today} value={lastDone} onChange={(e) => setLastDone(e.target.value)} />
        <p className="text-xs text-muted-foreground">
          {lastDone
            ? `${dueInWords(nextDue, today)} (${formatDay(nextDue)})`
            : 'Due today, then it comes back from whenever it gets done'}
        </p>
      </Field>

      <Field label="Usually done by">
        <Segmented
          aria-label="Usually done by"
          value={assigneeId || 'none'}
          onChange={(v) => setAssigneeId(v === 'none' ? '' : v)}
          options={[{ value: 'none', label: 'Anyone' }, ...members.map((m) => ({ value: m.id, label: m.display_name }))]}
          className="w-full [&>*]:flex-1"
        />
      </Field>

      <DialogFooter className="mt-1">
        {onDelete ? (
          <Button
            variant="ghost"
            className="mr-auto text-destructive"
            onClick={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
          >
            {confirmDelete ? 'Delete for good?' : 'Delete'}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}
