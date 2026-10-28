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
import { colorOf } from '@/lib/colors'
import { todayISO } from '@/lib/dates'
import { cn, groupBy } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import type { OccurrenceWithTask, TaskCategory } from '../api'
import { TaskDetailDialog } from '../components/TaskDetail'
import { TaskForm } from '../components/TaskForm'
import { TaskRow } from '../components/TaskRow'
import { ownerOf } from '../lib/owner'
import { useCollapsedGroups } from '../lib/useCollapsedGroups'
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

type Group = {
  key: string
  label: string
  dot?: string
  danger?: boolean
  items: OccurrenceWithTask[]
}

/** Every category in name order (empty ones too), then anything without a category. */
function groupByCategory(items: OccurrenceWithTask[], categories: TaskCategory[]): Group[] {
  const byCategory = groupBy(items, (o) => o.task.category_id ?? '')
  const groups: Group[] = categories.map((c) => ({
    key: c.id,
    label: c.name,
    dot: colorOf(c.color).dot,
    items: byCategory[c.id] ?? [],
  }))
  // A category that isn't loaded yet (or was deleted) falls in with the uncategorised ones.
  const known = new Set(categories.map((c) => c.id))
  const rest = items.filter((o) => !o.task.category_id || !known.has(o.task.category_id))
  if (rest.length) groups.push({ key: 'none', label: 'No category', items: rest })
  return groups
}

function TaskListView() {
  const { members } = useHousehold()
  const [params, setParams] = useSearchParams()
  // 'joint', or a member's id for the tasks that are only ever theirs.
  const whoParam = params.get('who')
  const who = members.some((m) => m.id === whoParam) ? whoParam! : 'joint'
  const groupMode = params.get('group') === 'date' ? 'date' : 'category'
  const openTaskId = params.get('task')

  const lists = useTaskLists()
  const categories = useTaskCategories()
  const open = useOpenOccurrences()
  const done = useRecentlyDone(7)
  const complete = useCompleteOccurrence()
  const reopen = useReopenOccurrence()
  const [creating, setCreating] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const { collapsed, toggle: toggleGroup } = useCollapsedGroups('life.tasks.collapsed')

  const setParam = (key: string, value: string | null) =>
    setParams(
      (p) => {
        if (value === null) p.delete(key)
        else p.set(key, value)
        return p
      },
      { replace: key !== 'task' },
    )

  const allLists = lists.data ?? []
  const allCategories = categories.data ?? []
  // Joint tasks can still be assigned to someone; a person's own are the ones
  // in a category they own or on their personal list.
  const filter = (o: OccurrenceWithTask) => (ownerOf(o.task, allCategories, allLists) ?? 'joint') === who

  const today = todayISO()
  const visible = useMemo(
    () => (open.data ?? []).filter(filter).toSorted(compareOccurrences),
    [open.data, who, allCategories, allLists],
  )
  const sections = useMemo(() => groupBy(visible, (o) => sectionOf(o.due_date, today)), [visible, today])
  const recentDone = (done.data ?? []).filter(filter)

  const counts = {
    today: sections.today?.length ?? 0,
    overdue: sections.overdue?.length ?? 0,
  }
  // New tasks land where the filter will show them: a person's own list, otherwise the joint one.
  const addList = allLists.find((l) => l.kind === 'personal' && l.owner_id === who) ?? allLists.find((l) => l.kind === 'joint')
  // Joint shows the shared categories; a person sees their own plus any shared one holding their personal tasks.
  const shownCategories =
    who === 'joint'
      ? allCategories.filter((c) => !c.owner_id)
      : allCategories.filter((c) => c.owner_id === who || (!c.owner_id && visible.some((o) => o.task.category_id === c.id)))
  const groups: Group[] =
    groupMode === 'category'
      ? groupByCategory(visible, shownCategories)
      : SECTION_ORDER.filter((s) => sections[s]?.length).map((s) => ({
          key: s,
          label: SECTION_LABELS[s],
          danger: s === 'overdue',
          items: sections[s],
        }))

  return (
    <>
      <PageHeader
        title="Tasks"
        description={
          open.data
            ? [counts.overdue ? `${counts.overdue} overdue` : null, `${counts.today} due today`]
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
          aria-label="Whose tasks"
          value={who}
          onChange={(v) => setParam('who', v === 'joint' ? null : v)}
          options={[
            { value: 'joint', label: 'Joint' },
            ...members.map((m) => ({ value: m.id, label: m.display_name })),
          ]}
        />
        <Segmented
          aria-label="Group by"
          className="ml-auto"
          value={groupMode}
          onChange={(v) => setParam('group', v === 'category' ? null : v)}
          options={[
            { value: 'category', label: 'Category' },
            { value: 'date', label: 'Date' },
          ]}
        />
      </div>

      <QuickAdd listId={addList?.id} />

      <Card className="mt-4 p-2 sm:p-3">
        {open.isPending || lists.isPending ? (
          <ListSkeleton rows={5} className="p-3" />
        ) : open.error ? (
          <ErrorState error={open.error} onRetry={() => open.refetch()} />
        ) : !groups.length ? (
          <EmptyState
            icon={CheckCircle2}
            title="All clear"
            description="Nothing to do here. Enjoy it."
          />
        ) : (
          groups.map((group) => {
            const isCollapsed = collapsed.has(group.key)
            return (
              <section key={group.key} aria-labelledby={`sec-${group.key}`} className="mb-2 last:mb-0">
                <h2 id={`sec-${group.key}`}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    aria-expanded={!isCollapsed}
                    className={cn(
                      'flex w-full items-center gap-1.5 rounded-lg px-3 pb-1 pt-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground',
                      group.danger && 'text-destructive hover:text-destructive',
                    )}
                  >
                    <ChevronDown className={cn('size-3.5 transition-transform', isCollapsed && '-rotate-90')} />
                    {group.dot ? <span className={cn('size-2 rounded-full', group.dot)} /> : null}
                    {group.label} <span className="font-normal">· {group.items.length}</span>
                  </button>
                </h2>
                {isCollapsed ? null : !group.items.length ? (
                  <p className="px-3 pb-2 pl-8 text-sm text-muted-foreground">No tasks</p>
                ) : (
                  <ul>
                    {group.items.map((o) => (
                      <TaskRow
                        key={o.id}
                        occurrence={o}
                        lists={allLists}
                        categories={allCategories}
                        showList
                        showCategory={groupMode !== 'category'}
                        onOpen={() => setParam('task', o.task_id)}
                        onToggle={() => complete.mutate({ occurrenceId: o.id })}
                      />
                    ))}
                  </ul>
                )}
              </section>
            )
          })
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
                    showList
                    onOpen={() => setParam('task', o.task_id)}
                    onToggle={() => reopen.mutate(o.id)}
                  />
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      ) : null}

      <NewTaskDialog open={creating} onOpenChange={setCreating} defaultListId={addList?.id} />
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
