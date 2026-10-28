import { Check, Flag, ListChecks, Repeat } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { colorOf } from '@/lib/colors'
import { todayISO } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import type { OccurrenceWithTask, TaskCategory, TaskList } from '../api'
import { dueLabel, dueTone } from '../lib/format'

export function TaskCheck({
  done,
  onToggle,
  label,
  disabled,
}: {
  done: boolean
  onToggle: () => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      className={cn(
        'group/check -m-2 grid size-10 shrink-0 place-items-center rounded-full disabled:opacity-50',
      )}
    >
      <span
        className={cn(
          'grid size-[22px] place-items-center rounded-full border-2 transition-all',
          done
            ? 'border-success bg-success text-white'
            : 'border-muted-foreground/40 text-transparent group-hover/check:border-success group-hover/check:text-success/60',
        )}
      >
        <Check className="size-3.5" strokeWidth={3} />
      </span>
    </button>
  )
}

const toneClass = {
  overdue: 'text-destructive font-medium',
  today: 'text-warning font-medium',
  soon: 'text-foreground/80',
  later: 'text-muted-foreground',
  none: 'text-muted-foreground',
}

export function TaskRow({
  occurrence,
  lists,
  categories,
  showList,
  showCategory = true,
  onOpen,
  onToggle,
  done = false,
}: {
  occurrence: OccurrenceWithTask
  lists: TaskList[]
  categories: TaskCategory[]
  showList?: boolean
  showCategory?: boolean
  onOpen: () => void
  onToggle: () => void
  done?: boolean
}) {
  const { member } = useHousehold()
  const task = occurrence.task
  const assignee = member(occurrence.assignee_id)
  const completer = member(occurrence.completed_by)
  const alsoCompleter = member(occurrence.also_completed_by)
  const list = lists.find((l) => l.id === task.list_id)
  const category = categories.find((c) => c.id === task.category_id)
  const tone = done ? 'none' : dueTone(occurrence.due_date, todayISO())
  const subtasks = task.subtasks ?? []
  const subDone = subtasks.filter((s) => s.is_done).length

  return (
    <li
      className="group flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/60 animate-fade-in"
      onClick={onOpen}
    >
      <TaskCheck done={done} onToggle={onToggle} label={done ? `Reopen ${task.title}` : `Complete ${task.title}`} />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className={cn('block w-full truncate text-left text-[15px] leading-snug', done && 'text-muted-foreground line-through decoration-muted-foreground/40')}
          onClick={(e) => {
            e.stopPropagation()
            onOpen()
          }}
        >
          {task.title}
        </button>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
          {done && completer ? (
            <span>
              Done by {completer.display_name}
              {alsoCompleter ? ` & ${alsoCompleter.display_name}` : ''}
            </span>
          ) : null}
          {!done && occurrence.due_date ? (
            <span className={toneClass[tone]}>
              {tone === 'overdue' ? 'Overdue · ' : ''}
              {dueLabel(occurrence.due_date, occurrence.due_time)}
            </span>
          ) : null}
          {task.recurrence ? (
            <span className="inline-flex items-center gap-1" title="Repeats">
              <Repeat className="size-3" />
              <span className="sr-only">Repeats</span>
            </span>
          ) : null}
          {showList && list ? <span>{list.name}</span> : null}
          {showCategory && category ? (
            <span className="inline-flex items-center gap-1">
              <span className={cn('size-1.5 rounded-full', colorOf(category.color).dot)} />
              {category.name}
            </span>
          ) : null}
          {subtasks.length ? (
            <span className="inline-flex items-center gap-1">
              <ListChecks className="size-3" />
              {subDone}/{subtasks.length}
            </span>
          ) : null}
          {task.priority === 'high' || task.priority === 'urgent' ? (
            <span className={cn('inline-flex items-center gap-1', task.priority === 'urgent' ? 'text-destructive' : 'text-warning')}>
              <Flag className="size-3" />
              {task.priority === 'urgent' ? 'Urgent' : 'High'}
            </span>
          ) : null}
        </div>
      </div>
      {assignee ? (
        <span className="flex items-center" title={`Assigned to ${assignee.display_name}`}>
          <Avatar name={assignee.display_name} color={assignee.avatar_color} size="sm" />
          <span className="sr-only">Assigned to {assignee.display_name}</span>
        </span>
      ) : null}
    </li>
  )
}
