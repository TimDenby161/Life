import { CheckCircle2, ChevronDown, ChevronUp, MessageSquarePlus, Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input, NativeSelect } from '@/components/ui/input'
import { Progress, Segmented } from '@/components/ui/misc'
import { addDaysISO, todayISO } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { Composer } from '@/modules/feed/components/FeedItems'
import { useBalances, usePots } from '@/modules/finances/hooks'
import { nextTarget } from '@/modules/finances/lib/pots'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { TaskDetailDialog } from '@/modules/tasks/components/TaskDetail'
import { useTaskOpener } from '@/modules/tasks/components/useTaskOpener'
import { TaskRow } from '@/modules/tasks/components/TaskRow'
import { useCompleteOccurrence, useCreateTask, useOpenOccurrences, useTaskCategories, useTaskLists } from '@/modules/tasks/hooks'
import { inView, TOGETHER } from '@/modules/tasks/lib/owner'
import { isOutOfHours, topJobs } from '@/modules/tasks/lib/topJobs'
import { waitingOnTitle } from '@/modules/tasks/lib/waiting'
import type { OccurrenceWithTask } from '@/modules/tasks/api'

/** Open tasks for one view: what a person could do, or what takes both of us. Waiting and out-of-hours tasks stay off Home. */
function useOccurrencesFor(view: string) {
  const open = useOpenOccurrences()
  const lists = useTaskLists().data ?? []
  const categories = useTaskCategories().data ?? []
  const items = open.data?.filter((o) => inView(o.task, view, categories, lists) && !waitingOnTitle(o.task, open.data) && !isOutOfHours(o.task, categories))
  return { open, items }
}

/** Me, together, then my partner. */
function useViewOptions() {
  const { me, partner } = useHousehold()
  return [
    { value: me.id, label: me.display_name },
    ...(partner ? [{ value: TOGETHER, label: 'Together' }, { value: partner.id, label: partner.display_name }] : []),
  ]
}

export default function DashboardPage() {
  const [composing, setComposing] = useState(false)
  const [adding, setAdding] = useState(false)

  return (
    <div className="grid grid-cols-1 gap-5">
      <h1 className="sr-only">Home</h1>
      <PotTiles />

      {adding ? <AddTask onAdded={() => setAdding(false)} /> : null}

      <TopJobsCard adding={adding} onToggleAdding={() => setAdding(!adding)} onMessage={() => setComposing(true)} />

      <Dialog open={composing} onOpenChange={setComposing}>
        <DialogContent title="New message">
          <Composer compact autoFocus onPosted={() => setComposing(false)} />
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * Adding from Home always asks who, which category and when. A person's task
 * goes on their own list (so it shows as theirs); joint ones on the joint list.
 */
function AddTask({ onAdded }: { onAdded: () => void }) {
  const { members } = useHousehold()
  const lists = useTaskLists().data ?? []
  const categories = useTaskCategories().data ?? []
  const create = useCreateTask()
  const today = todayISO()
  const [title, setTitle] = useState('')
  const [who, setWho] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [dueDate, setDueDate] = useState('')

  // An owned category is always its owner's, so picking one picks the person too.
  const pickCategory = (id: string) => {
    setCategoryId(id)
    const owner = categories.find((c) => c.id === id)?.owner_id
    if (owner) setWho(owner)
  }
  const pickWho = (value: string) => {
    setWho(value)
    const owner = categories.find((c) => c.id === categoryId)?.owner_id
    if (owner && owner !== value) setCategoryId('')
  }
  // Before choosing who, every category; after, the shared ones plus that person's own.
  const choices = categories.filter((c) => !who || !c.owner_id || c.owner_id === who)
  const shared = who === 'joint' || who === TOGETHER
  const list = shared ? lists.find((l) => l.kind === 'joint') : lists.find((l) => l.kind === 'personal' && l.owner_id === who)
  const ready = Boolean(title.trim() && list && categoryId && dueDate)

  return (
    <Card className="grid gap-2.5 p-3">
      <form
        className="grid gap-2.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (!ready || !list) return
          create.mutate(
            {
              title: title.trim(),
              list_id: list.id,
              assignee_id: shared ? null : who,
              needs_both: who === TOGETHER,
              due_date: dueDate,
              due_time: null,
              priority: 'normal',
              category_id: categoryId,
              description: null,
              recurrence: null,
            },
            { onSuccess: onAdded },
          )
        }}
      >
        <div className="relative">
          <Plus className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="New task"
            placeholder="Add a task…"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-11 rounded-full pl-10"
            maxLength={200}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            aria-label="Who"
            size="sm"
            value={who}
            onChange={pickWho}
            options={[
              { value: 'joint', label: 'Joint' },
              { value: TOGETHER, label: 'Together' },
              ...members.map((m) => ({ value: m.id, label: m.display_name })),
            ]}
          />
          <NativeSelect
            aria-label="Category"
            className={cn('h-8 w-auto rounded-full text-sm', !categoryId && 'text-muted-foreground')}
            value={categoryId}
            onChange={(e) => pickCategory(e.target.value)}
          >
            <option value="" disabled>Category</option>
            {choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NativeSelect>
          <div className="flex items-center gap-1">
            {[
              { label: 'Today', value: today },
              { label: 'Tomorrow', value: addDaysISO(today, 1) },
            ].map((d) => (
              <Button
                key={d.label}
                type="button"
                size="sm"
                variant={dueDate === d.value ? 'secondary' : 'ghost'}
                className="h-8 rounded-full"
                aria-pressed={dueDate === d.value}
                onClick={() => setDueDate(d.value)}
              >
                {d.label}
              </Button>
            ))}
            <Input
              type="date"
              aria-label="Due date"
              className={cn('h-8 w-auto rounded-full text-sm', !dueDate && 'text-muted-foreground')}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <Button type="submit" size="sm" className="ml-auto h-8 rounded-full" disabled={!ready || create.isPending}>
            Add
          </Button>
        </div>
        {create.error ? <p className="text-sm text-destructive">{getErrorMessage(create.error)}</p> : null}
      </form>
    </Card>
  )
}

const JOBS_PER_STEP = 5

/** The open tasks that most need doing, in score order, five more at a time on request. */
function TopJobsCard({ adding, onToggleAdding, onMessage }: { adding: boolean; onToggleAdding: () => void; onMessage: () => void }) {
  const { me, partner } = useHousehold()
  const views = useViewOptions()
  const [who, setWho] = useState(me.id)
  const { open, items } = useOccurrencesFor(who)
  const lists = useTaskLists().data ?? []
  const categories = useTaskCategories().data ?? []
  const complete = useCompleteOccurrence()
  // Tasks open in place, so editing one doesn't leave Home.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const opener = useTaskOpener(categories, lists, setOpenTaskId)
  const [shown, setShown] = useState(JOBS_PER_STEP)
  const pickWho = (view: string) => {
    setWho(view)
    setShown(JOBS_PER_STEP)
  }
  const today = todayISO()
  const ranked = topJobs(items ?? [], categories, today, Infinity)
  const visible = ranked.slice(0, shown)
  const renderRows = (rows: OccurrenceWithTask[]) => (
    <ul>
      {rows.map((o) => (
        <TaskRow
          key={o.id}
          occurrence={o}
          lists={lists}
          categories={categories}
          showList
          showVotes
          onOpen={() => opener.open(o)}
          onComplete={(by, also) => complete.mutate({ occurrenceId: o.id, completedBy: by, alsoCompletedBy: also ?? undefined })}
        />
      ))}
    </ul>
  )
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top jobs</CardTitle>
        <div className="flex items-center gap-2">
          <Button size="icon-sm" variant="outline" aria-label="Message" title="Message" onClick={onMessage}>
            <MessageSquarePlus />
          </Button>
          <Button size="icon-sm" aria-label={adding ? 'Close add task' : 'Add task'} aria-expanded={adding} onClick={onToggleAdding}>
            {adding ? <X /> : <Plus />}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-2 sm:px-3">
        {partner ? (
          <Segmented aria-label="Whose top jobs" size="sm" className="mx-1 mb-2 sm:mx-2" value={who} onChange={pickWho} options={views} />
        ) : null}
        {open.isPending ? (
          <ListSkeleton rows={5} className="px-2" />
        ) : open.error ? (
          <ErrorState error={open.error} onRetry={() => open.refetch()} />
        ) : !visible.length ? (
          <p className="flex items-center gap-2 px-2 pb-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-success" /> Nothing to do
          </p>
        ) : (
          renderRows(visible)
        )}
        <div className="mt-1 flex">
          {ranked.length > shown ? (
            <Button variant="ghost" className="flex-1" onClick={() => setShown(shown + JOBS_PER_STEP)}>
              <ChevronDown /> Show more jobs
            </Button>
          ) : null}
          {shown > JOBS_PER_STEP ? (
            <Button variant="ghost" className="flex-1" onClick={() => setShown(JOBS_PER_STEP)}>
              <ChevronUp /> Show fewer jobs
            </Button>
          ) : null}
        </div>
      </CardContent>
      <TaskDetailDialog taskId={openTaskId} onClose={() => setOpenTaskId(null)} />
      {opener.dialogs}
    </Card>
  )
}

/** Each savings pot's next target (the first item not yet funded) and how far along it is. */
function usePotProgress() {
  const pots = usePots()
  const balances = useBalances()
  return useMemo(() => {
    if (!pots.data || !balances.data) return null
    return pots.data.pots.map((pot) => {
      const balance = pot.account_id ? (balances.data.get(pot.account_id) ?? 0) : 0
      const items = pots.data.items.filter((i) => i.pot_id === pot.id)
      const { item, pct } = nextTarget(balance, items)
      return { id: pot.id, name: pot.name, next: item?.name ?? null, pct, empty: !items.length }
    })
  }, [pots.data, balances.data])
}

const POT_TILES = [
  { label: 'Wedding', pot: /wedding/i },
  { label: 'Next trip', pot: /holiday/i },
  { label: 'Service', pot: /service/i },
]

function PotTiles() {
  const rows = usePotProgress()
  return (
    <div className="grid grid-cols-3 gap-3">
      {POT_TILES.map((tile) => {
        const row = rows?.find((r) => tile.pot.test(r.name))
        const pct = row && !row.empty ? row.pct : null
        return (
          <Link key={tile.label} to="/finances">
            <Card className="grid gap-2 p-3">
              <div>
                <p className="truncate text-xs text-muted-foreground">{tile.label}</p>
                <p className="text-2xl font-semibold tracking-tight tabular">{pct === null ? '—' : `${pct}%`}</p>
              </div>
              <Progress value={pct ?? 0} indicatorClassName={pct === 100 ? 'bg-success' : undefined} />
            </Card>
          </Link>
        )
      })}
    </div>
  )
}
