import { Check, ChevronDown, Plus, RotateCw } from 'lucide-react'
import { useState } from 'react'
import { Avatar } from '@/components/Avatar'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { colorOf } from '@/lib/colors'
import { formatDay, todayISO } from '@/lib/dates'
import { cn, groupBy } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import type { Job } from '../api'
import { useCompleteOccurrence, useCreateTask, useDeleteTask, useJobs, useTaskCategories, useTaskLists, useTaskRooms, useUpdateTask } from '../hooks'
import { agoInWords, dueInWords, jobRule, lastDoneOf } from '../lib/jobs'
import { dueTone } from '../lib/format'
import { useCollapsedGroups } from '../lib/useCollapsedGroups'
import { describeInterval } from '../lib/recurrence'
import { JobForm, type JobValues } from '../components/JobForm'

const SUGGESTIONS: Partial<JobValues>[] = [
  { title: 'Change the bed sheets', rule: { freq: 'weekly', interval: 2, afterDone: true } },
  { title: 'Clothes wash', rule: { freq: 'daily', interval: 3, afterDone: true } },
  { title: 'Put the dishwasher on', rule: { freq: 'daily', interval: 2, afterDone: true } },
  { title: 'Clean the bathroom', rule: { freq: 'weekly', afterDone: true } },
]

const toneClass = { overdue: 'text-destructive font-medium', today: 'text-warning font-medium', soon: 'text-foreground/80', later: '', none: '' }

export default function JobsPage() {
  const jobs = useJobs()
  const rooms = useTaskRooms().data ?? []
  const categories = useTaskCategories().data ?? []
  const { collapsed, toggle } = useCollapsedGroups('life.jobs.collapsed')
  const [editing, setEditing] = useState<Job | 'new' | Partial<JobValues> | null>(null)

  const sorted = (jobs.data ?? []).toSorted((a, b) => (a.open[0]?.due_date ?? '9').localeCompare(b.open[0]?.due_date ?? '9'))
  // Every room in order (empty ones too), then jobs without a room by category
  // (Health first), then whatever is left.
  const byRoom = groupBy(sorted, (j) => j.room_id ?? '')
  const known = new Set(rooms.map((r) => r.id))
  const roomless = sorted.filter((j) => !j.room_id || !known.has(j.room_id))
  const byCategory = groupBy(roomless, (j) => j.category_id ?? '')
  const jobCategories = categories
    .filter((c) => byCategory[c.id]?.length)
    .toSorted((a, b) => Number(b.name === 'Health') - Number(a.name === 'Health'))
  const shownCategoryIds = new Set(jobCategories.map((c) => c.id))
  const groups: { key: string; label: string; dot?: string; items: Job[] }[] = [
    ...rooms.map((r) => ({ key: r.id, label: r.name, items: byRoom[r.id] ?? [] })),
    ...jobCategories.map((c) => ({ key: `category-${c.id}`, label: c.name, dot: colorOf(c.color).dot, items: byCategory[c.id] })),
    {
      key: 'none',
      label: rooms.length || jobCategories.length ? 'Other jobs' : 'Jobs',
      items: roomless.filter((j) => !j.category_id || !shownCategoryIds.has(j.category_id)),
    },
  ].filter((g) => g.key !== 'none' || g.items.length)

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Regular jobs come back a set time after they were last done."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus /> New job
          </Button>
        }
      />

      <Card className="p-2 sm:p-3">
        {jobs.isPending ? (
          <ListSkeleton rows={4} className="p-3" />
        ) : jobs.error ? (
          <ErrorState error={jobs.error} onRetry={() => jobs.refetch()} />
        ) : !sorted.length ? (
          <EmptyState
            icon={RotateCw}
            title="No jobs yet"
            description="Add the things you do over and over. Each one sits on your task list, due again a set time after it was last done."
            action={
              <div className="flex flex-wrap justify-center gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.title}
                    type="button"
                    onClick={() => setEditing(s)}
                    className="rounded-full border px-3 py-1 text-[13px] hover:bg-muted"
                  >
                    {s.title}
                  </button>
                ))}
              </div>
            }
          />
        ) : (
          groups.map((group) => (
            <section key={group.key} aria-labelledby={`room-${group.key}`} className="mb-2 last:mb-0">
              <h2 id={`room-${group.key}`}>
                <button
                  type="button"
                  onClick={() => toggle(group.key)}
                  aria-expanded={!collapsed.has(group.key)}
                  className="flex w-full items-center gap-1.5 rounded-lg px-3 pb-1 pt-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown className={cn('size-3.5 transition-transform', collapsed.has(group.key) && '-rotate-90')} />
                  {group.dot ? <span className={cn('size-2 rounded-full', group.dot)} /> : null}
                  {group.label} <span className="font-normal">· {group.items.length}</span>
                </button>
              </h2>
              {collapsed.has(group.key) ? null : group.items.length ? (
                <JobList
                  groupKey={group.key}
                  jobs={group.items}
                  collapsed={collapsed}
                  toggle={toggle}
                  onOpen={(job) => setEditing(job)}
                />
              ) : (
                <p className="px-3 pb-2 pl-8 text-sm text-muted-foreground">No jobs</p>
              )}
            </section>
          ))
        )}
      </Card>

      <JobDialog value={editing} onClose={() => setEditing(null)} />
    </>
  )
}

const assigneeOf = (job: Job) => job.open[0]?.assignee_id ?? job.assignee_id

/** A group's jobs; split into collapsible per-person sections when more than one person has jobs in it. */
function JobList({
  groupKey,
  jobs,
  collapsed,
  toggle,
  onOpen,
}: {
  groupKey: string
  jobs: Job[]
  collapsed: Set<string>
  toggle: (key: string) => void
  onOpen: (job: Job) => void
}) {
  const { members } = useHousehold()
  const byPerson = groupBy(jobs, (j) => assigneeOf(j) ?? '')
  const rows = (items: Job[]) => (
    <ul>
      {items.map((job) => (
        <JobRow key={job.id} job={job} onOpen={() => onOpen(job)} />
      ))}
    </ul>
  )
  if (Object.keys(byPerson).length < 2) return rows(jobs)

  const people = [
    ...members.filter((m) => byPerson[m.id]).map((m) => ({ id: m.id, label: m.display_name, member: m })),
    ...Object.keys(byPerson)
      .filter((id) => !members.some((m) => m.id === id))
      .map((id) => ({ id, label: 'Either of us', member: undefined })),
  ]
  return people.map(({ id, label, member }) => {
    const key = `${groupKey}/${id || 'none'}`
    return (
      <div key={key} className="pl-4">
        <button
          type="button"
          onClick={() => toggle(key)}
          aria-expanded={!collapsed.has(key)}
          className="flex w-full items-center gap-1.5 rounded-lg px-3 pb-1 pt-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={cn('size-3.5 transition-transform', collapsed.has(key) && '-rotate-90')} />
          {member ? <Avatar name={member.display_name} color={member.avatar_color} size="xs" /> : null}
          {label} <span className="font-normal">· {byPerson[id].length}</span>
        </button>
        {collapsed.has(key) ? null : rows(byPerson[id])}
      </div>
    )
  })
}

function JobRow({ job, onOpen }: { job: Job; onOpen: () => void }) {
  const { member } = useHousehold()
  const complete = useCompleteOccurrence()
  const today = todayISO()
  const rule = jobRule(job.recurrence)
  const occ = job.open[0]
  const latest = job.done[0]
  const lastDone = lastDoneOf(job.last_done_on, latest?.completed_at)
  const doneBy = latest && lastDone === lastDoneOf(null, latest.completed_at) ? member(latest.completed_by) : null
  const assignee = member(occ?.assignee_id ?? job.assignee_id)
  const tone = dueTone(occ?.due_date ?? null, today)

  return (
    <li
      className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/60"
      onClick={onOpen}
    >
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className="block w-full truncate text-left text-[15px] leading-snug"
          onClick={(e) => {
            e.stopPropagation()
            onOpen()
          }}
        >
          {job.title}
        </button>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
          {rule ? <span>{describeInterval(rule)}</span> : null}
          <span>
            {lastDone ? `Last done ${agoInWords(lastDone, today)}${doneBy ? ` by ${doneBy.display_name}` : ''}` : 'Not done yet'}
          </span>
          {occ?.due_date ? (
            <span className={toneClass[tone]} title={formatDay(occ.due_date)}>
              {dueInWords(occ.due_date, today)}
            </span>
          ) : null}
        </div>
      </div>
      {assignee ? (
        <span className="flex items-center" title={`Usually ${assignee.display_name}`}>
          <Avatar name={assignee.display_name} color={assignee.avatar_color} size="sm" />
          <span className="sr-only">Usually done by {assignee.display_name}</span>
        </span>
      ) : null}
      {occ ? (
        <Button
          size="sm"
          variant={tone === 'overdue' || tone === 'today' ? 'default' : 'outline'}
          disabled={complete.isPending}
          onClick={(e) => {
            e.stopPropagation()
            complete.mutate({ occurrenceId: occ.id })
          }}
        >
          <Check /> Done
        </Button>
      ) : null}
    </li>
  )
}

function JobDialog({ value, onClose }: { value: Job | 'new' | Partial<JobValues> | null; onClose: () => void }) {
  const lists = useTaskLists().data ?? []
  const create = useCreateTask()
  const update = useUpdateTask()
  const del = useDeleteTask()
  const job = value && value !== 'new' && 'id' in value ? value : null
  const preset = value && value !== 'new' && !job ? (value as Partial<JobValues>) : undefined
  const jointList = lists.find((l) => l.kind === 'joint')

  const initialLastDone = job ? lastDoneOf(job.last_done_on, job.done[0]?.completed_at) : null
  const initial: Partial<JobValues> | undefined = job
    ? {
        title: job.title,
        rule: jobRule(job.recurrence) ?? undefined,
        assigneeId: job.assignee_id,
        roomId: job.room_id,
        categoryId: job.category_id,
        lastDone: initialLastDone,
      }
    : preset

  function save(v: JobValues) {
    if (job) {
      update.mutate(
        {
          id: job.id,
          patch: {
            title: v.title,
            recurrence: v.rule,
            assignee_id: v.assigneeId,
            room_id: v.roomId,
            category_id: v.categoryId,
            // Only a changed date reschedules the job.
            ...(v.lastDone !== initialLastDone ? { last_done_on: v.lastDone } : {}),
          },
        },
        { onSuccess: onClose },
      )
    } else if (jointList) {
      create.mutate(
        {
          title: v.title,
          list_id: jointList.id,
          assignee_id: v.assigneeId,
          due_date: todayISO(),
          due_time: null,
          priority: 'normal',
          category_id: v.categoryId,
          description: null,
          recurrence: v.rule,
          room_id: v.roomId,
          last_done_on: v.lastDone,
        },
        { onSuccess: onClose },
      )
    }
  }

  return (
    <Dialog open={value !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={job ? 'Edit job' : 'New job'} className="sm:max-w-lg">
        {value !== null ? (
          <JobForm
            key={job?.id ?? preset?.title ?? 'new'}
            initial={initial}
            submitLabel={job ? 'Save' : 'Add job'}
            busy={create.isPending || update.isPending}
            onCancel={onClose}
            onSubmit={save}
            onDelete={job ? () => del.mutate(job.id, { onSuccess: onClose }) : undefined}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
