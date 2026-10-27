import { BarChart3, CheckCircle2, ChevronDown, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, Route, Routes, useSearchParams } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/misc'
import { todayISO } from '@/lib/dates'
import { cn, groupBy } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import type { OccurrenceWithTask } from '../api'
import { TaskDetailDialog } from '../components/TaskDetail'
import { TaskForm } from '../components/TaskForm'
import { TaskRow } from '../components/TaskRow'
import {
  useCompleteOccurrence,
  useCreateTask,
  useOpenOccurrences,
  useRecentlyDone,
  useReopenOccurrence,
  useTaskCategories,
  useTaskLists,
} from '../hooks'
import { compareOccurrences, type Section, SECTION_LABELS, sectionOf } from '../lib/format'
import { isWaitingJob } from '../lib/jobs'
import TaskStatsPage from './TaskStatsPage'

export default function TasksPage() {
  return (
    <Routes>
      <Route index element={<TaskListView />} />
      <Route path="stats" element={<TaskStatsPage />} />
    </Routes>
  )
}

const SECTION_ORDER: Section[] = ['overdue', 'today', 'upcoming', 'later', 'someday']

function TaskListView() {
  const { me } = useHousehold()
  const [params, setParams] = useSearchParams()
  const listParam = params.get('list') ?? 'all'
  const mine = params.get('mine') === '1'
  const openTaskId = params.get('task')

  const lists = useTaskLists()
  const categories = useTaskCategories()
  const open = useOpenOccurrences()
  const done = useRecentlyDone(7)
  const complete = useCompleteOccurrence()
  const reopen = useReopenOccurrence()
  const [creating, setCreating] = useState(false)
  const [showDone, setShowDone] = useState(false)

  const setParam = (key: string, value: string | null) =>
    setParams(
      (p) => {
        if (value === null) p.delete(key)
        else p.set(key, value)
        return p
      },
      { replace: key !== 'task' },
    )

  const filter = (o: OccurrenceWithTask) =>
    (listParam === 'all' || o.task.list_id === listParam) && (!mine || o.assignee_id === me.id)

  const today = todayISO()
  const sections = useMemo(() => {
    const visible = (open.data ?? [])
      .filter((o) => filter(o) && !isWaitingJob(o, today))
      .toSorted(compareOccurrences)
    return groupBy(visible, (o) => sectionOf(o.due_date, today))
  }, [open.data, listParam, mine, today])
  const recentDone = (done.data ?? []).filter(filter)

  const counts = {
    today: sections.today?.length ?? 0,
    overdue: sections.overdue?.length ?? 0,
  }
  const currentList = (lists.data ?? []).find((l) => l.id === listParam)
  const allLists = lists.data ?? []
  const allCategories = categories.data ?? []

  return (
    <>
      <PageHeader
        title="Tasks"
        description={
          open.data
            ? [
                counts.overdue ? `${counts.overdue} overdue` : null,
                `${counts.today} due today`,
              ]
                .filter(Boolean)
                .join(' · ')
            : undefined
        }
        actions={
          <>
            <Button variant="outline" size="icon" asChild aria-label="Task statistics">
              <Link to="stats">
                <BarChart3 />
              </Link>
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus /> New task
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          aria-label="List"
          value={listParam}
          onChange={(v) => setParam('list', v === 'all' ? null : v)}
          options={[{ value: 'all', label: 'All' }, ...allLists.map((l) => ({ value: l.id, label: l.name }))]}
        />
        <button
          type="button"
          aria-pressed={mine}
          onClick={() => setParam('mine', mine ? null : '1')}
          className={cn(
            'h-10 rounded-full border px-4 text-sm font-medium transition-colors',
            mine ? 'border-primary bg-accent text-accent-foreground' : 'bg-card text-muted-foreground hover:bg-muted',
          )}
        >
          Assigned to me
        </button>
      </div>

      <QuickAdd listId={currentList?.id ?? allLists.find((l) => l.kind === 'joint')?.id} />

      <Card className="mt-4 p-2 sm:p-3">
        {open.isPending || lists.isPending ? (
          <ListSkeleton rows={5} className="p-3" />
        ) : open.error ? (
          <ErrorState error={open.error} onRetry={() => open.refetch()} />
        ) : SECTION_ORDER.every((s) => !sections[s]?.length) ? (
          <EmptyState
            icon={CheckCircle2}
            title="All clear"
            description={mine ? 'Nothing is assigned to you right now.' : 'Nothing to do here. Enjoy it.'}
          />
        ) : (
          SECTION_ORDER.map((section) =>
            sections[section]?.length ? (
              <section key={section} aria-labelledby={`sec-${section}`} className="mb-2 last:mb-0">
                <h2
                  id={`sec-${section}`}
                  className={cn(
                    'px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground',
                    section === 'overdue' && 'text-destructive',
                  )}
                >
                  {SECTION_LABELS[section]} <span className="font-normal">· {sections[section].length}</span>
                </h2>
                <ul>
                  {sections[section].map((o) => (
                    <TaskRow
                      key={o.id}
                      occurrence={o}
                      lists={allLists}
                      categories={allCategories}
                      showList={listParam === 'all'}
                      onOpen={() => setParam('task', o.task_id)}
                      onToggle={() => complete.mutate({ occurrenceId: o.id })}
                    />
                  ))}
                </ul>
              </section>
            ) : null,
          )
        )}
      </Card>

      {recentDone.length ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowDone(!showDone)}
            aria-expanded={showDone}
            className="flex items-center gap-1.5 px-1 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={cn('size-4 transition-transform', !showDone && '-rotate-90')} />
            Completed this week · {recentDone.length}
          </button>
          {showDone ? (
            <Card className="mt-2 p-2 sm:p-3">
              <ul>
                {recentDone.map((o) => (
                  <TaskRow
                    key={o.id}
                    done
                    occurrence={o}
                    lists={allLists}
                    categories={allCategories}
                    showList={listParam === 'all'}
                    onOpen={() => setParam('task', o.task_id)}
                    onToggle={() => reopen.mutate(o.id)}
                  />
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      ) : null}

      <NewTaskDialog open={creating} onOpenChange={setCreating} defaultListId={currentList?.id} />
      <TaskDetailDialog taskId={openTaskId} onClose={() => setParam('task', null)} />
    </>
  )
}

export function NewTaskDialog({
  open,
  onOpenChange,
  defaultListId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultListId?: string
}) {
  const create = useCreateTask()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="New task" className="sm:max-w-xl">
        {open ? (
          <TaskForm
            defaultListId={defaultListId}
            submitLabel="Add task"
            busy={create.isPending}
            onCancel={() => onOpenChange(false)}
            onSubmit={(input) => create.mutate(input, { onSuccess: () => onOpenChange(false) })}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

/** One-line add: type and press Enter. Uses the list's default assignee. */
export function QuickAdd({ listId, placeholder }: { listId: string | undefined; placeholder?: string }) {
  const lists = useTaskLists().data ?? []
  const create = useCreateTask()
  const [title, setTitle] = useState('')
  const list = lists.find((l) => l.id === listId)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!title.trim() || !list) return
        create.mutate(
          {
            title: title.trim(),
            list_id: list.id,
            assignee_id: list.owner_id,
            due_date: null,
            due_time: null,
            priority: 'normal',
            category_id: null,
            description: null,
            recurrence: null,
          },
          { onSuccess: () => setTitle('') },
        )
      }}
      className="relative"
    >
      <Plus className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        aria-label="Quick add task"
        placeholder={placeholder ?? (list ? `Add to ${list.name}…` : 'Add a task…')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="h-11 rounded-full pl-10"
        maxLength={200}
        disabled={!list || create.isPending}
      />
    </form>
  )
}
