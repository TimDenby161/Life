import { nextSaturday } from 'date-fns'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Segmented } from '@/components/ui/misc'
import { addDaysISO, formatDay, todayISO, toISODate } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import type { Priority, Task, TaskInput } from '../api'
import { useTaskCategories, useTaskLists } from '../hooks'
import { PRIORITIES } from '../lib/format'
import {
  describeRecurrence,
  type Frequency,
  parseRecurrence,
  type RecurrenceRule,
  upcomingOccurrences,
  WEEKDAYS,
  isoWeekday,
} from '../lib/recurrence'

type Props = {
  initial?: Task
  defaultListId?: string
  submitLabel: string
  busy?: boolean
  onSubmit: (input: TaskInput) => void
  onCancel: () => void
}

export function TaskForm({ initial, defaultListId, submitLabel, busy, onSubmit, onCancel }: Props) {
  const { members } = useHousehold()
  const lists = useTaskLists().data ?? []
  const categories = useTaskCategories().data ?? []

  const startList = lists.find((l) => l.id === (initial?.list_id ?? defaultListId)) ?? lists[0]
  const [title, setTitle] = useState(initial?.title ?? '')
  const [listId, setListId] = useState(startList?.id ?? '')
  const [assigneeId, setAssigneeId] = useState<string>(
    initial ? (initial.assignee_id ?? '') : (startList?.owner_id ?? ''),
  )
  const [dueDate, setDueDate] = useState(initial?.due_date ?? '')
  const [dueTime, setDueTime] = useState(initial?.due_time?.slice(0, 5) ?? '')
  const [priority, setPriority] = useState<Priority>((initial?.priority as Priority) ?? 'normal')
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [rule, setRule] = useState<RecurrenceRule | null>(parseRecurrence(initial?.recurrence))
  const [error, setError] = useState<string | null>(null)

  function chooseList(id: string) {
    setListId(id)
    const list = lists.find((l) => l.id === id)
    // Personal lists default to their owner; leave explicit choices alone.
    if (!initial && list?.owner_id) setAssigneeId(list.owner_id)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return setError('Give the task a title')
    if (rule && !dueDate) return setError('Repeating tasks need a start date')
    if (dueTime && !dueDate) return setError('Pick a date for the time')
    onSubmit({
      title: title.trim(),
      list_id: listId,
      assignee_id: assigneeId || null,
      due_date: dueDate || null,
      due_time: dueTime || null,
      priority,
      category_id: categoryId || null,
      description: description.trim() || null,
      recurrence: rule,
    })
  }

  const today = todayISO()
  const dateChips = [
    { label: 'Today', value: today },
    { label: 'Tomorrow', value: addDaysISO(today, 1) },
    { label: 'Weekend', value: toISODate(nextSaturday(new Date())) },
    { label: 'Next week', value: addDaysISO(today, 7) },
  ]

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Task" htmlFor="task-title" error={error}>
        <Input
          id="task-title"
          autoFocus
          placeholder="e.g. Take the bins out"
          value={title}
          maxLength={200}
          onChange={(e) => {
            setTitle(e.target.value)
            setError(null)
          }}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="List">
          <Segmented
            aria-label="List"
            value={listId}
            onChange={chooseList}
            options={lists.map((l) => ({ value: l.id, label: l.name }))}
            className="w-full [&>*]:flex-1"
          />
        </Field>
        <Field label="Assigned to">
          <Segmented
            aria-label="Assigned to"
            value={assigneeId || 'none'}
            onChange={(v) => setAssigneeId(v === 'none' ? '' : v)}
            options={[{ value: 'none', label: 'Anyone' }, ...members.map((m) => ({ value: m.id, label: m.display_name }))]}
            className="w-full [&>*]:flex-1"
          />
        </Field>
      </div>

      <Field label={rule ? 'Starts' : 'Due'}>
        <div className="flex flex-wrap gap-1.5">
          {dateChips.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => setDueDate(c.value)}
              className={cn(
                'rounded-full border px-3 py-1 text-[13px] transition-colors',
                dueDate === c.value ? 'border-primary bg-accent text-accent-foreground' : 'hover:bg-muted',
              )}
            >
              {c.label}
            </button>
          ))}
          {dueDate && !rule ? (
            <button type="button" onClick={() => { setDueDate(''); setDueTime('') }} className="rounded-full px-3 py-1 text-[13px] text-muted-foreground hover:bg-muted">
              No date
            </button>
          ) : null}
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Input type="date" aria-label="Due date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          <Input type="time" aria-label="Due time (optional)" className="w-32" value={dueTime} onChange={(e) => setDueTime(e.target.value)} disabled={!dueDate} />
        </div>
      </Field>

      <RecurrencePicker rule={rule} onChange={setRule} anchor={dueDate || today} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Priority">
          <Segmented aria-label="Priority" size="sm" value={priority} onChange={setPriority} options={PRIORITIES} className="w-full [&>*]:flex-1" />
        </Field>
        <Field label="Category" htmlFor="task-category">
          <NativeSelect id="task-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">None</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <Field label="Notes" htmlFor="task-notes">
        <Textarea id="task-notes" rows={2} value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} />
      </Field>

      <DialogFooter className="mt-1">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !listId}>
          {busy ? 'Saving…' : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}

const FREQS: { value: Frequency | 'none'; label: string }[] = [
  { value: 'none', label: 'Once' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
]

function RecurrencePicker({
  rule,
  onChange,
  anchor,
}: {
  rule: RecurrenceRule | null
  onChange: (rule: RecurrenceRule | null) => void
  anchor: string
}) {
  const unit = { daily: 'days', weekly: 'weeks', monthly: 'months', yearly: 'years' }
  const preview = rule && !rule.afterDone ? upcomingOccurrences(rule, anchor, anchor, 3) : []

  function setFreq(freq: Frequency | 'none') {
    if (freq === 'none') return onChange(null)
    // Jobs keep their plain interval; they never have fixed days.
    if (rule?.afterDone) return onChange({ ...rule, freq })
    onChange({ freq, ...(freq === 'weekly' ? { weekdays: [isoWeekday(anchor)] } : {}), ...(rule?.until ? { until: rule.until } : {}) })
  }

  return (
    <Field label="Repeat">
      <Segmented aria-label="Repeat" size="sm" value={rule?.freq ?? 'none'} onChange={setFreq} options={FREQS} className="w-full overflow-x-auto [&>*]:flex-1" />
      {rule ? (
        <div className="mt-1 grid gap-3 rounded-xl bg-muted/50 p-3">
          <div className="flex items-center gap-2 text-sm">
            Every
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              aria-label="Interval"
              className="h-8 w-16 text-center"
              value={rule.interval ?? 1}
              onChange={(e) => {
                const n = Math.max(1, Math.min(365, Number.parseInt(e.target.value, 10) || 1))
                onChange({ ...rule, interval: n === 1 ? undefined : n })
              }}
            />
            {unit[rule.freq]}
          </div>
          {rule.freq === 'weekly' && !rule.afterDone ? (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Days of the week">
              {WEEKDAYS.map((d) => {
                const on = rule.weekdays?.includes(d.iso) ?? false
                return (
                  <button
                    key={d.iso}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      const set = new Set(rule.weekdays ?? [])
                      if (on) set.delete(d.iso)
                      else set.add(d.iso)
                      if (set.size) onChange({ ...rule, weekdays: [...set].toSorted((a, b) => a - b) })
                    }}
                    className={cn(
                      'h-8 w-11 rounded-full border text-xs font-medium',
                      on ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted',
                    )}
                  >
                    {d.short}
                  </button>
                )
              })}
            </div>
          ) : null}
          {rule.freq === 'monthly' && !rule.afterDone ? (
            <div className="flex items-center gap-2 text-sm">
              On day
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={31}
                aria-label="Day of month"
                className="h-8 w-16 text-center"
                value={rule.monthDay ?? Number(anchor.slice(8, 10))}
                onChange={(e) => {
                  const n = Math.max(1, Math.min(31, Number.parseInt(e.target.value, 10) || 1))
                  onChange({ ...rule, monthDay: n })
                }}
              />
            </div>
          ) : null}
          <div className="flex items-center gap-2 text-sm">
            Until
            <Input
              type="date"
              aria-label="Repeat until (optional)"
              className="h-8 w-auto"
              value={rule.until ?? ''}
              min={anchor}
              onChange={(e) => {
                const { until: _drop, ...rest } = rule
                onChange(e.target.value ? { ...rest, until: e.target.value } : rest)
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {describeRecurrence(rule, anchor)}
            {rule.afterDone ? null : preview.length ? ` · next ${preview.map((d) => formatDay(d)).join(', ')}` : ' · no upcoming dates'}
          </p>
        </div>
      ) : null}
    </Field>
  )
}
