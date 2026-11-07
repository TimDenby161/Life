import { ExternalLink, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { todayISO } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { useExternalSource, useFeedSources, useSaveSource } from '@/modules/feed/hooks'
import type { FeedSource } from '@/modules/feed/providers/types'
import { useShortHeadlines } from '../api'

export const MAX_HEADLINES = 5
const BBC = { provider: 'rss', name: 'BBC News', config: { url: 'https://feeds.bbci.co.uk/news/rss.xml' }, enabled: true }

function Headlines({ source, max, compact }: { source: FeedSource; max: number; compact: boolean }) {
  const feed = useExternalSource(source)
  // The morning routine's one-line versions; a story that broke later keeps its own headline.
  const short = useShortHeadlines(todayISO()).data
  const result = feed.data
  if (feed.isPending) return <ListSkeleton rows={compact ? 2 : 3} />
  if (!result || result.status !== 'ok') return <p className="text-sm text-muted-foreground">{result?.message ?? 'The news couldn’t be loaded.'}</p>
  return (
    <ul className={compact ? 'grid gap-1 text-sm' : 'grid gap-2 text-sm'}>
      {result.items.slice(0, max).map((item) => (
        <li key={item.id} className={compact ? 'min-w-0' : undefined}>
          {item.url ? (
            <a href={item.url} target="_blank" rel="noreferrer noopener" className="group inline-flex max-w-full items-start gap-1.5 hover:underline">
              <span className={compact ? 'truncate' : undefined} title={item.title}>{(item.url && short?.get(item.url)) || item.title}</span>
              <ExternalLink className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
            </a>
          ) : (
            item.title
          )}
        </li>
      ))}
    </ul>
  )
}

/** The top stories from the first news (RSS) source in the Feed; offers BBC News if there isn't one. */
export function TopNews({ max = MAX_HEADLINES, compact = false }: { max?: number; compact?: boolean }) {
  const sources = useFeedSources()
  const save = useSaveSource()
  const news = sources.data?.find((s) => s.provider === 'rss' && s.enabled)
  return (
    <Card>
      <CardHeader className={compact ? 'p-3 pb-1 sm:p-3 sm:pb-1' : undefined}>
        <CardTitle>News</CardTitle>
        {news ? <span className="text-xs text-muted-foreground">{news.name}</span> : null}
      </CardHeader>
      <CardContent className={compact ? 'p-3 pt-1 sm:p-3 sm:pt-1' : undefined}>
        {sources.isPending ? (
          <ListSkeleton rows={compact ? 2 : 3} />
        ) : news ? (
          <Headlines source={news} max={max} compact={compact} />
        ) : (
          <div className="grid justify-items-start gap-2 text-sm">
            <p className="text-muted-foreground">No news source yet.</p>
            <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate(BBC, { onError: (e) => toast.error(getErrorMessage(e)) })}>
              <Plus /> Add BBC News
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
