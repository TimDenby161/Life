import { Sunrise } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { Card } from '@/components/ui/card'
import { todayISO } from '@/lib/dates'
import { useAnsweredQuestions, useOpenOccurrences } from '@/modules/tasks/hooks'
import { MorningRunBody } from './components/MorningRunSummary'
import { claudeResults, morningRun } from './lib/morningRun'

/**
 * The morning pop-up, any time: every open job Claude has done (newest first)
 * and the questions it's waiting on. Ticking a job off takes it off here.
 */
export default function MorningPage() {
  const open = useOpenOccurrences()
  const answered = useAnsweredQuestions()

  return (
    <>
      <PageHeader title="This morning" description="What Claude did for you and what it needs from you." />
      {open.error ? (
        <ErrorState error={open.error} onRetry={() => open.refetch()} />
      ) : open.isPending ? (
        <ListSkeleton rows={3} />
      ) : (
        <MorningContent open={open.data} answeredRows={answered.data ?? []} />
      )}
    </>
  )
}

function MorningContent({ open, answeredRows }: { open: Parameters<typeof claudeResults>[0]; answeredRows: Parameters<typeof morningRun>[2] }) {
  const did = claudeResults(open)
  const { asks, answered } = morningRun(open, todayISO(), answeredRows)
  if (!did.length && !asks.length && !answered.length) {
    return (
      <Card>
        <EmptyState icon={Sunrise} title="Nothing yet" description="When the morning run does a job or has a question, it shows here." />
      </Card>
    )
  }
  return (
    <Card className="p-4">
      <MorningRunBody did={did} asks={asks} answered={answered} />
    </Card>
  )
}
