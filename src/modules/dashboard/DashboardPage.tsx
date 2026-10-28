import { format, formatDistanceToNow } from 'date-fns'
import { ArrowRight, CalendarDays, CheckCircle2, ChevronDown, HeartPulse, MessageSquarePlus, MessagesSquare, Wallet } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Avatar } from '@/components/Avatar'
import { ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Progress, Segmented } from '@/components/ui/misc'
import { colorOf } from '@/lib/colors'
import { addDaysISO, formatDay, greeting, monthStart, parseISODate, todayISO } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { useCalendarEvents, useCalendarIntegrations } from '@/modules/calendar/api'
import { bucketByDay, formatEventTime } from '@/modules/calendar/lib/grid'
import { ActivityRow, Composer } from '@/modules/feed/components/FeedItems'
import { useFeedEvents, useMyReads, usePosts } from '@/modules/feed/hooks'
import { groupActivity } from '@/modules/feed/lib/activity'
import { useAccountCurrency, useBalances, useAccounts, useBudgets, useGoals, useTransactions } from '@/modules/finances/hooks'
import { activeBudgets, goalProgress, netWorth, spendingByCategory } from '@/modules/finances/lib/calc'
import { useMeasurements, useMetricDefinitions, useExerciseSessions } from '@/modules/health/api'
import { formatValue } from '@/modules/health/lib/metrics'
import { studyLinkFor, useStudy } from '@/modules/languages/api'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { TaskDetailDialog } from '@/modules/tasks/components/TaskDetail'
import { TaskRow } from '@/modules/tasks/components/TaskRow'
import { useCompleteOccurrence, useOpenOccurrences, useTaskCategories, useTaskLists } from '@/modules/tasks/hooks'
import { compareOccurrences } from '@/modules/tasks/lib/format'
import { ownerOf } from '@/modules/tasks/lib/owner'
import type { OccurrenceWithTask } from '@/modules/tasks/api'
import { useCollapsedGroups } from '@/modules/tasks/lib/useCollapsedGroups'
import { categorySubgroups, QuickAdd } from '@/modules/tasks/pages/TasksPage'

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
  const lists = useTaskLists().data ?? []
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

      <QuickAdd listId={lists.find((l) => l.kind === 'joint')?.id} placeholder="Quick add a joint task…" />

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
        <MessagesCard />
        <FinanceCard />
        <ActivityCard />
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
          days.map(({ day, slot, label, items: dayItems }) => {
            const isOpen = expanded.has(day)
            return (
              <section key={day} aria-labelledby={`day-${day}`} className="mb-1 last:mb-0">
                <h2 id={`day-${day}`}>
                  <button
                    type="button"
                    onClick={() => toggle(day)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center gap-1.5 rounded-lg px-3 pb-1 pt-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
                  >
                    <ChevronDown className={cn('size-3.5 transition-transform', !isOpen && '-rotate-90')} />
                    {label} <span className="font-normal">· {dayItems.length}</span>
                  </button>
                </h2>
                {!isOpen ? null : !dayItems.length ? (
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
                    const isCollapsed = collapsed.has(subKey)
                    return (
                      <div key={sub.key} className="pl-4">
                        <h3>
                          <button
                            type="button"
                            onClick={() => toggleCategory(subKey)}
                            aria-expanded={!isCollapsed}
                            className="flex w-full items-center gap-1.5 rounded-lg px-3 pb-1 pt-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
                          >
                            <ChevronDown className={cn('size-3.5 transition-transform', isCollapsed && '-rotate-90')} />
                            {sub.dot ? <span className={cn('size-2 rounded-full', sub.dot)} /> : null}
                            {sub.label} <span className="font-normal">· {sub.items.length}</span>
                          </button>
                        </h3>
                        {isCollapsed ? null : renderRows(sub.items, false)}
                      </div>
                    )
                  }) ?? renderRows(dayItems, true))
                )}
              </section>
            )
          })
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

function MessagesCard() {
  const { member, me } = useHousehold()
  const posts = usePosts()
  const reads = useMyReads()
  const latest = (posts.data ?? []).slice(0, 3)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Messages</CardTitle>
        <CardLink to="/feed" label="Feed" />
      </CardHeader>
      <CardContent>
        {posts.isPending ? (
          <ListSkeleton rows={2} />
        ) : !latest.length ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><MessagesSquare className="size-4" /> No messages yet.</p>
        ) : (
          <ul className="grid gap-3">
            {latest.map((p) => {
              const a = member(p.author_id)
              const unread = p.author_id !== me.id && reads.data && !reads.data.has(p.id)
              return (
                <li key={p.id} className="flex gap-2.5">
                  <Avatar name={a?.display_name} color={a?.avatar_color} size="sm" />
                  <div className="min-w-0 text-sm">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{a?.display_name}</span> · {formatDistanceToNow(new Date(p.created_at), { addSuffix: true })}
                      {unread ? <span className="ml-1.5 inline-block size-1.5 rounded-full bg-rose-500 align-middle" aria-label="Unread" /> : null}
                    </p>
                    <p className="line-clamp-2 break-words">{p.body}</p>
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

function FinanceCard() {
  const { household } = useHousehold()
  const accounts = useAccounts()
  const balances = useBalances()
  const transactions = useTransactions()
  const budgets = useBudgets()
  const goals = useGoals()
  const accountCurrency = useAccountCurrency()
  const currency = household.default_currency
  const today = todayISO()
  const month = monthStart(today)

  const content = useMemo(() => {
    if (!accounts.data || !balances.data || !transactions.data) return null
    const nw = netWorth(accounts.data, balances.data).find((n) => n.currency === currency)
    const spend = spendingByCategory(transactions.data, accountCurrency, currency, month, today)
    const spent = [...spend.values()].reduce((a, b) => a + b, 0)
    const active = activeBudgets((budgets.data ?? []).filter((b) => b.currency === currency), month)
    const budgetTotal = active.reduce((a, b) => a + b.amount_minor, 0)
    // Compare budgets only with spending in budgeted categories.
    const budgetedSpent = active.reduce((a, b) => a + (spend.get(b.category_id) ?? 0), 0)
    const goal = (goals.data ?? []).find((g) => !g.reached_at)
    return { nw, spent, budgetTotal, budgetedSpent, goal, goalP: goal ? goalProgress(goal, balances.data) : null }
  }, [accounts.data, balances.data, transactions.data, budgets.data, goals.data, accountCurrency, currency, month, today])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Money</CardTitle>
        <CardLink to="/finances" label="Finances" />
      </CardHeader>
      <CardContent>
        {!content ? (
          <ListSkeleton rows={2} />
        ) : !accounts.data?.length ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Wallet className="size-4" /> No accounts yet. <Link to="/finances" className="text-primary">Add one</Link></p>
        ) : (
          <div className="grid gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Net worth</p>
              <p className="text-2xl font-semibold tracking-tight tabular">{formatMoney(content.nw?.total ?? 0, currency, { hidePence: true })}</p>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Spent in {format(new Date(), 'MMMM')}</span>
              <span className="tabular">{formatMoney(content.spent, currency, { hidePence: true })}</span>
            </div>
            {content.budgetTotal ? (
              <div>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-muted-foreground">Budgets</span>
                  <span className="tabular">
                    {formatMoney(content.budgetedSpent, currency, { hidePence: true })}
                    <span className="text-muted-foreground"> of {formatMoney(content.budgetTotal, currency, { hidePence: true })}</span>
                  </span>
                </div>
                <Progress value={(content.budgetedSpent / content.budgetTotal) * 100} indicatorClassName={content.budgetedSpent > content.budgetTotal ? 'bg-destructive' : undefined} />
              </div>
            ) : null}
            {content.goal && content.goalP ? (
              <div>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-muted-foreground">{content.goal.name}</span>
                  <span className="tabular">{content.goalP.pct}%</span>
                </div>
                <Progress value={content.goalP.pct} />
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ActivityCard() {
  const events = useFeedEvents(30)
  const groups = groupActivity(events.data ?? []).slice(0, 5)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardLink to="/feed" label="Feed" />
      </CardHeader>
      <CardContent className="pt-0">
        {events.isPending ? <ListSkeleton rows={3} /> : !groups.length ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : <ul className="divide-y">{groups.map((g) => <ActivityRow key={g.key} group={g} />)}</ul>}
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
