import { ChefHat, ChevronDown } from 'lucide-react'
import { EmptyState } from '@/components/states'
import { Card } from '@/components/ui/card'
import { asIngredients, asSteps, type WeekMeal } from '../../../../supabase/functions/_shared/meals.ts'
import type { RecipeRow } from '../api'

/**
 * A recipe for each different meal of the week, written by Claude when you
 * Plan meals (the planned days' recipes are rewritten each time, with what you
 * have in) and kept, so a meal planned again already has one.
 */
export function Recipes({
  meals,
  recipes,
  openDay,
  writing,
}: {
  meals: WeekMeal[]
  recipes: RecipeRow[]
  /** "Mon"…"Sun": that day's recipes start open (today, when looking at this week). */
  openDay: string | null
  /** Plan meals is writing them now. */
  writing: boolean
}) {
  const byKey = new Map(recipes.map((r) => [r.meal_key, r]))

  if (!meals.length) {
    return (
      <Card>
        <EmptyState icon={ChefHat} title="No meals yet" description="Plan some meals and their recipes appear here." />
      </Card>
    )
  }

  return (
    <>
      {writing ? (
        <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">
          Claude is writing them. They appear a few at a time.
        </p>
      ) : null}

      <div className="grid gap-2">
        {meals.map((meal) => {
          const recipe = byKey.get(meal.key)
          const steps = recipe ? asSteps(recipe.steps) : []
          const ingredients = recipe ? asIngredients(recipe.ingredients) : []
          const when = meal.when.map((w) => `${w.day} ${w.slot}`).join(' · ')
          const heading = (
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{meal.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{when}</span>
            </span>
          )
          if (!recipe || !steps.length) {
            return (
              <Card key={meal.key} className="flex items-center gap-3 p-3">
                {heading}
                <span className="shrink-0 text-sm text-muted-foreground">{recipe ? 'Nothing to cook' : writing ? 'Writing…' : 'Plan meals writes it'}</span>
              </Card>
            )
          }
          return (
            <Card key={meal.key}>
              <details className="group" open={meal.when.some((w) => w.day === openDay)}>
                <summary className="flex cursor-pointer list-none items-center gap-3 p-3 [&::-webkit-details-marker]:hidden">
                  {heading}
                  {recipe.minutes ? <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{recipe.minutes} min</span> : null}
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <div className="border-t p-3 text-sm">
                  <p className="mb-2 text-xs text-muted-foreground">Serves {recipe.serves}</p>
                  <ul className="mb-4 divide-y">
                    {ingredients.map((i) => (
                      <li key={i.item} className="flex items-baseline justify-between gap-3 py-1.5">
                        <span className="min-w-0">{i.item}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">{i.quantity}</span>
                      </li>
                    ))}
                  </ul>
                  <ol className="grid list-decimal gap-2.5 pl-5 leading-relaxed marker:text-muted-foreground">
                    {steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                </div>
              </details>
            </Card>
          )
        })}
      </div>

      {meals.some((m) => byKey.has(m.key)) ? <p className="mt-4 text-xs text-muted-foreground">Claude wrote these from the meal names. Check timings and that food is cooked through.</p> : null}
    </>
  )
}
