import { Sparkles } from 'lucide-react'
import { type ComponentType, lazy, Suspense } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { ListSkeleton } from '@/components/states'
import { Segmented } from '@/components/ui/misc'
import { type PageAgent, type PageViewName, pageView } from '../pageAgents'

const AgentView = lazy(() => import('./AgentView'))
const GoalsView = lazy(() => import('./GoalsView'))

/**
 * A page driven by its agent: opens on the agent view, with the page itself
 * under Details. A link into the page (a query or sub-path, e.g. a language
 * review or a task) goes straight to Details, so deep links keep working.
 */
export function AgentShell({ scope, base, title, page: Page }: { scope: PageAgent; base: string; title: string; page: ComponentType }) {
  const [params, setParams] = useSearchParams()
  const { pathname } = useLocation()
  // Home has no switch, so it's always the agent view unless a link points inside it.
  const asked = pageView(pathname, base, params)
  const view = asked === 'goals' && !scope.goals ? 'agent' : asked
  const setView = (v: PageViewName) =>
    setParams(v === 'details' ? (p) => { p.set('view', 'details'); return p } : { view: v }, { replace: true })

  return (
    <div className="grid grid-cols-1 gap-4">
      {scope.bare ? null : (
        <Segmented
          aria-label="View"
          size="sm"
          className="w-fit"
          value={view}
          onChange={setView}
          options={[
            { value: 'agent', label: <span className="flex items-center gap-1.5"><Sparkles className="size-3.5" />{scope.label}</span> },
            { value: 'details', label: 'Details' },
            ...(scope.goals ? [{ value: 'goals' as const, label: 'Goals' }] : []),
          ]}
        />
      )}
      {view === 'agent' ? (
        <div>
          {scope.bare ? <h1 className="sr-only">{title}</h1> : <PageHeader title={title} description={scope.description} />}
          <Suspense fallback={<ListSkeleton rows={3} />}>
            <AgentView scope={scope} onDetails={() => setView('details')} />
          </Suspense>
        </div>
      ) : view === 'goals' && scope.goals ? (
        <Suspense fallback={<ListSkeleton rows={3} />}>
          <GoalsView kind={scope.goals} />
        </Suspense>
      ) : (
        <Page />
      )}
    </div>
  )
}
