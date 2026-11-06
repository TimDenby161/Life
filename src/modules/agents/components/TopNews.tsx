import { ExternalLink, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getErrorMessage } from '@/lib/errors'
import { useExternalSource, useFeedSources, useSaveSource } from '@/modules/feed/hooks'
import type { FeedSource } from '@/modules/feed/providers/types'

export const MAX_HEADLINES = 5
const BBC = { provider: 'rss', name: 'BBC News', config: { url: 'https://feeds.bbci.co.uk/news/rss.xml' }, enabled: true }

function Headlines({ source }: { source: FeedSource }) {
  const feed = useExternalSource(source)
  const result = feed.data
  if (feed.isPending) return <ListSkeleton rows={3} />
  if (!result || result.status !== 'ok') return <p className="text-sm text-muted-foreground">{result?.message ?? 'The news couldn’t be loaded.'}</p>
  return (
    <ul className="grid gap-2 text-sm">
      {result.items.slice(0, MAX_HEADLINES).map((item) => (
        <li key={item.id}>
          {item.url ? (
            <a href={item.url} target="_blank" rel="noreferrer noopener" className="group inline-flex items-start gap-1.5 hover:underline">
              <span>{item.title}</span>
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
export function TopNews() {
  const sources = useFeedSources()
  const save = useSaveSource()
  const news = sources.data?.find((s) => s.provider === 'rss' && s.enabled)
  return (
    <Card>
      <CardHeader>
        <CardTitle>News</CardTitle>
        {news ? <span className="text-xs text-muted-foreground">{news.name}</span> : null}
      </CardHeader>
      <CardContent>
        {sources.isPending ? (
          <ListSkeleton rows={3} />
        ) : news ? (
          <Headlines source={news} />
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
