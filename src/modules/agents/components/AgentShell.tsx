import { Sparkles } from 'lucide-react'
import { type ComponentType, lazy, Suspense } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { ListSkeleton } from '@/components/states'
import { Segmented } from '@/components/ui/misc'
import { type PageAgent, pageView } from '../pageAgents'

const AgentView = lazy(() => import('./AgentView'))

/**
 * A page driven by its agent: opens on the agent view, with the page itself
 * under Details. A link into the page (a query or sub-path, e.g. a language
 * review or a task) goes straight to Details, so deep links keep working.
 */
export function AgentShell({ scope, base, title, page: Page }: { scope: PageAgent; base: string; title: string; page: ComponentType }) {
  const [params, setParams] = useSearchParams()
  const { pathname } = useLocation()
  const view = pageView(pathname, base, params)
  const setView = (v: 'agent' | 'details') =>
    setParams(v === 'agent' ? { view: 'agent' } : (p) => { p.set('view', 'details'); return p }, { replace: true })

  return (
    <div className="grid grid-cols-1 gap-4">
      <Segmented
        aria-label="View"
        size="sm"
        className="w-fit"
        value={view}
        onChange={setView}
        options={[
          { value: 'agent', label: <span className="flex items-center gap-1.5"><Sparkles className="size-3.5" />{scope.label}</span> },
          { value: 'details', label: 'Details' },
        ]}
      />
      {view === 'agent' ? (
        <div>
          <PageHeader title={title} description={scope.description} />
          <Suspense fallback={<ListSkeleton rows={3} />}>
            <AgentView scope={scope} onDetails={() => setView('details')} />
          </Suspense>
        </div>
      ) : (
        <Page />
      )}
    </div>
  )
}
