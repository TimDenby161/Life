import { format, formatDistanceToNow } from 'date-fns'
import { ArrowRight, CalendarDays, CheckCircle2, HeartPulse, MessageSquarePlus, MessagesSquare, Plus, Wallet } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Avatar } from '@/components/Avatar'
import { ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input, NativeSelect } from '@/components/ui/input'
import { Progress, Segmented } from '@/components/ui/misc'
import { colorOf } from '@/lib/colors'
import { addDaysISO, formatDay, greeting, parseISODate, todayISO } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useCalendarEvents, useCalendarIntegrations } from '@/modules/calendar/api'
import { bucketByDay, formatEventTime } from '@/modules/calendar/lib/grid'
import { ActivityRow, Composer } from '@/modules/feed/components/FeedItems'
import { useFeedEvents, useMyReads, usePosts } from '@/modules/feed/hooks'
import { type ActivityGroup, groupActivity } from '@/modules/feed/lib/activity'
import { useBalances, usePots } from '@/modules/finances/hooks'
import { nextTarget } from '@/modules/finances/lib/pots'
import { useMeasurements, useMetricDefinitions, useExerciseSessions } from '@/modules/health/api'
import { formatValue } from '@/modules/health/lib/metrics'
import { studyLinkFor, useStudy } from '@/modules/languages/api'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { TaskGroup } from '@/modules/tasks/components/GroupToggle'
import { TaskDetailDialog } from '@/modules/tasks/components/TaskDetail'
import { TaskRow } from '@/modules/tasks/components/TaskRow'
import { useCompleteOccurrence, useCreateTask, useOpenOccurrences, useTaskCategories, useTaskLists } from '@/modules/tasks/hooks'
import { compareOccurrences } from '@/modules/tasks/lib/format'
import { ownerOf } from '@/modules/tasks/lib/owner'
import type { OccurrenceWithTask } from '@/modules/tasks/api'
import { useCollapsedGroups } from '@/modules/tasks/lib/useCollapsedGroups'
import { categorySubgroups } from '@/modules/tasks/pages/TasksPage'

/**
 * Open occurrences that are this person's own (Tasks page ownership rule),
 * plus the joint ones when `withJoint` is set.
 */
function useOccurrencesFor(personId: string, withJoint = true) {
  const open = useOpenOccurrences()
  const lists = useTaskLists().data ?? []
  const categories = useTaskCategories().data ?? []
  const items = open.data?.filter((o) => {
    const owner = ownerOf(o.task, categories, lists)
    return owner === personId || (withJoint && owner === null)
  })
  return { open, items }
}

export default function DashboardPage() {
  const { me, partner } = useHousehold()
  // Mine + joint by default; the partner view is only their own tasks.
  const [who, setWho] = useState(me.id)
  const { open, items } = useOccurrencesFor(who, who === me.id)
  const today = todayISO()
  const dueToday = (items ?? []).filter((o) => o.due_date === today)
  const overdue = (items ?? []).filter((o) => o.due_date && o.due_date < today)
  const [composing, setComposing] = useState(false)

  const summary = open.data
    ? [
        dueToday.length ? `${dueToday.length} ${dueToday.length === 1 ? 'task' : 'tasks'} due today` : 'Nothing due today',
        overdue.length ? `${overdue.length} overdue` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : ' '

  return (
    <div className="grid gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{format(new Date(), 'EEEE d MMMM')}</p>
          <h1 className="text-[28px] font-semibold tracking-tight sm:text-3xl">
            {greeting()}, {me.display_name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
        </div>
        <Button variant="outline" onClick={() => setComposing(true)}>
          <MessageSquarePlus /> Message
        </Button>
      </header>

      <AddTask />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <DaysCard
          open={open}
          items={items}
          filter={
            partner ? (
              <Segmented
                aria-label="Whose tasks"
                size="sm"
                className="mx-1 mb-2 sm:mx-2"
                value={who}
                onChange={setWho}
                options={[
                  { value: me.id, label: `${me.display_name} + Joint` },
                  { value: partner.id, label: partner.display_name },
                ]}
              />
            ) : null
          }
        />
        <UpcomingCard />
        <FeedCard />
        <FinanceCard />
        <HealthCard />
      </div>

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
function AddTask() {
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
  const list = who === 'joint' ? lists.find((l) => l.kind === 'joint') : lists.find((l) => l.kind === 'personal' && l.owner_id === who)
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
              assignee_id: who === 'joint' ? null : who,
              due_date: dueDate,
              due_time: null,
              priority: 'normal',
              category_id: categoryId,
              description: null,
              recurrence: null,
            },
            {
              onSuccess: () => {
                setTitle('')
                setWho('')
                setCategoryId('')
                setDueDate('')
              },
            },
          )
        }}
      >
        <div className="relative">
          <Plus className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="New task"
            placeholder="Add a task…"
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
            options={[{ value: 'joint', label: 'Joint' }, ...members.map((m) => ({ value: m.id, label: m.display_name }))]}
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

function CardLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
      {label} <ArrowRight className="size-3" />
    </Link>
  )
}

/**
 * Today (including overdue), tomorrow and the day after, each collapsible and
 * split into collapsible categories; only Today starts open.
 */
function DaysCard({ open, items, filter }: ReturnType<typeof useOccurrencesFor> & { filter: ReactNode }) {
  const lists = useTaskLists().data ?? []
  const categories = useTaskCategories().data ?? []
  const complete = useCompleteOccurrence()
  // Tasks open in place, so editing one doesn't leave Home; language tasks go to their study.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const study = useStudy().data ?? []
  const navigate = useNavigate()
  const today = todayISO()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([today]))
  // Category groups start open; collapsing one is remembered (per day slot: today / tomorrow / day after).
  const { collapsed, toggle: toggleCategory } = useCollapsedGroups('life.home.collapsed')
  const toggle = (day: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(day)) next.add(day)
      return next
    })
  const renderRows = (rows: OccurrenceWithTask[], showCategory: boolean) => (
    <ul>
      {rows.map((o) => (
        <TaskRow
          key={o.id}
          occurrence={o}
          lists={lists}
          categories={categories}
          showList
          showCategory={showCategory}
          onOpen={() => {
            const link = studyLinkFor({ ...o.task, id: o.task_id }, o.assignee_id, study, categories)
            if (link) navigate(link)
            else setOpenTaskId(o.task_id)
          }}
          onComplete={(by, also) => complete.mutate({ occurrenceId: o.id, completedBy: by, alsoCompletedBy: also ?? undefined })}
        />
      ))}
    </ul>
  )
  const days = [0, 1, 2].map((i) => {
    const day = addDaysISO(today, i)
    return {
      day,
      slot: ['today', 'tomorrow', 'later'][i],
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : format(parseISODate(day), 'EEEE'),
      items: (items ?? [])
        .filter((o) => o.due_date && (i === 0 ? o.due_date <= today : o.due_date === day))
        .toSorted(compareOccurrences),
    }
  })
  return (
    <Card className="md:row-span-2">
      <CardHeader>
        <CardTitle>Tasks</CardTitle>
        <CardLink to="/tasks" label="All tasks" />
      </CardHeader>
      <CardContent className="px-2 sm:px-3">
        {filter}
        {open.isPending ? (
          <ListSkeleton rows={4} className="px-2" />
        ) : open.error ? (
          <ErrorState error={open.error} onRetry={() => open.refetch()} />
        ) : (
          days.map(({ day, slot, label, items: dayItems }) => (
            <TaskGroup
              key={day}
              id={`day-${day}`}
              level={1}
              label={label}
              count={dayItems.length}
              open={expanded.has(day)}
              onToggle={() => toggle(day)}
            >
              {!dayItems.length ? (
                day === today ? (
                  <p className="flex items-center gap-2 px-3 pb-2 pl-8 text-sm text-muted-foreground">
                    <CheckCircle2 className="size-4 text-success" /> Nothing due today
                  </p>
                ) : (
                  <p className="px-3 pb-2 pl-8 text-sm text-muted-foreground">No tasks</p>
                )
              ) : (
                (categorySubgroups(dayItems, categories)?.map((sub) => {
                  const subKey = `${slot}/${sub.key}`
                  return (
                    <TaskGroup
                      key={sub.key}
                      id={`day-${subKey}`}
                      level={2}
                      label={sub.label}
                      count={sub.items.length}
                      dot={sub.dot}
                      open={!collapsed.has(subKey)}
                      onToggle={() => toggleCategory(subKey)}
                    >
                      {renderRows(sub.items, false)}
                    </TaskGroup>
                  )
                }) ?? renderRows(dayItems, true))
              )}
            </TaskGroup>
          ))
        )}
      </CardContent>
      <TaskDetailDialog taskId={openTaskId} onClose={() => setOpenTaskId(null)} />
    </Card>
  )
}

function UpcomingCard() {
  const integrations = useCalendarIntegrations()
  const connected = Boolean(integrations.data?.some((i) => i.enabled && i.mode === 'service_account'))
  const today = todayISO()
  const end = addDaysISO(today, 6)
  const events = useCalendarEvents(today, end, connected)
  const open = useOpenOccurrences()
  const result = events.data
  const byDay = useMemo(() => bucketByDay(result?.status === 'ok' ? result.events : []), [result])
  const days = Array.from({ length: 7 }, (_, i) => addDaysISO(today, i))
  const tasksAhead = (open.data ?? []).filter((o) => o.due_date && o.due_date > today && o.due_date <= end)
  const hasEvents = days.some((d) => byDay.get(d)?.length)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Next 7 days</CardTitle>
        <CardLink to="/calendar" label="Calendar" />
      </CardHeader>
      <CardContent className="grid gap-2">
        {!connected && !integrations.isPending ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <CalendarDays className="size-3.5" /> Google Calendar not connected. <Link to="/settings#calendar" className="text-primary">Set up</Link>
          </p>
        ) : events.isPending && connected ? (
          <ListSkeleton rows={3} />
        ) : result && result.status !== 'ok' ? (
          <p className="text-xs text-muted-foreground">Calendar unavailable: {result.message}</p>
        ) : null}
        {hasEvents ? (
          <ul className="grid gap-1.5">
            {days.flatMap((d) =>
              (byDay.get(d) ?? []).slice(0, 3).map((e) => (
                <li key={`${d}-${e.id}`} className="flex items-center gap-2.5 text-sm">
                  <span className={cn('h-7 w-1 shrink-0 rounded-full', colorOf(e.color).dot)} />
                  <span className="min-w-0">
                    <span className="block truncate">{e.title}</span>
                    <span className="block text-xs text-muted-foreground">{formatDay(d)} · {formatEventTime(e, d)}</span>
                  </span>
                </li>
              )),
            ).slice(0, 6)}
          </ul>
        ) : connected && result?.status === 'ok' ? (
          <p className="text-sm text-muted-foreground">No events this week.</p>
        ) : null}
        {tasksAhead.length ? (
          <p className="text-xs text-muted-foreground">
            {tasksAhead.length} {tasksAhead.length === 1 ? 'task' : 'tasks'} due later this week
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** Messages and activity together, newest first, as on the Feed page. */
function FeedCard() {
  const { member, me } = useHousehold()
  const posts = usePosts()
  const reads = useMyReads()
  const events = useFeedEvents(30)
  type Entry = { at: string } & ({ kind: 'post'; post: NonNullable<typeof posts.data>[number] } | { kind: 'activity'; group: ActivityGroup })
  const entries: Entry[] = [
    ...(posts.data ?? []).slice(0, 6).map((post) => ({ kind: 'post' as const, at: post.created_at, post })),
    ...groupActivity(events.data ?? []).slice(0, 6).map((group) => ({ kind: 'activity' as const, at: group.latestAt, group })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 6)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Feed</CardTitle>
        <CardLink to="/feed" label="Open feed" />
      </CardHeader>
      <CardContent className="pt-0">
        {posts.isPending || events.isPending ? (
          <ListSkeleton rows={3} />
        ) : !entries.length ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><MessagesSquare className="size-4" /> Nothing yet.</p>
        ) : (
          <ul className="divide-y">
            {entries.map((e) => {
              if (e.kind === 'activity') return <ActivityRow key={e.group.key} group={e.group} />
              const p = e.post
              const a = member(p.author_id)
              const unread = p.author_id !== me.id && reads.data && !reads.data.has(p.id)
              return (
                <li key={p.id} className="flex gap-3 px-1 py-2">
                  <Avatar name={a?.display_name} color={a?.avatar_color} size="sm" className="mt-0.5 size-7" />
                  <div className="min-w-0 text-sm">
                    <p className="line-clamp-2 break-words">{p.body}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{a?.display_name}</span> · {formatDistanceToNow(new Date(p.created_at), { addSuffix: true })}
                      {unread ? <span className="ml-1.5 inline-block size-1.5 rounded-full bg-rose-500 align-middle" aria-label="Unread" /> : null}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

const HIDDEN_POTS = /service charge/i

/** Each savings pot's next target (the first item not yet funded) and how far along it is. */
function FinanceCard() {
  const pots = usePots()
  const balances = useBalances()

  const rows = useMemo(() => {
    if (!pots.data || !balances.data) return null
    // Service charge is a bill being saved for, not a goal; it stays on the Finances page.
    return pots.data.pots.filter((pot) => !HIDDEN_POTS.test(pot.name)).map((pot) => {
      const balance = pot.account_id ? (balances.data.get(pot.account_id) ?? 0) : 0
      const items = pots.data.items.filter((i) => i.pot_id === pot.id)
      const { item, pct } = nextTarget(balance, items)
      return { id: pot.id, name: pot.name, next: item?.name ?? null, pct, empty: !items.length }
    })
  }, [pots.data, balances.data])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Money</CardTitle>
        <CardLink to="/finances" label="Finances" />
      </CardHeader>
      <CardContent>
        {!rows ? (
          <ListSkeleton rows={2} />
        ) : !rows.length ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Wallet className="size-4" /> No savings pots yet. <Link to="/finances" className="text-primary">Add one</Link></p>
        ) : (
          <div className="grid gap-4">
            {rows.map((r) => (
              <div key={r.id}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.empty ? 'No targets yet' : r.next ? `Next: ${r.next}` : 'Every target reached'}
                    </p>
                  </div>
                  <span className="shrink-0 text-xl font-semibold tracking-tight tabular">{r.empty ? '—' : `${r.pct}%`}</span>
                </div>
                <Progress value={r.pct} indicatorClassName={!r.next && !r.empty ? 'bg-success' : undefined} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** Latest health records from both of you. */
function HealthCard() {
  const { member, me } = useHousehold()
  const measurements = useMeasurements()
  const defs = useMetricDefinitions()
  const exercise = useExerciseSessions()
  const defById = new Map((defs.data ?? []).map((d) => [d.id, d]))
  type Item = { id: string; key: string; at: string; userId: string; text: string }
  const items: Item[] = [
    ...(measurements.data ?? []).slice(-40).flatMap((m) => {
      const d = defById.get(m.metric_id)
      return d ? [{ id: m.id, key: `${m.user_id}:${m.metric_id}`, at: m.measured_at, userId: m.user_id, text: `${d.name} ${formatValue(Number(m.value), d.decimals)} ${d.unit}` }] : []
    }),
    ...(exercise.data ?? []).slice(0, 10).map((s) => ({ id: s.id, key: `${s.user_id}:exercise`, at: s.started_at, userId: s.user_id, text: `Exercise · ${s.duration_minutes} min` })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    // One line per person+metric keeps it a glance, not a log.
    .filter((item, i, all) => all.findIndex((x) => x.key === item.key) === i)
    .slice(0, 5)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Health</CardTitle>
        <CardLink to="/health" label="Health" />
      </CardHeader>
      <CardContent>
        {measurements.isPending ? (
          <ListSkeleton rows={3} />
        ) : !items.length ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><HeartPulse className="size-4" /> Nothing logged recently.</p>
        ) : (
          <ul className="grid gap-2.5">
            {items.map((i) => {
              const who = member(i.userId)
              return (
                <li key={i.id} className="flex items-center gap-2.5 text-sm">
                  <Avatar name={who?.display_name} color={who?.avatar_color} size="xs" />
                  <span className="min-w-0 flex-1 truncate">{i.text}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{i.userId === me.id ? '' : `${who?.display_name} · `}{formatDistanceToNow(new Date(i.at), { addSuffix: true })}</span>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
