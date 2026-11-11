import { format } from 'date-fns'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
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
import { daysPlan, isMonday, isPlanDays, mealsKey, planDates, plannedMeals, weekMeals, weekStartOf } from '../../../supabase/functions/_shared/meals.ts'
import {
  useDaysMeals,
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
 * Two steps. Plan: who is in over the next four days (or more when days are
 * added), what you have in, what you want and whether it should be quick, then
 * Plan meals. Meals: those days filled in, any meal swapped for one you have
 * had, then Complete writes the recipes and the shopping list. The list and the
 * recipes are by week. The week, the view and any added days live in the
 * address (?week=…&view=list&days=5), so a reload keeps you where you were.
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
  const dayMeals = useDaysMeals(today, planTo)
  const [busy, setBusy] = useState<string | null>(null)

  /** Step one: Claude fills the empty lunches and dinners, then you see them on Meals to swap any you don't fancy. */
  const runPlan = async () => {
    const id = 'meal-plan'
    try {
      setBusy('Planning meals…')
      const planned = await planMeals.mutateAsync({ from: today, days: planDayCount })
      if (planned.status !== 'ok') return void toast.error(planned.message, { id })
      change({ view: 'meals' })
      toast.success(planned.placed ? `${planned.placed} meals planned: swap any, then Complete` : 'Every meal already has something: swap any, then Complete', { id })
    } catch (e) {
      toast.error(getErrorMessage(e), { id })
    } finally {
      setBusy(null)
    }
  }

  /**
   * Step two: rewrites the recipes for the planned days (with what you have in), then writes each week's shopping
   * list from those recipes, and shows the list.
   */
  const runComplete = async () => {
    const id = 'meal-complete'
    const weeks = [...new Set(planDates(today, planDayCount).map(weekStartOf))]
    try {
      setBusy('Writing recipes…')
      toast.loading('Writing recipes…', { id })
      const fresh = { from: today, days: planDayCount, since: new Date().toISOString() }
      for (const w of weeks) {
        const written = await write.mutateAsync({ weekStart: w, fresh })
        if (written.status !== 'ok' && written.status !== 'no_meals') return void toast.error(written.message, { id })
      }
      setBusy('Writing the shopping list…')
      toast.loading('Writing the shopping list…', { id })
      const listed: string[] = []
      for (const w of weeks) {
        const list = await make.mutateAsync(w)
        if (list.status === 'ok') listed.push(w)
        else if (list.status !== 'no_meals') return void toast.error(list.message, { id })
      }
      if (!listed.length) return void toast.info('No meals to shop for yet', { id })
      change({ view: 'list', week: listed[0] })
      toast.success('Recipes and shopping list are ready', { id })
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
  const planRange = `${format(parseISODate(today), 'd MMM')} – ${format(parseISODate(planTo), 'd MMM')}`
  const shown = view === 'list' ? items : view === 'recipes' ? recipes : view === 'plan' ? planDays : dayMeals
  const error = view === 'plan' ? (pantry.error ?? planDays.error) : view === 'meals' ? dayMeals.error : (meals.error ?? shown.error)
  const pending = view === 'plan' ? pantry.isPending || planDays.isPending : view === 'meals' ? dayMeals.isPending : meals.isPending || shown.isPending
  const retry = () => {
    if (view === 'meals') return dayMeals.refetch()
    if (view !== 'plan') return meals.error ? meals.refetch() : shown.refetch()
    void pantry.refetch()
    return planDays.refetch()
  }
  const byWeek = view === 'list' || view === 'recipes'

  return (
    <>
      <PageHeader
        title={view === 'plan' ? 'Meal plan' : view === 'meals' ? 'Meals' : title}
        description={byWeek ? range : planRange}
        actions={
          !byWeek ? null : (
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
          <option key={n.name} value={n.name} />
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
        <div className="grid gap-2 md:max-w-xl">
          <WeekMeals key={today} plans={daysPlan(planDates(today, planDayCount), dayMeals.data ?? [])} />
          <Button onClick={() => void runComplete()} disabled={Boolean(busy) || !(dayMeals.data ?? []).length} className="w-full">
            <Check /> {busy ?? 'Complete'}
          </Button>
        </div>
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
