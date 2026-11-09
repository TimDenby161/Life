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
import { useAiPicks } from '@/modules/agents/api'
import { aiFirst, canDoAnywhere, todaysPlan } from '@/modules/agents/lib/aiOrder'
import { awayToday, freeMinutesToday } from '@/modules/agents/lib/away'
import { useCalendarEvents, useCalendarIntegrations } from '@/modules/calendar/api'
import { useBalances, usePots } from '@/modules/finances/hooks'
import { nextTarget } from '@/modules/finances/lib/pots'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { TaskDetailDialog } from '@/modules/tasks/components/TaskDetail'
import { useTaskOpener } from '@/modules/tasks/components/useTaskOpener'
import { TaskRow } from '@/modules/tasks/components/TaskRow'
import { useCompleteOccurrence, useCreateTask, useOpenOccurrences, useTaskCategories, useTaskLists } from '@/modules/tasks/hooks'
import { inView, TOGETHER } from '@/modules/tasks/lib/owner'
import { isOutOfHours, taskScore, topJobs } from '@/modules/tasks/lib/topJobs'
import { waitingOnTitle } from '@/modules/tasks/lib/waiting'
import type { OccurrenceWithTask } from '@/modules/tasks/api'
import { MAX_PLAN_MINUTES } from '../../../supabase/functions/_shared/agents/priorities.ts'
import { estimateMinutes, formatMinutes } from '../../../supabase/functions/_shared/agents/taskManager.ts'

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

type Place = 'home' | 'out'

/**
 * A tab's At home / Out choice for today, when someone has changed it from
 * what the calendar says. Remembered on this device until midnight.
 */
function useOutOverride(today: string): [(tab: string) => Place | undefined, (tab: string, place: Place) => void] {
  const read = (): Record<string, Place> => {
    try {
      const saved = JSON.parse(localStorage.getItem('life.place') ?? '{}') as { day?: string; tabs?: Record<string, Place> }
      return saved.day === today ? (saved.tabs ?? {}) : {}
    } catch {
      return {}
    }
  }
  const [tabs, setTabs] = useState(read)
  const set = (tab: string, place: Place) => {
    const next = { ...read(), [tab]: place }
    setTabs(next)
    try {
      localStorage.setItem('life.place', JSON.stringify({ day: today, tabs: next }))
    } catch {
      // Private browsing: it just won't be remembered.
    }
  }
  return [(tab) => tabs[tab], set]
}

/** Jobs swiped away today on this device. */
function useSwipedToday(today: string): [Set<string>, (id: string) => void] {
  const read = (): string[] => {
    try {
      const saved = JSON.parse(localStorage.getItem('life.swiped') ?? '{}') as { day?: string; ids?: string[] }
      return saved.day === today ? (saved.ids ?? []) : []
    } catch {
      return []
    }
  }
  const [ids, setIds] = useState(read)
  const mark = (id: string) => {
    const next = [...new Set([...read(), id])]
    setIds(next)
    try {
      localStorage.setItem('life.swiped', JSON.stringify({ day: today, ids: next }))
    } catch {
      // Private browsing: it just won't be remembered.
    }
  }
  return [new Set(ids), mark]
}

/** The open tasks that most need doing: today's AI picks first, then score order, five more at a time on request (or a fixed few when compact). */
export function TopJobsCard({
  title = 'Top jobs',
  adding = false,
  onToggleAdding,
  onMessage,
  limit,
  footer,
}: {
  title?: string
  adding?: boolean
  onToggleAdding?: () => void
  onMessage?: () => void
  /** Show just this many, with a Show all to open the rest (Home, to fit one screen). */
  limit?: number
  /** Anything else to show at the foot of the card (Home: what the agents flagged). */
  footer?: React.ReactNode
}) {
  const { me, partner, members } = useHousehold()
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
  // Compact (with a limit): closed shows `limit`, open shows everything recommended for today.
  const [expanded, setExpanded] = useState(false)
  const pickWho = (view: string) => {
    setWho(view)
    setShown(JOBS_PER_STEP)
    setExpanded(false)
  }
  const today = todayISO()
  // A score of 0 means nothing needs doing yet, so it stays off the list.
  // This tab's AI picks for today go first, then the usual score order.
  const picks = useAiPicks(today).data?.get(who)
  // Out when the calendar says this tab's person is away today (either of us, for Together), unless changed by hand.
  const integrations = useCalendarIntegrations().data ?? []
  const calendar = useCalendarEvents(today, today).data
  const events = calendar?.status === 'ok' ? calendar.events : []
  const away = (id: string) => awayToday(events, integrations, id, today)
  const awayNow = who === TOGETHER ? members.some((m) => away(m.id)) : away(who)
  const [placeFor, setPlace] = useOutOverride(today)
  const [swiped, markSwiped] = useSwipedToday(today)
  const out = (placeFor(who) ?? (awayNow ? 'out' : 'home')) === 'out'
  const scored = topJobs(items ?? [], categories, today, Infinity)
  const ai = aiFirst(scored, picks)
  const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.name
  // Together jobs need you both there: none while either of you is out.
  const togetherOff = who === TOGETHER && out
  const ranked = togetherOff
    ? []
    : ai.items
        .filter((o) => ai.notes.has(o.task_id) || taskScore(o, categories, today) > 0)
        // Swiped today (put off until tomorrow) leaves today's list; Undo brings its date, and it, back.
        .filter((o) => !(swiped.has(o.id) && o.due_date && o.due_date > today))
        .filter((o) => !out || canDoAnywhere(o.task.title, categoryName(o.task.category_id), ai.where.get(o.task_id)))
  const awayNames = members.filter((m) => away(m.id)).map((m) => (m.id === me.id ? 'you' : m.display_name))
  // Compact (Home): only what fits the free time left today, from the calendar: the AI's plan, or the rules' pick.
  // Paid work (C4) happens in work time, so it takes none of it.
  const jobMinutes = (o: OccurrenceWithTask) =>
    /^c4\b/i.test(categoryName(o.task.category_id) ?? '') ? 0 : estimateMinutes(o.task.title, categoryName(o.task.category_id), o.task.duration_minutes)
  const freeNow = Math.min(MAX_PLAN_MINUTES, freeMinutesToday(events, integrations, who === TOGETHER ? members.map((m) => m.id) : [who], today))
  const plan = limit
    ? todaysPlan(ranked, picks?.length ? new Set(ai.notes.keys()) : null, (o) => taskScore(o, categories, today), jobMinutes, freeNow)
    : ranked
  const planMinutes = plan.reduce((sum, o) => sum + jobMinutes(o), 0)
  const visible = plan.slice(0, limit ? (expanded ? plan.length : limit) : shown)
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
          aiNote={ai.notes.get(o.task_id)}
          swipeDays={limit ? 1 : undefined}
          onSwiped={() => markSwiped(o.id)}
          onOpen={() => opener.open(o)}
          onComplete={(by, also) => complete.mutate({ occurrenceId: o.id, completedBy: by, alsoCompletedBy: also ?? undefined })}
        />
      ))}
    </ul>
  )
  return (
    <Card>
      <CardHeader className={limit ? 'p-3 pb-1 sm:p-3 sm:pb-1' : undefined}>
        <CardTitle>{title}</CardTitle>
        <div className="flex items-center gap-2">
          {onMessage ? (
            <Button size="icon-sm" variant="outline" aria-label="Message" title="Message" onClick={onMessage}>
              <MessageSquarePlus />
            </Button>
          ) : null}
          {onToggleAdding ? (
            <Button size="icon-sm" aria-label={adding ? 'Close add task' : 'Add task'} aria-expanded={adding} onClick={onToggleAdding}>
              {adding ? <X /> : <Plus />}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className={limit ? 'px-1.5 pb-2 pt-1 sm:px-2' : 'px-2 sm:px-3'}>
        <div className="mx-1 mb-1.5 flex flex-wrap items-center justify-between gap-2 sm:mx-2">
          {partner ? <Segmented aria-label="Whose top jobs" size="sm" value={who} onChange={pickWho} options={views} /> : <span />}
          <Segmented
            aria-label="Where"
            size="sm"
            value={out ? 'out' : 'home'}
            onChange={(v) => setPlace(who, v as Place)}
            options={[
              { value: 'home', label: 'Home' },
              { value: 'out', label: 'Out' },
            ]}
          />
        </div>
        {open.isPending ? (
          <ListSkeleton rows={5} className="px-2" />
        ) : open.error ? (
          <ErrorState error={open.error} onRetry={() => open.refetch()} />
        ) : !visible.length ? (
          <p className="flex items-center gap-2 px-2 pb-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-success" />{' '}
            {togetherOff
              ? `Nothing together today${awayNames.length ? `: ${awayNames.join(' and ')} ${awayNames.length > 1 || awayNames[0] === 'you' ? 'are' : 'is'} away` : ''}`
              : limit && freeNow === 0
                ? 'No free time left today'
                : limit && picks?.length
                ? 'Today’s plan is done'
                : out
                  ? 'Nothing that can be done on a phone'
                  : 'Nothing to do'}
          </p>
        ) : (
          renderRows(visible)
        )}
        {limit && (plan.length > limit || expanded) ? (
          <Button variant="ghost" size="sm" className="h-7 w-full text-muted-foreground" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {expanded ? <><ChevronUp /> Show fewer</> : <><ChevronDown /> Show today’s {plan.length} · ~{formatMinutes(planMinutes)} of {formatMinutes(freeNow)} free</>}
          </Button>
        ) : null}
        {footer}
        <div className={limit ? 'hidden' : 'mt-1 flex'}>
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
