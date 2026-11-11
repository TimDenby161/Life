import { ChevronDown, Search, TrendingDown, TrendingUp } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { formatDay, todayISO } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { LEAGUES, winRate } from '../../../../supabase/functions/_shared/tableTennis.ts'
import { type TtProfile, useAddRanking, useLive, useRankings, useSaveProfile, useSearchPlayers, useSnapshots } from '../api'
import { progressSince } from '../lib/progress'

const onError = (e: unknown) => toast.error(getErrorMessage(e))

/** Find a player on TT Leagues by name; `onPick` gets their id and name. Used to say who you are, and to add players you coach. */
export function PlayerSearch({ placeholder, action, onPick, busy }: { placeholder: string; action: string; onPick: (p: { ttUserId: string; name: string }) => void; busy?: boolean }) {
  const [q, setQ] = useState('')
  const search = useSearchPlayers()
  const found = search.data?.status === 'ok' ? search.data.players : []
  return (
    <div className="grid gap-2">
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (q.trim().length >= 2) search.mutate(q.trim())
        }}
      >
        <Input aria-label={placeholder} placeholder={placeholder} className="h-9" maxLength={60} value={q} onChange={(e) => setQ(e.target.value)} />
        <Button type="submit" size="icon" variant="outline" aria-label="Search" disabled={q.trim().length < 2 || search.isPending}>
          <Search />
        </Button>
      </form>
      {search.isPending ? <p className="text-sm text-muted-foreground">Looking through the leagues…</p> : null}
      {search.data?.status === 'error' ? <p className="text-sm text-destructive">{search.data.message}</p> : null}
      {search.data?.status === 'ok' && !found.length ? <p className="text-sm text-muted-foreground">Nobody by that name this season.</p> : null}
      {found.length ? (
        <ul className="divide-y rounded-lg border">
          {found.map((p) => (
            <li key={p.ttUserId} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{p.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{p.where.join(' · ')}</span>
              </span>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => onPick(p)}>
                {action}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** National ranking, typed in monthly (the monthly task asks for it), with the change since last time. */
function Ranking({ profile, mine }: { profile: TtProfile; mine: boolean }) {
  const rankings = useRankings()
  const add = useAddRanking()
  const [text, setText] = useState('')
  const rows = (rankings.data ?? []).filter((r) => r.user_id === profile.user_id)
  const [latest, previous] = rows
  const change = latest && previous ? previous.ranking - latest.ranking : null
  const value = Number(text)
  const ok = Number.isInteger(value) && value >= 1 && value <= 100000

  return (
    <Card className="p-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">National ranking</h2>
        {latest ? <span className="text-xs text-muted-foreground">{formatDay(latest.on_date)}</span> : null}
      </div>
      <div className="mt-1 flex items-center gap-3">
        <span className="text-2xl font-semibold tabular">{latest ? `#${latest.ranking}` : '—'}</span>
        {change ? (
          <span className={cn('inline-flex items-center gap-1 text-sm', change > 0 ? 'text-success' : 'text-destructive')}>
            {change > 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
            {change > 0 ? `up ${change}` : `down ${-change}`}
          </span>
        ) : null}
        {mine ? (
          <form
            className="ml-auto flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              if (ok) add.mutate({ ranking: value, rating: null, taskId: profile.ranking_task_id }, { onSuccess: () => setText(''), onError })
            }}
          >
            <Input aria-label="This month’s ranking" placeholder="New" inputMode="numeric" className="h-8 w-20" value={text} onChange={(e) => setText(e.target.value)} />
            <Button type="submit" size="sm" variant="outline" disabled={!ok || add.isPending}>
              Save
            </Button>
          </form>
        ) : null}
      </div>
    </Card>
  )
}

/** Your record in each league this season, how it has moved over about four weeks, and the league table with your team in it. */
function Leagues({ ttUserId }: { ttUserId: string }) {
  const live = useLive()
  const snapshots = useSnapshots()
  const [open, setOpen] = useState<string | null>(null)
  const today = todayISO()

  if (live.isPending) return <ListSkeleton rows={3} />
  if (live.error) return <ErrorState error={live.error} onRetry={() => void live.refetch()} />
  if (live.data.status !== 'ok') return <Card className="p-3 text-sm text-muted-foreground">{live.data.message}</Card>
  const { records, tables } = live.data
  const mine = LEAGUES.filter((l) => l.playing).flatMap((l) => records.filter((r) => r.ttUserId === ttUserId && r.league === l.key).map((r) => ({ league: l, r })))
  if (!mine.length) return <Card className="p-3 text-sm text-muted-foreground">No league games found for you this season yet.</Card>

  return (
    <div className="grid gap-2">
      {mine.map(({ league, r }) => {
        const rate = winRate(r.won, r.played)
        const moved = progressSince(snapshots.data ?? [], ttUserId, r.league, r, today)
        const table = tables.find((t) => t.league === r.league && t.divisionId === r.divisionId)?.rows ?? []
        const isOpen = open === r.league
        return (
          <Card key={r.league}>
            <button type="button" aria-expanded={isOpen} className="flex w-full items-center gap-3 p-3 text-left" onClick={() => setOpen(isOpen ? null : r.league)}>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{league.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{r.division} · {r.team}</span>
              </span>
              <span className="text-right">
                <span className="block text-lg font-semibold tabular">{r.won}–{r.lost}</span>
                <span className="block text-xs text-muted-foreground tabular">
                  {rate === null ? '—' : `${rate}%`}
                  {moved && moved.ratePoints ? <span className={moved.ratePoints > 0 ? 'text-success' : 'text-destructive'}> {moved.ratePoints > 0 ? '+' : ''}{moved.ratePoints}</span> : null}
                </span>
              </span>
              <ChevronDown className={cn('size-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
            </button>
            {isOpen ? (
              <CardContent className="border-t px-3 pb-3 pt-2 sm:px-3">
                {table.length ? (
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr>
                        <th className="w-6 py-1 text-left font-normal">#</th>
                        <th className="py-1 text-left font-normal">Team</th>
                        <th className="w-8 py-1 text-right font-normal">P</th>
                        <th className="w-10 py-1 text-right font-normal">W-L</th>
                        <th className="w-10 py-1 text-right font-normal">Pts</th>
                      </tr>
                    </thead>
                    <tbody className="tabular">
                      {table.map((s) => (
                        <tr key={s.team} className={cn('border-t', s.team === r.team && 'font-semibold text-primary')}>
                          <td className="py-1">{s.position}</td>
                          <td className="max-w-0 truncate py-1">{s.team}</td>
                          <td className="py-1 text-right">{s.played}</td>
                          <td className="py-1 text-right">{s.won}-{s.lost}</td>
                          <td className="py-1 text-right">{s.points}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-sm text-muted-foreground">No league table yet.</p>
                )}
                {moved ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Since {formatDay(moved.since)}: {moved.wins} won of {moved.games}.
                  </p>
                ) : null}
              </CardContent>
            ) : null}
          </Card>
        )
      })}
      <p className="text-xs text-muted-foreground">From TT Leagues, this season. Tap a league for its table.</p>
    </div>
  )
}

/** Playing: your national ranking, then your record and team's table in each league. First, say which player you are. */
export function Playing({ profiles }: { profiles: TtProfile[] }) {
  const { me } = useHousehold()
  const save = useSaveProfile()
  const mineRow = profiles.find((p) => p.user_id === me.id) ?? null
  const profile = mineRow?.tt_user_id ? mineRow : (profiles.find((p) => p.tt_user_id) ?? null)

  if (!profile?.tt_user_id) {
    return (
      <Card>
        <CardHeader className="p-3 pb-1 sm:p-3 sm:pb-1">
          <CardTitle>Which player are you?</CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 sm:px-3">
          <PlayerSearch
            placeholder="Your name"
            action="This is me"
            busy={save.isPending}
            onPick={(p) => save.mutate({ ttUserId: p.ttUserId, name: p.name, existing: mineRow }, { onError, onSuccess: () => toast.success('Added a monthly task to update your ranking') })}
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-2">
      <Ranking profile={profile} mine={profile.user_id === me.id} />
      <Leagues ttUserId={profile.tt_user_id} />
    </div>
  )
}
