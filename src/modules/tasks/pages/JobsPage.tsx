import { Check, ChevronDown, Plus, RotateCw } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Avatar } from '@/components/Avatar'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { colorOf } from '@/lib/colors'
import { formatDay, todayISO } from '@/lib/dates'
import { Segmented } from '@/components/ui/misc'
import { cn, groupBy } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import type { Job } from '../api'
import { useCompleteOccurrence, useCreateTask, useDeleteTask, useJobs, useTaskCategories, useTaskLists, useTaskRooms, useUpdateTask } from '../hooks'
import { agoInWords, dueInWords, jobRule, lastDoneOf } from '../lib/jobs'
import { dueTone } from '../lib/format'
import { ownerOf } from '../lib/owner'
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
  const lists = useTaskLists().data ?? []
  const { members } = useHousehold()
  const [params, setParams] = useSearchParams()
  const { collapsed, toggle } = useCollapsedGroups('life.jobs.collapsed')
  const [editing, setEditing] = useState<Job | 'new' | Partial<JobValues> | null>(null)

  // 'joint', or a member's id for the jobs that are only ever theirs (as on Tasks).
  const whoParam = params.get('who')
  const who = members.some((m) => m.id === whoParam) ? whoParam! : 'joint'
  const setWho = (v: string) =>
    setParams(
      (p) => {
        if (v === 'joint') p.delete('who')
        else p.set('who', v)
        return p
      },
      { replace: true },
    )

  const all = jobs.data ?? []
  const sorted = all
    .filter((j) => (ownerOf(j, categories, lists) ?? 'joint') === who)
    .toSorted((a, b) => (a.open[0]?.due_date ?? '9').localeCompare(b.open[0]?.due_date ?? '9'))
  // Cleaning holds every room in order (empty ones too, plus a Cleaning-category
  // job without a room); then jobs without a room by category (Health first),
  // then whatever is left.
  const byRoom = groupBy(sorted, (j) => j.room_id ?? '')
  const known = new Set(rooms.map((r) => r.id))
  const roomless = sorted.filter((j) => !j.room_id || !known.has(j.room_id))
  const byCategory = groupBy(roomless, (j) => j.category_id ?? '')
  const cleaningCategory = categories.find((c) => c.name.toLowerCase() === 'cleaning')
  const roomlessCleaning = cleaningCategory ? (byCategory[cleaningCategory.id] ?? []) : []
  const jobCategories = categories
    .filter((c) => c !== cleaningCategory && byCategory[c.id]?.length)
    .toSorted((a, b) => Number(b.name === 'Health') - Number(a.name === 'Health'))
  const shownCategoryIds = new Set(jobCategories.map((c) => c.id))
  const cleaningRooms: SubGroup[] = [
    // Empty rooms only show on Joint, where new cleaning jobs usually go.
    ...rooms
      .map((r) => ({ key: r.id, label: r.name, items: byRoom[r.id] ?? [] }))
      .filter((r) => who === 'joint' || r.items.length),
    ...(roomlessCleaning.length ? [{ key: 'cleaning-other', label: 'Other cleaning', items: roomlessCleaning }] : []),
  ]
  const groups: Group[] = [
    ...(cleaningRooms.length
      ? [{ key: 'cleaning', label: 'Cleaning', dot: cleaningCategory && colorOf(cleaningCategory.color).dot, items: cleaningRooms.flatMap((r) => r.items), subgroups: cleaningRooms }]
      : []),
    ...jobCategories.map((c) => ({ key: `category-${c.id}`, label: c.name, dot: colorOf(c.color).dot, items: byCategory[c.id] })),
    {
      key: 'none',
      label: cleaningRooms.length || jobCategories.length ? 'Other jobs' : 'Jobs',
      items: roomless.filter((j) => !j.category_id || (j.category_id !== cleaningCategory?.id && !shownCategoryIds.has(j.category_id))),
    },
  ].filter((g) => g.key !== 'none' || g.items.length)

  return (
    <>
      <PageHeader
        title="Regular Jobs"
        description="Regular jobs come back a set time after they were last done."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus /> New job
          </Button>
        }
      />

      <Segmented
        aria-label="Whose jobs"
        className="mb-4"
        value={who}
        onChange={setWho}
        options={[{ value: 'joint', label: 'Joint' }, ...members.map((m) => ({ value: m.id, label: m.display_name }))]}
      />

      <Card className="p-2 sm:p-3">
        {jobs.isPending ? (
          <ListSkeleton rows={4} className="p-3" />
        ) : jobs.error ? (
          <ErrorState error={jobs.error} onRetry={() => jobs.refetch()} />
        ) : !all.length ? (
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
        ) : !groups.length ? (
          <EmptyState icon={RotateCw} title="No jobs here" description="Nothing that is only this person's yet." />
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
              {collapsed.has(group.key) ? null : group.subgroups ? (
                group.subgroups.map((sub) => (
                  <div key={sub.key} className="pl-4">
                    <SubToggle id={sub.key} label={sub.label} count={sub.items.length} collapsed={collapsed} toggle={toggle} />
                    {collapsed.has(sub.key) ? null : sub.items.length ? (
                      <JobList groupKey={sub.key} jobs={sub.items} collapsed={collapsed} toggle={toggle} onOpen={(job) => setEditing(job)} />
                    ) : (
                      <p className="px-3 pb-2 pl-8 text-sm text-muted-foreground">No jobs</p>
                    )}
                  </div>
                ))
              ) : group.items.length ? (
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

      <JobDialog value={editing} ownerId={who === 'joint' ? null : who} onClose={() => setEditing(null)} />
    </>
  )
}

type SubGroup = { key: string; label: string; items: Job[] }
type Group = SubGroup & { dot?: string; subgroups?: SubGroup[] }

/** Header for a collapsible section inside a group. */
function SubToggle({
  id,
  label,
  count,
  icon,
  collapsed,
  toggle,
}: {
  id: string
  label: string
  count: number
  icon?: ReactNode
  collapsed: Set<string>
  toggle: (key: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => toggle(id)}
      aria-expanded={!collapsed.has(id)}
      className="flex w-full items-center gap-1.5 rounded-lg px-3 pb-1 pt-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
    >
      <ChevronDown className={cn('size-3.5 transition-transform', collapsed.has(id) && '-rotate-90')} />
      {icon}
      {label} <span className="font-normal">· {count}</span>
    </button>
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
        <SubToggle
          id={key}
          label={label}
          count={byPerson[id].length}
          icon={member ? <Avatar name={member.display_name} color={member.avatar_color} size="xs" /> : null}
          collapsed={collapsed}
          toggle={toggle}
        />
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

/** New jobs land where the filter shows them: the person's own list, otherwise the joint one. */
function JobDialog({
  value,
  ownerId,
  onClose,
}: {
  value: Job | 'new' | Partial<JobValues> | null
  ownerId: string | null
  onClose: () => void
}) {
  const lists = useTaskLists().data ?? []
  const create = useCreateTask()
  const update = useUpdateTask()
  const del = useDeleteTask()
  const job = value && value !== 'new' && 'id' in value ? value : null
  const preset = value && value !== 'new' && !job ? (value as Partial<JobValues>) : ownerId ? { assigneeId: ownerId } : undefined
  const newList = lists.find((l) => l.kind === 'personal' && l.owner_id === ownerId) ?? lists.find((l) => l.kind === 'joint')

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
    } else if (newList) {
      create.mutate(
        {
          title: v.title,
          list_id: newList.id,
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
