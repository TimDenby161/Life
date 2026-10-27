import { format, formatDistanceToNow } from 'date-fns'
import { Archive, Check, ChevronDown, Pencil, Repeat, SkipForward, Trash2, Undo2, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Avatar } from '@/components/Avatar'
import { ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Badge, Checkbox } from '@/components/ui/misc'
import { colorOf } from '@/lib/colors'
import { formatDateTime, formatDay, parseISODate, todayISO } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useUserId } from '@/modules/auth/AuthProvider'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import type { CompletionEvent } from '../api'
import {
  useCommentMutations,
  useCompleteOccurrence,
  useDeleteTask,
  useMoveOccurrence,
  useReopenOccurrence,
  useSkipOccurrence,
  useSubtaskMutations,
  useTaskCategories,
  useTaskDetail,
  useTaskLists,
  useUpdateTask,
} from '../hooks'
import { dueLabel, dueTone } from '../lib/format'
import { describeRecurrence, parseRecurrence, upcomingOccurrences } from '../lib/recurrence'
import { TaskForm } from './TaskForm'

export function TaskDetailDialog({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  const [editing, setEditing] = useState(false)
  const detail = useTaskDetail(taskId)
  const update = useUpdateTask()
  const title = detail.data?.task?.title ?? 'Task'

  return (
    <Dialog
      open={Boolean(taskId)}
      onOpenChange={(open) => {
        if (!open) {
          setEditing(false)
          onClose()
        }
      }}
    >
      <DialogContent title={editing ? 'Edit task' : title} className="sm:max-w-xl">
        {detail.isPending ? (
          <ListSkeleton rows={4} />
        ) : detail.error ? (
          <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
        ) : !detail.data.task ? (
          <p className="py-6 text-center text-sm text-muted-foreground">This task no longer exists.</p>
        ) : editing ? (
          <TaskForm
            initial={detail.data.task}
            submitLabel="Save changes"
            busy={update.isPending}
            onCancel={() => setEditing(false)}
            onSubmit={(input) =>
              update.mutate({ id: detail.data.task!.id, patch: input }, { onSuccess: () => setEditing(false) })
            }
          />
        ) : (
          <TaskDetailBody data={detail.data as Required<typeof detail.data>} onEdit={() => setEditing(true)} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  )
}

type DetailData = NonNullable<ReturnType<typeof useTaskDetail>['data']>

function TaskDetailBody({ data, onEdit, onClose }: { data: DetailData; onEdit: () => void; onClose: () => void }) {
  const task = data.task!
  const { member, members, me } = useHousehold()
  const lists = useTaskLists().data ?? []
  const categories = useTaskCategories().data ?? []
  const complete = useCompleteOccurrence()
  const skip = useSkipOccurrence()
  const reopen = useReopenOccurrence()
  const move = useMoveOccurrence()
  const update = useUpdateTask()
  const del = useDeleteTask()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const occ = data.openOccurrence
  const rule = parseRecurrence(task.recurrence)
  const list = lists.find((l) => l.id === task.list_id)
  const category = categories.find((c) => c.id === task.category_id)
  const assignee = member(occ?.assignee_id ?? task.assignee_id)
  const today = todayISO()
  const tone = dueTone(occ?.due_date ?? null, today)
  const lastCompletion = data.events.find((e) => e.event_type === 'completed')
  const upcoming = rule && !rule.afterDone && occ?.due_date ? upcomingOccurrences(rule, task.due_date!, occ.due_date, 4).slice(1) : []

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-1.5">
        {list ? <Badge tone="outline">{list.name}</Badge> : null}
        {assignee ? (
          <Badge tone="neutral" className="pl-0.5">
            <Avatar name={assignee.display_name} color={assignee.avatar_color} size="xs" />
            {assignee.display_name}
          </Badge>
        ) : (
          <Badge tone="neutral">Anyone</Badge>
        )}
        {occ?.due_date ? (
          <Badge tone={tone === 'overdue' ? 'danger' : tone === 'today' ? 'warning' : 'neutral'}>
            {tone === 'overdue' ? 'Overdue · ' : ''}
            {dueLabel(occ.due_date, occ.due_time)}
          </Badge>
        ) : null}
        {category ? (
          <Badge tone="neutral">
            <span className={cn('size-1.5 rounded-full', colorOf(category.color).dot)} />
            {category.name}
          </Badge>
        ) : null}
        {task.priority !== 'normal' ? <Badge tone={task.priority === 'low' ? 'neutral' : 'warning'}>{task.priority}</Badge> : null}
      </div>

      {rule ? (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Repeat className="mt-0.5 size-4 shrink-0" />
          <span>
            {describeRecurrence(rule, task.due_date!)}
            {upcoming.length ? <> · then {upcoming.map((d) => formatDay(d)).join(', ')}</> : null}
          </span>
        </p>
      ) : null}

      {task.description ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{task.description}</p> : null}

      {/* Primary actions */}
      <div className="flex flex-wrap gap-2">
        {occ ? (
          <>
            <div className="flex">
              <Button
                className="rounded-r-none"
                disabled={complete.isPending}
                onClick={() => complete.mutate({ occurrenceId: occ.id }, { onSuccess: () => !rule && onClose() })}
              >
                <Check /> Mark done
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="rounded-l-none border-l border-primary-foreground/20 px-2.5" aria-label="Mark done by someone else">
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>Who did it?</DropdownMenuLabel>
                  {members.map((m) => (
                    <DropdownMenuItem key={m.id} onSelect={() => complete.mutate({ occurrenceId: occ.id, completedBy: m.id })}>
                      <Avatar name={m.display_name} color={m.avatar_color} size="xs" />
                      {m.id === me.id ? 'I did' : `${m.display_name} did`}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {rule ? (
              <Button variant="outline" disabled={skip.isPending} onClick={() => skip.mutate(occ.id, { onSuccess: () => toast('Skipped this time') })}>
                <SkipForward /> Skip
              </Button>
            ) : null}
            {rule && occ.due_date ? (
              <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                Move this one to
                <Input
                  type="date"
                  className="h-10 w-auto"
                  value={occ.due_date}
                  onChange={(e) => e.target.value && move.mutate({ id: occ.id, dueDate: e.target.value })}
                />
              </label>
            ) : null}
            {!rule ? (
              <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <label className="inline-flex items-center gap-2">
                  Due
                  <Input
                    type="date"
                    className="h-10 w-auto"
                    value={task.due_date ?? ''}
                    disabled={update.isPending}
                    onChange={(e) => e.target.value && update.mutate({ id: task.id, patch: { due_date: e.target.value } })}
                  />
                </label>
                {task.due_date ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={update.isPending}
                    onClick={() => update.mutate({ id: task.id, patch: { due_date: null, due_time: null } })}
                  >
                    No date
                  </Button>
                ) : null}
              </div>
            ) : null}
          </>
        ) : lastCompletion ? (
          <Button variant="outline" disabled={reopen.isPending} onClick={() => reopen.mutate(lastCompletion.occurrence_id)}>
            <Undo2 /> Reopen
          </Button>
        ) : null}
      </div>

      <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        Category
        <NativeSelect
          aria-label="Category"
          className="h-10 w-auto"
          value={task.category_id ?? ''}
          disabled={update.isPending}
          // An owned category also reassigns the task (the database sees to that).
          onChange={(e) => update.mutate({ id: task.id, patch: { category_id: e.target.value || null } })}
        >
          <option value="">None</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
      </label>

      <Subtasks taskId={task.id} subtasks={data.subtasks} />
      <Comments taskId={task.id} comments={data.comments} />
      <History events={data.events} />

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
        <p className="text-xs text-muted-foreground">
          Added by {member(task.created_by)?.display_name ?? 'someone'} {formatDistanceToNow(new Date(task.created_at), { addSuffix: true })}
        </p>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil /> Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              update.mutate(
                { id: task.id, patch: { archived_at: new Date().toISOString() } },
                { onSuccess: () => { toast('Archived. History is kept for statistics.'); onClose() } },
              )
            }
          >
            <Archive /> Archive
          </Button>
          <Button
            variant={confirmDelete ? 'destructive' : 'ghost'}
            size="sm"
            onClick={() => {
              if (!confirmDelete) return setConfirmDelete(true)
              del.mutate(task.id, { onSuccess: () => { toast('Task deleted'); onClose() } })
            }}
          >
            <Trash2 /> {confirmDelete ? 'Tap again to delete' : 'Delete'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function Subtasks({ taskId, subtasks }: { taskId: string; subtasks: DetailData['subtasks'] }) {
  const { add, toggle, remove } = useSubtaskMutations(taskId)
  const [title, setTitle] = useState('')
  return (
    <section aria-label="Subtasks" className="grid gap-1.5">
      <h3 className="text-sm font-semibold">Subtasks</h3>
      <ul className="grid gap-0.5">
        {subtasks.map((s) => (
          <li key={s.id} className="group flex items-center gap-2.5 rounded-lg px-1 py-1">
            <Checkbox
              checked={s.is_done}
              onCheckedChange={(v) => toggle.mutate({ id: s.id, isDone: v === true })}
              aria-label={s.title}
            />
            <span className={cn('flex-1 text-sm', s.is_done && 'text-muted-foreground line-through')}>{s.title}</span>
            <button
              type="button"
              className="rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 focus:opacity-100"
              aria-label={`Remove ${s.title}`}
              onClick={() => remove.mutate(s.id)}
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!title.trim()) return
          add.mutate({ title: title.trim(), sortOrder: subtasks.length }, { onSuccess: () => setTitle('') })
        }}
      >
        <Input placeholder="Add a subtask" value={title} onChange={(e) => setTitle(e.target.value)} className="h-9" maxLength={200} />
      </form>
    </section>
  )
}

function Comments({ taskId, comments }: { taskId: string; comments: DetailData['comments'] }) {
  const { member } = useHousehold()
  const userId = useUserId()
  const { add, remove } = useCommentMutations(taskId)
  const [body, setBody] = useState('')
  return (
    <section aria-label="Comments" className="grid gap-2">
      <h3 className="text-sm font-semibold">Comments</h3>
      {comments.map((c) => {
        const author = member(c.author_id)
        return (
          <div key={c.id} className="group flex gap-2.5">
            <Avatar name={author?.display_name} color={author?.avatar_color} size="sm" />
            <div className="min-w-0 flex-1 rounded-xl bg-muted/60 px-3 py-2">
              <p className="text-xs text-muted-foreground">
                {author?.display_name} · {formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}
                {c.author_id === userId ? (
                  <button type="button" className="ml-2 hover:text-destructive" onClick={() => remove.mutate(c.id)}>
                    Delete
                  </button>
                ) : null}
              </p>
              <p className="whitespace-pre-wrap text-sm">{c.body}</p>
            </div>
          </div>
        )
      })}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!body.trim()) return
          add.mutate(body.trim(), { onSuccess: () => setBody('') })
        }}
      >
        <Textarea rows={1} placeholder="Add a comment" value={body} onChange={(e) => setBody(e.target.value)} className="min-h-10" maxLength={2000} />
        <Button type="submit" variant="secondary" disabled={!body.trim() || add.isPending}>
          Post
        </Button>
      </form>
    </section>
  )
}

function History({ events }: { events: CompletionEvent[] }) {
  const { member } = useHousehold()
  if (!events.length) return null
  const verb = { completed: 'completed', skipped: 'Skipped', reopened: 'Reopened' } as const
  return (
    <section aria-label="History" className="grid gap-1.5">
      <h3 className="text-sm font-semibold">History</h3>
      <ol className="grid gap-1 text-sm">
        {events.slice(0, 12).map((e) => {
          const who = member(e.completed_by)
          const recorder = member(e.recorded_by)
          return (
            <li key={e.id} className="flex items-baseline gap-2 text-muted-foreground">
              <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', e.event_type === 'completed' ? 'bg-success' : 'bg-muted-foreground/40')} />
              <span>
                {e.event_type === 'completed' ? (
                  <>
                    <span className="font-medium text-foreground">{who?.display_name ?? 'Someone'}</span> completed
                    {e.due_date ? <> · due {format(parseISODate(e.due_date), 'EEE d MMM')}</> : null}
                    {recorder && recorder.id !== who?.id ? <> (recorded by {recorder.display_name})</> : null}
                  </>
                ) : (
                  <>
                    {verb[e.event_type as keyof typeof verb] ?? e.event_type}
                    {e.due_date ? <> · due {format(parseISODate(e.due_date), 'EEE d MMM')}</> : null}
                  </>
                )}
                <span className="ml-1.5 text-xs">{formatDateTime(e.occurred_at)}</span>
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
