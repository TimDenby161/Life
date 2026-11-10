import { format } from 'date-fns'
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react'
import { useSearchParams } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/misc'
import { addDaysISO, parseISODate, todayISO } from '@/lib/dates'
import { weekDays } from '@/modules/calendar/lib/grid'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { isMonday, mealsKey, plannedMeals, weekPlan } from '../../../supabase/functions/_shared/meals.ts'
import { useListMealsKey, useMakeShoppingList, useMealNames, useShoppingItems, useWeekMeals } from './api'
import { ShoppingList } from './components/ShoppingList'
import { WeekMeals } from './components/WeekMeals'

type View = 'meals' | 'list'

/**
 * The week's meals and the shopping list made from them, one at a time behind
 * a switch. The week and the view live in the address (?week=…&view=list), so
 * a reload keeps you where you were.
 */
export default function MealsPage() {
  const { members } = useHousehold()
  const [params, setParams] = useSearchParams()
  const thisWeek = weekDays(todayISO())[0]
  const asked = params.get('week') ?? ''
  const week = isMonday(asked) ? asked : thisWeek
  const view: View = params.get('view') === 'list' ? 'list' : 'meals'

  const change = (patch: { week?: string; view?: View }) =>
    setParams(
      (p) => {
        const w = patch.week ?? week
        const v = patch.view ?? view
        if (w === thisWeek) p.delete('week')
        else p.set('week', w)
        if (v === 'meals') p.delete('view')
        else p.set('view', v)
        return p
      },
      { replace: true },
    )

  const meals = useWeekMeals(week)
  const items = useShoppingItems(week)
  const listKey = useListMealsKey(week)
  const names = useMealNames()
  const make = useMakeShoppingList()

  const rows = meals.data ?? []
  const hasMeals = plannedMeals(week, rows, members.length).length > 0
  const stale = Boolean(listKey.data) && listKey.data !== mealsKey(week, rows, members.length)
  const left = (items.data ?? []).filter((i) => !i.checked).length
  // Only for the week it was asked for.
  const forThisWeek = make.variables === week
  const notice = forThisWeek && make.data && make.data.status !== 'ok' ? make.data : null
  const makeList = () => {
    change({ view: 'list' })
    make.mutate(week)
  }

  const days = weekDays(week)
  const title = week === thisWeek ? 'Meals this week' : week === addDaysISO(thisWeek, 7) ? 'Meals next week' : week === addDaysISO(thisWeek, -7) ? 'Meals last week' : 'Meals'
  const range = `${format(parseISODate(days[0]), 'd MMM')} – ${format(parseISODate(days[6]), 'd MMM')}`
  const error = view === 'meals' ? meals.error : (items.error ?? meals.error)
  const pending = view === 'meals' ? meals.isPending : items.isPending || meals.isPending

  return (
    <>
      <PageHeader
        title={title}
        description={range}
        actions={
          <>
            {week !== thisWeek ? (
              <Button variant="ghost" size="sm" onClick={() => change({ week: thisWeek })}>
                This week
              </Button>
            ) : null}
            <Button variant="outline" size="icon-sm" aria-label="Previous week" onClick={() => change({ week: addDaysISO(week, -7) })}>
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="icon-sm" aria-label="Next week" onClick={() => change({ week: addDaysISO(week, 7) })}>
              <ChevronRight />
            </Button>
          </>
        }
      />

      <Segmented
        aria-label="Meals or shopping list"
        className="mb-4 w-full sm:w-auto [&>*]:flex-1"
        value={view}
        onChange={(v) => change({ view: v })}
        options={[
          { value: 'meals', label: 'Meals' },
          {
            value: 'list',
            label: (
              <>
                Shopping list
                {left ? <span className="text-xs tabular-nums text-muted-foreground">{left}</span> : null}
              </>
            ),
          },
        ]}
      />

      {error ? (
        <ErrorState error={error} onRetry={() => (view === 'meals' ? meals.refetch() : items.refetch())} />
      ) : pending ? (
        <ListSkeleton rows={5} />
      ) : view === 'meals' ? (
        <>
          <WeekMeals key={week} plans={weekPlan(week, rows)} />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={makeList} disabled={!hasMeals || make.isPending}>
              <Sparkles /> Make shopping list
            </Button>
            {stale ? <span className="text-sm text-muted-foreground">Meals changed since the last list.</span> : null}
          </div>
          <datalist id="meal-names">
            {(names.data ?? []).map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </>
      ) : (
        <ShoppingList
          weekStart={week}
          items={items.data ?? []}
          hasMeals={hasMeals}
          stale={stale}
          making={make.isPending && forThisWeek}
          notice={notice}
          onMake={makeList}
        />
      )}
    </>
  )
}
