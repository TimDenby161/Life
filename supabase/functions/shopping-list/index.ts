// Plans the next few days' meals, and writes the week's shopping list or
// recipes for its meals, with Claude.
//
// POST { weekStart: 'YYYY-MM-DD', mode?: 'list' | 'recipes' }
//   (weekStart is a Monday; Authorization: Bearer <user JWT>)
// POST { mode: 'plan', from: 'YYYY-MM-DD', days?: 1-MAX_PLAN_DAYS } (from = the person's today; days defaults to PLAN_DAYS)
// plan                -> { status: 'ok', placed, weeks }
//                        Fills the empty lunches and dinners over those days
//                        that someone is in for; weeks = the Mondays touched.
// list (the default)  -> { status: 'ok', count }
// recipes             -> { status: 'ok', written, remaining }
//                        Writes up to RECIPES_PER_CALL of the week's meals that
//                        have no recipe yet; call again while `remaining` > 0.
// either              -> { status: 'not_configured' | 'no_meals' | 'over_budget' | 'error', message }
//
// Everything is read as the calling user, under RLS. Claude is sent the day,
// slot, meal name and number of people (for recipes: just the meal names and
// how many to cook for; for a plan: the open slots with how many are eating
// and your note and recent meal names; and for all three,
// the names of the ingredients you already have), never who.
// Results are saved through shopping_save_list, recipes_save and
// meals_save_plan, the only things here that use the service role.
//
// Secrets (set with `supabase secrets set`, never committed):
//   MEALS_ANTHROPIC_API_KEY       this function's own key. It has its own name
//                                 on purpose: the agents function starts making
//                                 paid calls as soon as the usual key name is set.
//   MEALS_LLM_MODEL               optional, defaults to DEFAULT_MODEL
//   MEALS_LLM_MONTHLY_BUDGET_USD  optional, defaults to $3 a month (lists and recipes together)
//   ALLOWED_ORIGINS               optional
import Anthropic from 'npm:@anthropic-ai/sdk@1.4.0'
import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import { costMicroUsd, DEFAULT_MODEL, monthlyBudgetMicroUsd, withinBudget } from '../_shared/agents/llm.ts'
import { corsHeaders, json, userClient } from '../_shared/http.ts'
import {
  cleanItems,
  cleanPlan,
  cleanRecipes,
  isISODate,
  isPlanDays,
  isMonday,
  type MealRow,
  mealsKey,
  openSlots,
  PLAN_DAYS,
  PLAN_PROMPT,
  PLAN_SCHEMA,
  planDates,
  planInput,
  plannedMeals,
  RECIPE_PROMPT,
  RECIPE_SCHEMA,
  RECIPES_PER_CALL,
  recipesInput,
  SHOPPING_MAX_TOKENS,
  SHOPPING_PROMPT,
  SHOPPING_SCHEMA,
  shoppingInput,
  weekDates,
  weekMeals,
  weekStartOf,
  withRecipes,
} from '../_shared/meals.ts'

type Usage = { input_tokens: number; output_tokens: number; cost_micro_usd: number }

const serviceClient = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

/** Claude's raw answer, or null on any failure. Usage comes back whenever the call was billed, so it is costed. */
async function askClaude(
  apiKey: string,
  model: string,
  ask: { system: string; schema: Record<string, unknown>; input: string; timeoutMs: number },
): Promise<{ raw: string | null; usage: Usage | null }> {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: ask.timeoutMs })
  try {
    const response = await client.messages.create({
      model,
      max_tokens: SHOPPING_MAX_TOKENS,
      system: ask.system,
      messages: [{ role: 'user', content: ask.input }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: ask.schema } },
    })
    const usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cost_micro_usd: costMicroUsd(model, response.usage.input_tokens, response.usage.output_tokens),
    }
    // Cut off or declined: nothing usable, but it was still billed.
    if (response.stop_reason !== 'end_turn') return { raw: null, usage }
    const text = response.content.find((b) => b.type === 'text')
    return { raw: text && text.type === 'text' ? text.text : null, usage }
  } catch (error) {
    // Logged without content: just which kind of failure it was.
    if (error instanceof Anthropic.AuthenticationError) console.warn('shopping-list: the API key was rejected')
    else if (error instanceof Anthropic.RateLimitError) console.warn('shopping-list: rate limited')
    else if (error instanceof Anthropic.APIError) console.warn(`shopping-list: API error ${error.status}`)
    else console.warn('shopping-list: request failed')
    return { raw: null, usage: null }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { status: 'error', message: 'Method not allowed' }, 405)

  const supabase = await userClient(req)
  if (!supabase) return json(req, { status: 'error', message: 'Sign in again.' }, 401)

  let body: { weekStart?: string; mode?: string; from?: string; days?: number }
  try {
    body = await req.json()
  } catch {
    return json(req, { status: 'error', message: 'Invalid request' }, 400)
  }
  const mode = body.mode ?? 'list'
  if (mode !== 'list' && mode !== 'recipes' && mode !== 'plan') return json(req, { status: 'error', message: 'Invalid request' }, 400)
  const from = body.from ?? ''
  // Within a day of the server's date, whatever the person's time zone.
  const near = isISODate(from) && Math.abs(Date.parse(`${from}T12:00:00Z`) - Date.now()) < 2 * 86_400_000
  if (mode === 'plan' && !near) return json(req, { status: 'error', message: 'Invalid day' }, 400)
  const planDays = body.days ?? PLAN_DAYS
  if (mode === 'plan' && !isPlanDays(planDays)) return json(req, { status: 'error', message: 'Invalid number of days' }, 400)
  const weekStart = mode === 'plan' ? weekStartOf(from) : (body.weekStart ?? '')
  if (!isMonday(weekStart)) return json(req, { status: 'error', message: 'Invalid week' }, 400)

  // RLS: these only return the caller's own household.
  const { data: user } = await supabase.auth.getUser()
  const userId = user.user!.id
  const { data: members, error: membersError } = await supabase.from('household_members').select('household_id, user_id')
  const householdId = members?.find((m) => m.user_id === userId)?.household_id as string | undefined
  if (membersError || !householdId) return json(req, { status: 'error', message: 'No household.' }, 403)
  const householdSize = members!.filter((m) => m.household_id === householdId).length
  const memberIds = members!.filter((m) => m.household_id === householdId).map((m) => m.user_id as string)

  const apiKey = Deno.env.get('MEALS_ANTHROPIC_API_KEY')
  const model = Deno.env.get('MEALS_LLM_MODEL') || DEFAULT_MODEL

  /** Null when this call fits in the month's budget, else the reply to send. */
  const overBudget = async (system: string, input: string) => {
    const monthStart = `${new Date().toISOString().slice(0, 7)}-01T00:00:00Z`
    const { data: runs, error: runsError } = await supabase
      .from('shopping_list_runs')
      .select('llm_cost_micro_usd')
      .eq('household_id', householdId)
      .gte('created_at', monthStart)
    if (runsError) return json(req, { status: 'error', message: 'Could not check this month’s spend.' }, 500)
    const spent = (runs ?? []).reduce((sum, r) => sum + Number(r.llm_cost_micro_usd), 0)
    // The most this call could cost: a generous input estimate plus the whole output allowance.
    const worstCase = costMicroUsd(model, Math.ceil((input.length + system.length) / 3) + 500, SHOPPING_MAX_TOKENS)
    if (!withinBudget(spent, monthlyBudgetMicroUsd(Deno.env.get('MEALS_LLM_MONTHLY_BUDGET_USD')), worstCase)) {
      return json(req, { status: 'over_budget', message: 'This month’s Claude budget for meals is used up.' })
    }
    return null
  }

  /** The ingredients you already have, newest first (the list sent is capped). */
  const haveNames = () => supabase.from('meal_pantry').select('name').eq('household_id', householdId).order('created_at', { ascending: false })

  if (mode === 'plan') {
    const dates = planDates(from, planDays)
    const last = dates[dates.length - 1]
    const [planned, recentRows, availability, notes, pantry] = await Promise.all([
      supabase.from('meals').select('id, day, slot, person_id, name').eq('household_id', householdId).gte('day', dates[0]).lte('day', last),
      supabase
        .from('meals')
        .select('id, day, slot, person_id, name')
        .eq('household_id', householdId)
        .gte('day', new Date(Date.parse(`${from}T00:00:00Z`) - 21 * 86_400_000).toISOString().slice(0, 10))
        .lt('day', dates[0])
        .order('day', { ascending: false }),
      supabase.from('meal_availability').select('day, slot, person_id, available').eq('household_id', householdId).gte('day', dates[0]).lte('day', last),
      supabase.from('meal_slot_notes').select('day, slot, note').eq('household_id', householdId).gte('day', dates[0]).lte('day', last),
      haveNames(),
    ])
    if (planned.error || recentRows.error || availability.error || notes.error || pantry.error) {
      return json(req, { status: 'error', message: 'Could not load the plan.' }, 500)
    }
    const weeks = [...new Set(dates.map(weekStartOf))]
    const open = openSlots(from, memberIds, availability.data, notes.data, planned.data as MealRow[], planDays)
    // Nothing to fill: straight on to the list and recipes.
    if (!open.length) return json(req, { status: 'ok', placed: 0, weeks })
    if (!apiKey) return json(req, { status: 'not_configured', message: 'This needs a Claude API key.' })

    const input = planInput(
      open,
      planned.data as MealRow[],
      (recentRows.data as MealRow[]).map((m) => m.name),
      pantry.data.map((p) => p.name),
    )
    const refused = await overBudget(PLAN_PROMPT, input)
    if (refused) return refused
    const { raw, usage } = await askClaude(apiKey, model, { system: PLAN_PROMPT, schema: PLAN_SCHEMA, input, timeoutMs: 60_000 })
    if (raw === null && !usage) return json(req, { status: 'error', message: 'Claude could not be reached. Try again in a minute.' }, 502)
    const placed = raw === null ? null : cleanPlan(raw, open, householdSize)
    const { data: count, error: saveError } = await serviceClient().rpc('meals_save_plan', {
      p_household_id: householdId,
      p_week_start: weekStart,
      p_user_id: userId,
      p_meals: placed?.length ? placed : null,
      p_usage: usage ?? {},
    })
    if (saveError) return json(req, { status: 'error', message: 'Could not save the plan.' }, 500)
    if (!placed?.length) return json(req, { status: 'error', message: 'Claude did not come back with a plan. Try again.' }, 502)
    return json(req, { status: 'ok', placed: count ?? 0, weeks })
  }

  const days = weekDates(weekStart)
  const { data: rows, error: mealsError } = await supabase
    .from('meals')
    .select('id, day, slot, person_id, name')
    .eq('household_id', householdId)
    .gte('day', days[0])
    .lte('day', days[6])
  if (mealsError) return json(req, { status: 'error', message: 'Could not load the meals.' }, 500)

  const meals = plannedMeals(weekStart, rows as MealRow[], householdSize)
  if (!meals.length) return json(req, { status: 'no_meals', message: 'Add a meal first.' })

  // The household's saved recipes: the list buys what they use, and recipes are only written once.
  const { data: recipes, error: recipesError } = await supabase
    .from('recipes')
    .select('meal_key, serves, ingredients')
    .eq('household_id', householdId)
  if (recipesError) return json(req, { status: 'error', message: 'Could not load the recipes.' }, 500)

  const missing = weekMeals(weekStart, rows as MealRow[]).filter((m) => !recipes!.some((r) => r.meal_key === m.key))
  if (mode === 'recipes' && !missing.length) return json(req, { status: 'ok', written: 0, remaining: 0 })
  const asked = missing.slice(0, RECIPES_PER_CALL).map((m) => m.name)

  if (!apiKey) return json(req, { status: 'not_configured', message: 'This needs a Claude API key.' })

  const pantry = await haveNames()
  if (pantry.error) return json(req, { status: 'error', message: 'Could not load what you have.' }, 500)
  const have = pantry.data.map((p) => p.name)

  const ask =
    mode === 'recipes'
      ? { system: RECIPE_PROMPT, schema: RECIPE_SCHEMA, input: recipesInput(asked, householdSize, have), timeoutMs: 70_000 }
      : { system: SHOPPING_PROMPT, schema: SHOPPING_SCHEMA, input: shoppingInput(withRecipes(meals, recipes!), have), timeoutMs: 60_000 }

  const refused = await overBudget(ask.system, ask.input)
  if (refused) return refused

  const { raw, usage } = await askClaude(apiKey, model, ask)
  // Nothing came back and nothing was billed: no run to record.
  if (raw === null && !usage) return json(req, { status: 'error', message: 'Claude could not be reached. Try again in a minute.' }, 502)

  if (mode === 'recipes') {
    const written = raw === null ? null : cleanRecipes(raw, asked)
    const saved = written?.length ? written : null
    const { error: saveError } = await serviceClient().rpc('recipes_save', {
      p_household_id: householdId,
      p_week_start: weekStart,
      p_user_id: userId,
      p_serves: householdSize,
      p_recipes: saved,
      p_usage: usage ?? {},
    })
    if (saveError) return json(req, { status: 'error', message: 'Could not save the recipes.' }, 500)
    if (!saved) return json(req, { status: 'error', message: 'Claude did not come back with a recipe. Try again.' }, 502)
    return json(req, { status: 'ok', written: saved.length, remaining: missing.length - saved.length })
  }

  const items = raw === null ? null : cleanItems(raw)
  const saved = items?.length ? items : null
  const { error: saveError } = await serviceClient().rpc('shopping_save_list', {
    p_household_id: householdId,
    p_week_start: weekStart,
    p_user_id: userId,
    p_meals_key: mealsKey(weekStart, rows as MealRow[], householdSize),
    p_items: saved,
    p_usage: usage ?? {},
  })
  if (saveError) return json(req, { status: 'error', message: 'Could not save the list.' }, 500)
  if (!saved) return json(req, { status: 'error', message: 'Claude did not come back with a list. Try again.' }, 502)
  return json(req, { status: 'ok', count: saved.length })
})
