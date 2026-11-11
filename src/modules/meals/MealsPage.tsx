import { format } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/misc'
import { addDaysISO, parseISODate, todayISO } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { weekDays } from '@/modules/calendar/lib/grid'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { isMonday, isPlanDays, mealsKey, plannedMeals, weekMeals, weekPlan } from '../../../supabase/functions/_shared/meals.ts'
import {
  useListMealsKey,
  useMakeShoppingList,
  useMealNames,
  usePantry,
  usePlanDays,
  usePlanMeals,
  useRecipes,
  useShoppingItems,
  useWeekMeals,
  useWriteRecipes,
} from './api'
import { Plan, PLAN_DAYS } from './components/Plan'
import { Recipes } from './components/Recipes'
import { ShoppingList } from './components/ShoppingList'
import { WeekMeals } from './components/WeekMeals'

type View = 'plan' | 'meals' | 'list' | 'recipes'

/**
 * Planning (who is in over the next four days, or more when days are added,
 * and what you have in), the week's meals, the shopping list made from them and
 * their recipes, one at a time behind a switch. The week, the view and any added
 * days live in the address (?week=…&view=list&days=5), so a reload keeps you where you were.
 */
export default function MealsPage() {
  const { members } = useHousehold()
  const [params, setParams] = useSearchParams()
  const thisWeek = weekDays(todayISO())[0]
  const asked = params.get('week') ?? ''
  const week = isMonday(asked) ? asked : thisWeek
  const askedView = params.get('view')
  const view: View = askedView === 'meals' || askedView === 'list' || askedView === 'recipes' ? askedView : 'plan'
  const askedDays = Number(params.get('days'))
  const planDayCount = isPlanDays(askedDays) ? askedDays : PLAN_DAYS

  const change = (patch: { week?: string; view?: View; days?: number }) =>
    setParams(
      (p) => {
        const w = patch.week ?? week
        const v = patch.view ?? view
        const d = patch.days ?? planDayCount
        if (d === PLAN_DAYS) p.delete('days')
        else p.set('days', String(d))
        if (w === thisWeek) p.delete('week')
        else p.set('week', w)
        if (v === 'plan') p.delete('view')
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
  const recipes = useRecipes()
  const write = useWriteRecipes()
  const today = todayISO()
  const planTo = addDaysISO(today, planDayCount - 1)
  const pantry = usePantry()
  const planDays = usePlanDays(today, planTo)
  const planMeals = usePlanMeals()
  const [busy, setBusy] = useState<string | null>(null)

  /**
   * The one thing that uses Claude: it fills the empty slots, rewrites the recipes for the planned days (with what
   * you have in), then writes the shopping list from those recipes. You see the meals while it works.
   */
  const runPlan = async () => {
    const id = 'meal-plan'
    try {
      setBusy('Planning meals…')
      const planned = await planMeals.mutateAsync({ from: today, days: planDayCount })
      if (planned.status !== 'ok') return void toast.error(planned.message, { id })
      change({ view: 'meals', week: weekDays(today)[0] })
      setBusy('Writing recipes…')
      toast.loading(planned.placed ? `${planned.placed} meals planned. Writing recipes…` : 'Writing recipes…', { id })
      const fresh = { from: today, days: planDayCount, since: planned.at }
      for (const w of planned.weeks) {
        const written = await write.mutateAsync({ weekStart: w, fresh })
        if (written.status !== 'ok' && written.status !== 'no_meals') return void toast.error(written.message, { id })
      }
      setBusy('Writing the shopping list…')
      toast.loading('Writing the shopping list…', { id })
      let lists = 0
      for (const w of planned.weeks) {
        const list = await make.mutateAsync(w)
        if (list.status === 'ok') lists++
        else if (list.status !== 'no_meals') return void toast.error(list.message, { id })
      }
      if (!lists) return void toast.info('Nobody is in for any of these meals', { id })
      toast.success('Meals, shopping list and recipes are ready', { id })
    } catch (e) {
      toast.error(getErrorMessage(e), { id })
    } finally {
      setBusy(null)
    }
  }

  const rows = meals.data ?? []
  const hasMeals = plannedMeals(week, rows, members.length).length > 0
  const stale = Boolean(listKey.data) && listKey.data !== mealsKey(week, rows, members.length)
  const left = (items.data ?? []).filter((i) => !i.checked).length

  const days = weekDays(week)
  const title = week === thisWeek ? 'Meals this week' : week === addDaysISO(thisWeek, 7) ? 'Meals next week' : week === addDaysISO(thisWeek, -7) ? 'Meals last week' : 'Meals'
  const range = `${format(parseISODate(days[0]), 'd MMM')} – ${format(parseISODate(days[6]), 'd MMM')}`
  const shown = view === 'list' ? items : view === 'recipes' ? recipes : view === 'plan' ? planDays : meals
  const error = view === 'plan' ? (pantry.error ?? planDays.error) : (meals.error ?? shown.error)
  const pending = view === 'plan' ? pantry.isPending || planDays.isPending : meals.isPending || shown.isPending
  const retry = () => {
    if (view !== 'plan') return meals.error ? meals.refetch() : shown.refetch()
    void pantry.refetch()
    return planDays.refetch()
  }

  return (
    <>
      <PageHeader
        title={view === 'plan' ? 'Meal plan' : title}
        description={view === 'plan' ? `${format(parseISODate(today), 'd MMM')} – ${format(parseISODate(planTo), 'd MMM')}` : range}
        actions={
          view === 'plan' ? null : (
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
          )
        }
      />

      {/* Meals you've had before, suggested while typing in Plan and Meals. */}
      <datalist id="meal-names">
        {(names.data ?? []).map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      <Segmented
        aria-label="Plan, meals, shopping list or recipes"
        className="mb-4 w-full sm:w-auto [&>*]:flex-1"
        value={view}
        onChange={(v) => change({ view: v })}
        options={[
          { value: 'plan', label: 'Plan' },
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
          { value: 'recipes', label: 'Recipes' },
        ]}
      />

      {error ? (
        <ErrorState error={error} onRetry={retry} />
      ) : pending ? (
        <ListSkeleton rows={5} />
      ) : view === 'plan' ? (
        <Plan
          from={today}
          days={planDayCount}
          onDays={(days) => change({ days })}
          pantry={pantry.data ?? []}
          availability={planDays.data?.availability ?? []}
          notes={planDays.data?.notes ?? []}
          busy={busy}
          onPlan={() => void runPlan()}
        />
      ) : view === 'meals' ? (
        <>
          <WeekMeals key={week} plans={weekPlan(week, rows)} />
          {stale ? <p className="mt-3 text-sm text-muted-foreground">Meals changed since the shopping list: Plan meals updates it.</p> : null}
        </>
      ) : view === 'recipes' ? (
        <Recipes
          meals={weekMeals(week, rows)}
          recipes={recipes.data ?? []}
          openDay={week === thisWeek ? format(new Date(), 'EEE') : null}
          writing={write.isPending && write.variables?.weekStart === week}
        />
      ) : (
        <ShoppingList
          weekStart={week}
          items={items.data ?? []}
          hasMeals={hasMeals}
          stale={stale}
          making={make.isPending && make.variables === week}
        />
      )}
    </>
  )
}
