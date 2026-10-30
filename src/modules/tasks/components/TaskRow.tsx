import { Check, ChevronDown, ChevronUp, Clock, Flag, ListChecks, Repeat } from 'lucide-react'
import { colorOf } from '@/lib/colors'
import { todayISO } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import type { OccurrenceWithTask, TaskCategory, TaskList } from '../api'
import { useDelayOccurrence, useVoteImportance } from '../hooks'
import { delayLabel, dueLabel, dueTone } from '../lib/format'
import { ownerOf } from '../lib/owner'
import { delayDaysFor } from '../lib/topJobs'
import { useSwipeRight } from '../lib/useSwipeRight'

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
 * completes the task and records who did it. A task that belongs to one
 * person (ownerId) only offers that person.
 */
export function WhoDidIt({
  title,
  ownerId = null,
  onComplete,
  disabled,
}: {
  title: string
  ownerId?: string | null
  onComplete: (completedBy: string, alsoCompletedBy: string | null) => void
  disabled?: boolean
}) {
  const { members, me } = useHousehold()
  // Me first, so my circle is always in the same place.
  const people = members.toSorted((a, b) => Number(b.id === me.id) - Number(a.id === me.id))
  const owner = people.find((m) => m.id === ownerId)
  const options = [
    ...(owner ? [owner] : people).map((m) => ({
      key: m.id,
      letter: m.display_name.charAt(0).toUpperCase(),
      label: `${m.display_name} did ${title}`,
      by: m.id,
      also: null,
    })),
    ...(!owner && people.length === 2 ? [{ key: 'both', letter: 'B', label: `We both did ${title}`, by: people[0].id, also: people[1].id }] : []),
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

/** Two arrows: is this more or less important? Lit up whichever way the votes lean. */
export function ImportanceVote({ taskId, title, votes, className }: { taskId: string; title: string; votes: number; className?: string }) {
  const vote = useVoteImportance()
  const arrows = [
    { delta: 1, Icon: ChevronUp, label: `${title} is more important`, on: votes > 0 },
    { delta: -1, Icon: ChevronDown, label: `${title} is less important`, on: votes < 0 },
  ]
  return (
    <div className={cn('flex shrink-0', className)} role="group" aria-label={`How important is ${title}?`}>
      {arrows.map(({ delta, Icon, label, on }) => (
        <button
          key={delta}
          type="button"
          aria-label={label}
          title={label}
          onClick={(e) => {
            e.stopPropagation()
            vote.mutate({ taskId, votes: votes + delta })
          }}
          className={cn('grid h-6 w-7 place-items-center rounded-md hover:bg-muted', on ? 'text-primary' : 'text-muted-foreground/60')}
        >
          <Icon className="size-[18px]" strokeWidth={on ? 3 : 2} />
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
  showVotes = false,
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
  showVotes?: boolean
  onOpen: () => void
  onComplete?: (completedBy: string, alsoCompletedBy: string | null) => void
  onReopen?: () => void
  done?: boolean
}) {
  const { member } = useHousehold()
  const task = occurrence.task
  const completer = member(occurrence.completed_by)
  const alsoCompleter = member(occurrence.also_completed_by)
  const list = lists.find((l) => l.id === task.list_id)
  const category = categories.find((c) => c.id === task.category_id)
  const tone = done ? 'none' : dueTone(occurrence.due_date, todayISO())
  const subtasks = task.subtasks ?? []
  const subDone = subtasks.filter((s) => s.is_done).length
  const delay = useDelayOccurrence()
  const delayBy = delayDaysFor(occurrence, categories)
  const swipe = useSwipeRight(done ? undefined : () => delay(occurrence, delayBy))

  return (
    <li className="relative touch-pan-y overflow-hidden rounded-xl animate-fade-in" {...swipe.handlers}>
      {swipe.offset ? (
        <div
          aria-hidden
          className={cn(
            'absolute inset-0 flex items-center gap-2 rounded-xl px-4 text-sm font-medium',
            swipe.ready ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
          )}
        >
          <Clock className="size-4" /> {delayLabel(delayBy)}
        </div>
      ) : null}
      <div
        className={cn(
          'group relative flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5',
          swipe.offset ? 'bg-card' : 'transition-colors hover:bg-muted/60',
        )}
        style={swipe.offset ? { transform: `translateX(${swipe.offset}px)` } : undefined}
        onClick={onOpen}
      >
        {done ? <TaskCheck done onToggle={() => onReopen?.()} label={`Reopen ${task.title}`} /> : null}
        {showVotes ? <ImportanceVote taskId={occurrence.task_id} title={task.title} votes={task.importance_votes} className="-my-1 -ml-1.5 -mr-1 flex-col" /> : null}
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
        {done ? null : (
          <WhoDidIt title={task.title} ownerId={ownerOf(task, categories, lists)} onComplete={(by, also) => onComplete?.(by, also)} />
        )}
      </div>
    </li>
  )
}
