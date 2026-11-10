import { ChefHat, ChevronDown, RotateCw, Sparkles } from 'lucide-react'
import { EmptyState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { asIngredients, asSteps, type WeekMeal } from '../../../../supabase/functions/_shared/meals.ts'
import type { RecipeRow, WriteRecipesResult } from '../api'

/**
 * A recipe for each different meal of the week, written by Claude from the
 * meal's name (`onWrite`) and kept, so a meal planned again already has one.
 */
export function Recipes({
  meals,
  recipes,
  openDay,
  writing,
  notice,
  onWrite,
  onRewrite,
}: {
  meals: WeekMeal[]
  recipes: RecipeRow[]
  /** "Mon"…"Sun": that day's recipes start open (today, when looking at this week). */
  openDay: string | null
  writing: boolean
  /** Why the last attempt wrote nothing. */
  notice: Exclude<WriteRecipesResult, { status: 'ok' }> | null
  onWrite: () => void
  onRewrite: (recipe: RecipeRow) => void
}) {
  const byKey = new Map(recipes.map((r) => [r.meal_key, r]))
  const missing = meals.filter((m) => !byKey.has(m.key)).length

  if (!meals.length) {
    return (
      <Card>
        <EmptyState icon={ChefHat} title="No meals yet" description="Plan some meals and their recipes appear here." />
      </Card>
    )
  }

  return (
    <>
      {missing || writing ? (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button onClick={onWrite} disabled={writing}>
            <Sparkles /> {writing ? 'Writing…' : missing === 1 ? 'Write 1 recipe' : `Write ${missing} recipes`}
          </Button>
          {writing ? (
            <p className="min-w-0 flex-1 text-sm text-muted-foreground" aria-live="polite">
              Claude is writing them. They appear a few at a time.
            </p>
          ) : null}
        </div>
      ) : null}

      {notice && !writing ? (
        <Card role="status" className="mb-3 border-warning/40 bg-warning/10 p-3 text-sm">
          {notice.message}
        </Card>
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
                <span className="shrink-0 text-sm text-muted-foreground">{recipe ? 'Nothing to cook' : writing ? 'Writing…' : 'No recipe yet'}</span>
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
                  <Button variant="ghost" size="sm" className="mt-3 -ml-2 text-muted-foreground" disabled={writing} onClick={() => onRewrite(recipe)}>
                    <RotateCw /> Write again
                  </Button>
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
