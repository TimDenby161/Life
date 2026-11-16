import { Sparkles } from 'lucide-react'
import { type ComponentType, lazy, Suspense } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { ListSkeleton } from '@/components/states'
import { Segmented } from '@/components/ui/misc'
import { type ExtraTab, type PageAgent, type PageViewName, pageView } from '../pageAgents'

const AgentView = lazy(() => import('./AgentView'))
const GoalsView = lazy(() => import('./GoalsView'))

/** The tabs a page can have between its agent view and Details. */
const TABS: Record<ExtraTab, { label: string; Component: ComponentType }> = {
  cashflow: { label: 'Cashflow', Component: lazy(() => import('@/modules/finances/pages/CashflowTab').then((m) => ({ default: m.CashflowTab }))) },
  venues: { label: 'Venues', Component: lazy(() => import('@/modules/wedding/components/WeddingPlan').then((m) => ({ default: m.Venues }))) },
  guests: { label: 'Guests', Component: lazy(() => import('@/modules/wedding/components/GuestsTab').then((m) => ({ default: m.GuestsTab }))) },
  suppliers: { label: 'Suppliers', Component: lazy(() => import('@/modules/wedding/components/SuppliersTab').then((m) => ({ default: m.SuppliersTab }))) },
}

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
  const tabs = scope.tabs ?? []
  const isTab = (v: PageViewName): v is ExtraTab => (tabs as readonly string[]).includes(v)
  const view = (asked === 'goals' && !scope.goals) || (asked in TABS && !isTab(asked)) ? 'agent' : asked
  const Tab = isTab(view) ? TABS[view].Component : null
  const options = [
    { value: 'agent' as const, label: <span className="flex items-center gap-1.5"><Sparkles className="size-3.5" />{scope.label}</span> },
    ...tabs.map((t) => ({ value: t, label: TABS[t].label })),
    { value: 'details' as const, label: 'Details' },
    ...(scope.goals ? [{ value: 'goals' as const, label: 'Goals' }] : []),
  ]
  const setView = (v: PageViewName) =>
    setParams(v === 'details' ? (p) => { p.set('view', 'details'); return p } : { view: v }, { replace: true })

  return (
    <div className="grid grid-cols-1 gap-4">
      {scope.bare ? null : (
        <Segmented
          aria-label="View"
          size="sm"
          className="w-fit max-w-full overflow-x-auto"
          // Five or more fit a phone row with tighter padding.
          itemClassName={options.length >= 5 ? 'px-2' : undefined}
          value={view}
          onChange={setView}
          options={options}
        />
      )}
      {view === 'agent' ? (
        <div>
          {scope.bare ? <h1 className="sr-only">{title}</h1> : <PageHeader title={title} description={scope.description} />}
          <Suspense fallback={<ListSkeleton rows={3} />}>
            <AgentView scope={scope} onDetails={() => setView('details')} />
          </Suspense>
        </div>
      ) : Tab ? (
        <Suspense fallback={<ListSkeleton rows={3} />}>
          <div className={view === 'venues' ? 'md:max-w-2xl' : undefined}><Tab /></div>
        </Suspense>
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
