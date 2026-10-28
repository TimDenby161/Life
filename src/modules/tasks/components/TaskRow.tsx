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

/**
 * One circle per person (their initial) plus B for both of us: tapping one
 * completes the task and records who did it.
 */
export function WhoDidIt({
  title,
  onComplete,
  disabled,
}: {
  title: string
  onComplete: (completedBy: string, alsoCompletedBy: string | null) => void
  disabled?: boolean
}) {
  const { members, me } = useHousehold()
  // Me first, so my circle is always in the same place.
  const people = members.toSorted((a, b) => Number(b.id === me.id) - Number(a.id === me.id))
  const options = [
    ...people.map((m) => ({ key: m.id, letter: m.display_name.charAt(0).toUpperCase(), label: `${m.display_name} did ${title}`, by: m.id, also: null })),
    ...(people.length === 2 ? [{ key: 'both', letter: 'B', label: `We both did ${title}`, by: people[0].id, also: people[1].id }] : []),
  ]
  return (
    <div className="-my-1 flex shrink-0 items-center gap-1" role="group" aria-label={`Who did ${title}?`}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-label={o.label}
          title={o.label}
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation()
            onComplete(o.by, o.also)
          }}
          className="grid size-7 place-items-center rounded-full border-2 border-muted-foreground/40 text-[11px] font-semibold text-muted-foreground transition-all hover:border-success hover:bg-success hover:text-white disabled:opacity-50"
        >
          {o.letter}
        </button>
      ))}
    </div>
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
  onComplete,
  onReopen,
  done = false,
}: {
  occurrence: OccurrenceWithTask
  lists: TaskList[]
  categories: TaskCategory[]
  showList?: boolean
  showCategory?: boolean
  onOpen: () => void
  onComplete?: (completedBy: string, alsoCompletedBy: string | null) => void
  onReopen?: () => void
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
      {done ? (
        <TaskCheck done onToggle={() => onReopen?.()} label={`Reopen ${task.title}`} />
      ) : (
        <WhoDidIt title={task.title} onComplete={(by, also) => onComplete?.(by, also)} />
      )}
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
