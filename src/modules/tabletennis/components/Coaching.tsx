import { ChevronDown, Plus, Trash2, UserPlus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { formatDay, todayISO } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { leagueByKey, winRate } from '../../../../supabase/functions/_shared/tableTennis.ts'
import { type TtNote, type TtPlayer, useAddNote, useAddPlayer, useDeleteNote, useDeletePlayer, useLive, useNotes, usePlayers, useSnapshots } from '../api'
import { progressSince } from '../lib/progress'
import { PlayerSearch } from './Playing'

const onError = (e: unknown) => toast.error(getErrorMessage(e))

function Notes({ player, notes, mine }: { player: TtPlayer; notes: TtNote[]; mine: boolean }) {
  const [text, setText] = useState('')
  const add = useAddNote()
  const del = useDeleteNote()
  const remove = useDeletePlayer()
  return (
    <div className="grid gap-2 border-t px-3 pb-3 pt-2">
      {mine ? (
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            if (text.trim()) add.mutate({ playerId: player.id, note: text }, { onSuccess: () => setText(''), onError })
          }}
        >
          <Input aria-label={`A note on ${player.name}`} placeholder="Add a note…" maxLength={2000} className="h-9" value={text} onChange={(e) => setText(e.target.value)} />
          <Button type="submit" size="icon" variant="outline" aria-label="Add note" disabled={!text.trim() || add.isPending}>
            <Plus />
          </Button>
        </form>
      ) : null}
      {notes.length ? (
        <ul className="grid gap-1.5">
          {notes.map((n) => (
            <li key={n.id} className="group flex gap-2 text-sm">
              <span className="w-14 shrink-0 text-xs text-muted-foreground">{formatDay(n.created_at.slice(0, 10))}</span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{n.note}</span>
              {mine ? (
                <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Delete note" onClick={() => del.mutate(n.id, { onError })}>
                  <X className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No notes yet.</p>
      )}
      {mine ? (
        <Button variant="ghost" size="sm" className="-ml-2 w-fit text-muted-foreground" onClick={() => remove.mutate(player.id, { onError })}>
          <Trash2 /> Stop following {player.name.split(' ')[0]}
        </Button>
      ) : null}
    </div>
  )
}

/**
 * Coaching: the players you coach, each with their record in every league
 * they play (JBL, Sutton, Thames Valley), how it has moved over about four
 * weeks, and your notes. Results come from TT Leagues automatically.
 */
export function Coaching() {
  const { me } = useHousehold()
  const players = usePlayers()
  const notes = useNotes()
  const live = useLive()
  const snapshots = useSnapshots()
  const add = useAddPlayer()
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const today = todayISO()

  if (players.error) return <ErrorState error={players.error} onRetry={() => void players.refetch()} />
  const records = live.data?.status === 'ok' ? live.data.records : []
  const following = new Set((players.data ?? []).map((p) => p.tt_user_id))

  return (
    <div className="grid gap-2">
      <Card className="p-3">
        {adding ? (
          <PlayerSearch
            placeholder="A player’s name"
            action="Add"
            busy={add.isPending}
            onPick={(p) =>
              following.has(p.ttUserId)
                ? toast.info(`Already following ${p.name}`)
                : add.mutate({ ttUserId: p.ttUserId, name: p.name }, { onSuccess: () => toast.success(`Following ${p.name}`), onError })
            }
          />
        ) : null}
        <Button variant={adding ? 'ghost' : 'outline'} size="sm" className={cn('w-full', adding && 'mt-2')} onClick={() => setAdding(!adding)}>
          {adding ? 'Done' : <><UserPlus /> Add a player you coach</>}
        </Button>
      </Card>

      {players.isPending ? (
        <ListSkeleton rows={3} />
      ) : !players.data.length ? (
        <Card>
          <EmptyState icon={UserPlus} title="No players yet" description="Add the players you coach. Their league results follow automatically." className="py-6" />
        </Card>
      ) : (
        players.data.map((p) => {
          const theirs = records.filter((r) => r.ttUserId === p.tt_user_id)
          const theirNotes = (notes.data ?? []).filter((n) => n.player_id === p.id)
          const isOpen = open === p.id
          return (
            <Card key={p.id}>
              <button type="button" aria-expanded={isOpen} className="flex w-full items-start gap-3 p-3 text-left" onClick={() => setOpen(isOpen ? null : p.id)}>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{p.name}</span>
                  {live.isPending ? (
                    <span className="block text-xs text-muted-foreground">Loading results…</span>
                  ) : theirs.length ? (
                    theirs.map((r) => {
                      const moved = progressSince(snapshots.data ?? [], p.tt_user_id, r.league, r, today)
                      const rate = winRate(r.won, r.played)
                      return (
                        <span key={r.league} className="flex items-baseline gap-2 text-xs">
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">{leagueByKey(r.league)?.label} · {r.team}</span>
                          <span className="tabular">{r.won}–{r.lost}{rate === null ? '' : ` · ${rate}%`}</span>
                          {moved?.ratePoints ? (
                            <span className={cn('w-8 text-right tabular', moved.ratePoints > 0 ? 'text-success' : 'text-destructive')}>
                              {moved.ratePoints > 0 ? '+' : ''}{moved.ratePoints}
                            </span>
                          ) : <span className="w-8" />}
                        </span>
                      )
                    })
                  ) : (
                    <span className="block text-xs text-muted-foreground">No league games this season yet.</span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-1 pt-0.5 text-xs text-muted-foreground">
                  {theirNotes.length ? theirNotes.length : null}
                  <ChevronDown className={cn('size-4 transition-transform', isOpen && 'rotate-180')} />
                </span>
              </button>
              {isOpen ? <Notes player={p} notes={theirNotes} mine={p.user_id === me.id} /> : null}
            </Card>
          )
        })
      )}
      {players.data?.length ? <p className="text-xs text-muted-foreground">Win rate change (in points) over about four weeks, from snapshots saved each day you look.</p> : null}
    </div>
  )
}
