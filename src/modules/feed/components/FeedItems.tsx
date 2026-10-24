import { formatDistanceToNow } from 'date-fns'
import { AlertTriangle, CheckCircle2, ExternalLink, MessageCircle, MoreHorizontal, Pin, PinOff, PlusCircle, Rss, Target, Trash2, Trophy } from 'lucide-react'
import { useState } from 'react'
import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/input'
import { Badge, Skeleton } from '@/components/ui/misc'
import { formatDateTime } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { useUserId } from '@/modules/auth/AuthProvider'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import type { FeedPost } from '../api'
import { useAddComment, useCreatePost, useDeleteComment, useDeletePost, useExternalSource, useUpdatePost } from '../hooks'
import { type ActivityGroup, groupSummary } from '../lib/activity'
import type { FeedSource } from '../providers/types'

const ago = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true })

export function Composer({ autoFocus, onPosted, compact }: { autoFocus?: boolean; onPosted?: () => void; compact?: boolean }) {
  const { me } = useHousehold()
  const create = useCreatePost()
  const [body, setBody] = useState('')
  const submit = () => {
    if (!body.trim()) return
    create.mutate(body.trim(), { onSuccess: () => { setBody(''); onPosted?.() } })
  }
  return (
    <form
      className={cn('flex gap-3', !compact && 'rounded-xl border bg-card p-3 shadow-[0_1px_2px_rgb(0_0_0/0.03)]')}
      onSubmit={(e) => { e.preventDefault(); submit() }}
    >
      {!compact ? <Avatar name={me.display_name} color={me.avatar_color} /> : null}
      <div className="grid flex-1 gap-2">
        <Textarea
          aria-label="Write a message"
          placeholder="Leave a note, update or message…"
          rows={compact ? 3 : 2}
          autoFocus={autoFocus}
          value={body}
          maxLength={5000}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit() }}
          className="resize-none border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={!body.trim() || create.isPending}>Post</Button>
        </div>
      </div>
    </form>
  )
}

export function PostCard({ post, unread }: { post: FeedPost; unread: boolean }) {
  const { member } = useHousehold()
  const userId = useUserId()
  const author = member(post.author_id)
  const update = useUpdatePost()
  const del = useDeletePost()
  const addComment = useAddComment()
  const delComment = useDeleteComment()
  const [replying, setReplying] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(post.body)
  const [reply, setReply] = useState('')
  const mine = post.author_id === userId

  return (
    <Card className={cn('p-4 animate-fade-in', post.pinned_at && 'border-amber-500/40')}>
      <div className="flex items-start gap-3">
        <Avatar name={author?.display_name} color={author?.avatar_color} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">{author?.display_name ?? 'Someone'}</p>
            <time className="text-xs text-muted-foreground" dateTime={post.created_at} title={formatDateTime(post.created_at)}>{ago(post.created_at)}</time>
            {post.edited_at ? <span className="text-xs text-muted-foreground">· edited</span> : null}
            {unread ? <span className="size-2 rounded-full bg-rose-500" aria-label="Unread" /> : null}
            {post.pinned_at ? <Badge tone="warning" className="ml-auto"><Pin className="size-3" /> Pinned</Badge> : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" className={cn('-my-1 -mr-2', !post.pinned_at && 'ml-auto')} aria-label="Post options"><MoreHorizontal /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => update.mutate({ id: post.id, patch: { pinned_at: post.pinned_at ? null : new Date().toISOString() } })}>
                  {post.pinned_at ? <><PinOff /> Unpin</> : <><Pin /> Pin to top</>}
                </DropdownMenuItem>
                {mine ? <DropdownMenuItem onSelect={() => { setDraft(post.body); setEditing(true) }}>Edit</DropdownMenuItem> : null}
                {mine ? <DropdownMenuItem destructive onSelect={() => del.mutate(post.id)}><Trash2 /> Delete</DropdownMenuItem> : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {editing ? (
            <form className="mt-2 grid gap-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) update.mutate({ id: post.id, patch: { body: draft.trim() } }, { onSuccess: () => setEditing(false) }) }}>
              <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={5000} autoFocus />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
                <Button type="submit" size="sm">Save</Button>
              </div>
            </form>
          ) : (
            <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-relaxed">{post.body}</p>
          )}

          {post.comments.length ? (
            <ul className="mt-3 grid gap-2 border-l-2 pl-3">
              {post.comments.map((c) => {
                const a = member(c.author_id)
                return (
                  <li key={c.id} className="group text-sm">
                    <span className="font-medium">{a?.display_name}</span>{' '}
                    <span className="whitespace-pre-wrap break-words">{c.body}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{ago(c.created_at)}</span>
                    {c.author_id === userId ? (
                      <button type="button" className="ml-2 text-xs text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 focus:opacity-100" onClick={() => delComment.mutate(c.id)}>Delete</button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : null}

          {replying ? (
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (reply.trim()) addComment.mutate({ postId: post.id, body: reply.trim() }, { onSuccess: () => { setReply(''); setReplying(false) } }) }}>
              <Textarea rows={1} autoFocus className="min-h-9" placeholder="Reply…" value={reply} maxLength={2000} onChange={(e) => setReply(e.target.value)} />
              <Button type="submit" size="sm" variant="secondary" disabled={!reply.trim()}>Reply</Button>
            </form>
          ) : (
            <button type="button" className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => setReplying(true)}>
              <MessageCircle className="size-3.5" /> Reply
            </button>
          )}
        </div>
      </div>
    </Card>
  )
}

const EVENT_ICONS: Record<string, typeof CheckCircle2> = { 'task.completed': CheckCircle2, 'task.created': PlusCircle, 'goal.reached': Trophy }

export function ActivityRow({ group }: { group: ActivityGroup }) {
  const { member } = useHousehold()
  const [open, setOpen] = useState(false)
  const actor = member(group.actorId)
  const Icon = EVENT_ICONS[group.eventType] ?? Target
  const many = group.events.length > 1
  return (
    <li className="flex gap-3 px-1 py-2">
      <span className={cn('mt-0.5 grid size-7 shrink-0 place-items-center rounded-full', group.eventType === 'goal.reached' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : group.eventType === 'task.completed' ? 'bg-success/12 text-success' : 'bg-muted text-muted-foreground')}>
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p>
          {groupSummary(group, actor?.display_name ?? 'Someone')}
          {many ? (
            <button type="button" className="ml-2 text-xs text-primary" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide' : 'Show'}</button>
          ) : null}
        </p>
        {open ? (
          <ul className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
            {group.events.map((e) => <li key={e.id}>{e.summary}</li>)}
          </ul>
        ) : null}
        <p className="text-xs text-muted-foreground">{ago(group.latestAt)}</p>
      </div>
    </li>
  )
}

export function ExternalSourceCard({ source }: { source: FeedSource }) {
  const q = useExternalSource(source)
  const data = q.data
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Rss className="size-4 shrink-0 text-muted-foreground" />
          <p className="truncate text-sm font-semibold">{source.name}</p>
        </div>
        {data?.status === 'ok' && data.isMock ? <Badge tone="warning">Sample data · not live</Badge> : null}
      </div>
      <div className="px-4 py-3">
        {q.isPending ? (
          <div className="grid gap-2" aria-busy="true"><Skeleton className="h-4 w-4/5" /><Skeleton className="h-4 w-3/5" /><Skeleton className="h-4 w-2/3" /></div>
        ) : q.error || !data ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><AlertTriangle className="size-4 text-destructive" /> Couldn't load this source. <button type="button" className="text-primary" onClick={() => q.refetch()}>Retry</button></p>
        ) : data.status !== 'ok' ? (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{data.status === 'not_configured' ? 'Unavailable' : 'Error'}:</span> {data.message}
            {data.status === 'error' ? <button type="button" className="ml-2 text-primary" onClick={() => q.refetch()}>Retry</button> : null}
          </p>
        ) : !data.items.length ? (
          <p className="text-sm text-muted-foreground">Nothing new.</p>
        ) : (
          <>
            <ul className="grid gap-2.5">
              {data.items.slice(0, 6).map((item) => (
                <li key={item.id} className="text-sm">
                  <div className="flex items-start gap-2">
                    {item.kind !== 'article' ? <Badge tone={item.kind === 'result' ? 'neutral' : 'primary'} className="mt-0.5">{item.kind === 'result' ? 'FT' : 'Next'}</Badge> : null}
                    <div className="min-w-0">
                      {item.url ? (
                        <a href={item.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">{item.title}<ExternalLink className="ml-1 inline size-3 text-muted-foreground" /></a>
                      ) : (
                        <p className="font-medium">{item.title}</p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {[item.publishedAt ? (item.kind === 'fixture' ? formatDateTime(item.publishedAt) : ago(item.publishedAt)) : null, item.summary].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-muted-foreground">{data.attribution} · updated {ago(data.fetchedAt)}</p>
          </>
        )}
      </div>
    </Card>
  )
}
