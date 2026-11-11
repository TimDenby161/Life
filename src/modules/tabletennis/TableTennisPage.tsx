import { useSearchParams } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { ErrorState, ListSkeleton } from '@/components/states'
import { Segmented } from '@/components/ui/misc'
import { useProfiles } from './api'
import { Coaching } from './components/Coaching'
import { Playing } from './components/Playing'
import { Work } from './components/Work'

type View = 'playing' | 'coaching' | 'work'

/**
 * Table tennis: Playing (national ranking, and your record and team's table in
 * each league), Coaching (players you coach, how they're doing, your notes)
 * and Work (coaching sessions, and what each employer owes). The view lives in
 * the address (?view=coaching).
 */
export default function TableTennisPage() {
  const [params, setParams] = useSearchParams()
  const asked = params.get('view')
  const view: View = asked === 'coaching' || asked === 'work' ? asked : 'playing'
  const profiles = useProfiles()

  return (
    <>
      <PageHeader title="Table tennis" />
      <Segmented
        aria-label="Playing, coaching or work"
        className="mb-3 w-full sm:w-auto [&>*]:flex-1"
        value={view}
        onChange={(v) =>
          setParams(
            (p) => {
              if (v === 'playing') p.delete('view')
              else p.set('view', v)
              return p
            },
            { replace: true },
          )
        }
        options={[
          { value: 'playing', label: 'Playing' },
          { value: 'coaching', label: 'Coaching' },
          { value: 'work', label: 'Work' },
        ]}
      />
      <div className="md:max-w-2xl">
        {view === 'coaching' ? (
          <Coaching />
        ) : view === 'work' ? (
          <Work />
        ) : profiles.error ? (
          <ErrorState error={profiles.error} onRetry={() => void profiles.refetch()} />
        ) : profiles.isPending ? (
          <ListSkeleton rows={4} />
        ) : (
          <Playing profiles={profiles.data} />
        )}
      </div>
    </>
  )
}
