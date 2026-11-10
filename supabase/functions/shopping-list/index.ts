// Writes the week's shopping list from the meal plan, with Claude.
//
// POST { weekStart: 'YYYY-MM-DD' }  (a Monday; Authorization: Bearer <user JWT>)
// -> { status: 'ok', count }
//  | { status: 'not_configured' | 'no_meals' | 'over_budget' | 'error', message }
//
// The meals are read as the calling user, under RLS. Claude is sent the day,
// slot, meal name and number of people, nothing else. The list is saved through
// shopping_save_list, the only thing here that uses the service role.
//
// Secrets (set with `supabase secrets set`, never committed):
//   MEALS_ANTHROPIC_API_KEY       this function's own key. It has its own name
//                                 on purpose: the agents function starts making
//                                 paid calls as soon as the usual key name is set.
//   MEALS_LLM_MODEL               optional, defaults to DEFAULT_MODEL
//   MEALS_LLM_MONTHLY_BUDGET_USD  optional, defaults to $3 a month
//   ALLOWED_ORIGINS               optional
import Anthropic from 'npm:@anthropic-ai/sdk@1.4.0'
import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import { costMicroUsd, DEFAULT_MODEL, monthlyBudgetMicroUsd, withinBudget } from '../_shared/agents/llm.ts'
import { corsHeaders, json, userClient } from '../_shared/http.ts'
import {
  cleanItems,
  type MealRow,
  isMonday,
  mealsKey,
  plannedMeals,
  SHOPPING_MAX_TOKENS,
  SHOPPING_PROMPT,
  SHOPPING_SCHEMA,
  shoppingInput,
  weekDates,
} from '../_shared/meals.ts'

type Usage = { input_tokens: number; output_tokens: number; cost_micro_usd: number }

const serviceClient = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

/** Claude's raw answer, or null on any failure. Usage comes back either way so the call is costed. */
async function askClaude(apiKey: string, model: string, input: string): Promise<{ raw: string | null; usage: Usage | null }> {
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 })
  try {
    const response = await client.messages.create({
      model,
      max_tokens: SHOPPING_MAX_TOKENS,
      system: SHOPPING_PROMPT,
      messages: [{ role: 'user', content: input }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SHOPPING_SCHEMA } },
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

  let body: { weekStart?: string }
  try {
    body = await req.json()
  } catch {
    return json(req, { status: 'error', message: 'Invalid request' }, 400)
  }
  const weekStart = body.weekStart ?? ''
  if (!isMonday(weekStart)) return json(req, { status: 'error', message: 'Invalid week' }, 400)

  // RLS: these only return the caller's own household.
  const { data: user } = await supabase.auth.getUser()
  const userId = user.user!.id
  const { data: members, error: membersError } = await supabase.from('household_members').select('household_id, user_id')
  const householdId = members?.find((m) => m.user_id === userId)?.household_id as string | undefined
  if (membersError || !householdId) return json(req, { status: 'error', message: 'No household.' }, 403)
  const householdSize = members!.filter((m) => m.household_id === householdId).length

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

  const apiKey = Deno.env.get('MEALS_ANTHROPIC_API_KEY')
  if (!apiKey) return json(req, { status: 'not_configured', message: 'The shopping list needs a Claude API key.' })

  const model = Deno.env.get('MEALS_LLM_MODEL') || DEFAULT_MODEL
  const input = shoppingInput(meals)
  const monthStart = `${new Date().toISOString().slice(0, 7)}-01T00:00:00Z`
  const { data: runs, error: runsError } = await supabase
    .from('shopping_list_runs')
    .select('llm_cost_micro_usd')
    .eq('household_id', householdId)
    .gte('created_at', monthStart)
  if (runsError) return json(req, { status: 'error', message: 'Could not check this month’s spend.' }, 500)
  const spent = (runs ?? []).reduce((sum, r) => sum + Number(r.llm_cost_micro_usd), 0)
  // The most this call could cost: a generous input estimate plus the whole output allowance.
  const worstCase = costMicroUsd(model, Math.ceil((input.length + SHOPPING_PROMPT.length) / 3) + 500, SHOPPING_MAX_TOKENS)
  if (!withinBudget(spent, monthlyBudgetMicroUsd(Deno.env.get('MEALS_LLM_MONTHLY_BUDGET_USD')), worstCase)) {
    return json(req, { status: 'over_budget', message: 'This month’s Claude budget for shopping lists is used up.' })
  }

  const { raw, usage } = await askClaude(apiKey, model, input)
  const items = raw === null ? null : cleanItems(raw)
  const saved = items?.length ? items : null

  // Nothing was billed and nothing changes: no run to record.
  if (!saved && !usage) return json(req, { status: 'error', message: 'Claude could not be reached. Try again in a minute.' }, 502)

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
