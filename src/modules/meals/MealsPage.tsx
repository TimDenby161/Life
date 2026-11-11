import { format } from 'date-fns'
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react'
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
import { isMonday, mealsKey, plannedMeals, weekMeals, weekPlan } from '../../../supabase/functions/_shared/meals.ts'
import {
  useDeleteRecipe,
  useListMealsKey,
  useMakeShoppingList,
  useMealNames,
  useMealWishes,
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
 * Planning (meals you want, who is in over the next four days), the week's
 * meals, the shopping list made from them and their recipes, one at a time
 * behind a switch. The week and the view live in the address (?week=…&view=list), so
 * a reload keeps you where you were.
 */
export default function MealsPage() {
  const { members } = useHousehold()
  const [params, setParams] = useSearchParams()
  const thisWeek = weekDays(todayISO())[0]
  const asked = params.get('week') ?? ''
  const week = isMonday(asked) ? asked : thisWeek
  const askedView = params.get('view')
  const view: View = askedView === 'meals' || askedView === 'list' || askedView === 'recipes' ? askedView : 'plan'

  const change = (patch: { week?: string; view?: View }) =>
    setParams(
      (p) => {
        const w = patch.week ?? week
        const v = patch.view ?? view
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
  const delRecipe = useDeleteRecipe()
  const today = todayISO()
  const planTo = addDaysISO(today, PLAN_DAYS - 1)
  const wishes = useMealWishes()
  const planDays = usePlanDays(today, planTo)
  const planMeals = usePlanMeals()
  const [busy, setBusy] = useState<string | null>(null)

  /** Claude fills the empty slots, then you see the meals while it writes the shopping list and the recipes. */
  const runPlan = async () => {
    const id = 'meal-plan'
    try {
      setBusy('Planning meals…')
      const planned = await planMeals.mutateAsync(today)
      if (planned.status !== 'ok') return void toast.error(planned.message, { id })
      change({ view: 'meals', week: weekDays(today)[0] })
      setBusy('Writing the shopping list…')
      toast.loading(planned.placed ? `${planned.placed} meals planned. Writing the shopping list…` : 'Writing the shopping list…', { id })
      let lists = 0
      for (const w of planned.weeks) {
        const list = await make.mutateAsync(w)
        if (list.status === 'ok') lists++
        else if (list.status !== 'no_meals') return void toast.error(list.message, { id })
      }
      if (!lists) return void toast.info('Nobody is in for any of these meals', { id })
      setBusy('Writing recipes…')
      toast.loading('Writing recipes…', { id })
      for (const w of planned.weeks) {
        const written = await write.mutateAsync(w)
        if (written.status !== 'ok' && written.status !== 'no_meals') return void toast.error(written.message, { id })
      }
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
  const recipeNotice = write.variables === week && write.data && write.data.status !== 'ok' ? write.data : null
  const shown = view === 'list' ? items : view === 'recipes' ? recipes : view === 'plan' ? planDays : meals
  const error = view === 'plan' ? (wishes.error ?? planDays.error) : (meals.error ?? shown.error)
  const pending = view === 'plan' ? wishes.isPending || planDays.isPending : meals.isPending || shown.isPending
  const retry = () => {
    if (view !== 'plan') return meals.error ? meals.refetch() : shown.refetch()
    void wishes.refetch()
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
          wishes={wishes.data ?? []}
          availability={planDays.data?.availability ?? []}
          notes={planDays.data?.notes ?? []}
          busy={busy}
          onPlan={() => void runPlan()}
        />
      ) : view === 'meals' ? (
        <>
          <WeekMeals key={week} plans={weekPlan(week, rows)} />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={makeList} disabled={!hasMeals || make.isPending}>
              <Sparkles /> Make shopping list
            </Button>
            {stale ? <span className="text-sm text-muted-foreground">Meals changed since the last list.</span> : null}
          </div>
        </>
      ) : view === 'recipes' ? (
        <Recipes
          meals={weekMeals(week, rows)}
          recipes={recipes.data ?? []}
          openDay={week === thisWeek ? format(new Date(), 'EEE') : null}
          writing={write.isPending && write.variables === week}
          notice={recipeNotice}
          onWrite={() => write.mutate(week)}
          onRewrite={(r) => delRecipe.mutate(r.id, { onSuccess: () => write.mutate(week), onError: (e) => toast.error(getErrorMessage(e)) })}
        />
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
