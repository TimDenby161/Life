import { MessagesSquare, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { PageHeader, SectionTitle } from '@/components/PageHeader'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Segmented } from '@/components/ui/misc'
import { useUserId } from '@/modules/auth/AuthProvider'
import type { FeedPost } from './api'
import { ActivityRow, Composer, ExternalSourceCard, PostCard } from './components/FeedItems'
import { useFeedEvents, useFeedSources, useMarkRead, useMyReads, usePosts } from './hooks'
import { type ActivityGroup, groupActivity } from './lib/activity'

type Filter = 'all' | 'messages' | 'activity'
type Entry = { kind: 'post'; at: string; post: FeedPost } | { kind: 'activity'; at: string; group: ActivityGroup }

export default function FeedPage() {
  const userId = useUserId()
  const posts = usePosts()
  const events = useFeedEvents(80)
  const reads = useMyReads()
  const sources = useFeedSources()
  const markRead = useMarkRead()
  const [filter, setFilter] = useState<Filter>('all')

  const unreadIds = useMemo(
    () => (posts.data && reads.data ? posts.data.filter((p) => p.author_id !== userId && !reads.data.has(p.id)).map((p) => p.id) : []),
    [posts.data, reads.data, userId],
  )
  // Seeing the feed marks messages as read, after a short pause so the
  // unread dots are noticeable first.
  const unreadKey = unreadIds.join(',')
  useEffect(() => {
    if (!unreadIds.length) return
    const t = setTimeout(() => markRead.mutate(unreadIds), 2000)
    return () => clearTimeout(t)
  }, [unreadKey])

  const pinned = (posts.data ?? []).filter((p) => p.pinned_at)
  const timeline = useMemo<Entry[]>(() => {
    const entries: Entry[] = []
    if (filter !== 'activity') for (const p of posts.data ?? []) if (!p.pinned_at) entries.push({ kind: 'post', at: p.created_at, post: p })
    if (filter !== 'messages') for (const g of groupActivity(events.data ?? [])) entries.push({ kind: 'activity', at: g.latestAt, group: g })
    return entries.sort((a, b) => b.at.localeCompare(a.at))
  }, [posts.data, events.data, filter])

  const unread = new Set(unreadIds)
  const loading = posts.isPending || events.isPending
  const error = posts.error ?? events.error

  return (
    <>
      <PageHeader title="Feed" description="Notes to each other and what's been happening at home." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid content-start gap-3">
          <Composer />
          <Segmented aria-label="Show" size="sm" value={filter} onChange={setFilter} className="justify-self-start" options={[{ value: 'all', label: 'Everything' }, { value: 'messages', label: 'Messages' }, { value: 'activity', label: 'Activity' }]} />
          {filter !== 'activity' && pinned.map((p) => <PostCard key={p.id} post={p} unread={unread.has(p.id)} />)}
          {loading ? (
            <Card className="p-4"><ListSkeleton rows={4} /></Card>
          ) : error ? (
            <Card><ErrorState error={error} onRetry={() => { posts.refetch(); events.refetch() }} /></Card>
          ) : !timeline.length && !pinned.length ? (
            <Card><EmptyState icon={MessagesSquare} title="Nothing here yet" description="Post a message, or complete a task, and it'll show up here." /></Card>
          ) : (
            <TimelineList entries={timeline} unread={unread} />
          )}
        </div>
        <aside className="grid content-start gap-3">
          <SectionTitle action={<Button variant="ghost" size="sm" asChild><Link to="/settings#feed-sources"><Plus /> Add</Link></Button>}>Elsewhere</SectionTitle>
          {sources.isPending ? (
            <ListSkeleton rows={2} />
          ) : !sources.data?.filter((s) => s.enabled).length ? (
            <Card className="p-4 text-sm text-muted-foreground">
              Add football scores, news or other sources in <Link to="/settings#feed-sources" className="text-primary">Settings</Link>.
            </Card>
          ) : (
            sources.data.filter((s) => s.enabled).map((s) => <ExternalSourceCard key={s.id} source={s} />)
          )}
        </aside>
      </div>
    </>
  )
}

/** Posts are cards; runs of activity between them share one quiet card. */
function TimelineList({ entries, unread }: { entries: Entry[]; unread: Set<string> }) {
  const blocks: ({ kind: 'post'; post: FeedPost } | { kind: 'activity'; groups: ActivityGroup[] })[] = []
  for (const e of entries) {
    const last = blocks.at(-1)
    if (e.kind === 'post') blocks.push({ kind: 'post', post: e.post })
    else if (last?.kind === 'activity') last.groups.push(e.group)
    else blocks.push({ kind: 'activity', groups: [e.group] })
  }
  return (
    <>
      {blocks.map((b) =>
        b.kind === 'post' ? (
          <PostCard key={b.post.id} post={b.post} unread={unread.has(b.post.id)} />
        ) : (
          <Card key={b.groups[0].key} className="bg-card/60 px-3 py-1">
            <ul className="divide-y">{b.groups.map((g) => <ActivityRow key={g.key} group={g} />)}</ul>
          </Card>
        ),
      )}
    </>
  )
}
