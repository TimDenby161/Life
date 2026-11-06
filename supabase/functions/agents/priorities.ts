// AI priorities through the API (only when ANTHROPIC_API_KEY is set; normally
// the morning Claude routine does this instead). Returns Claude's raw answer
// for savePicks to check; every failure returns null and Top jobs keeps its
// usual order. Usage is returned so the run records cost.
import Anthropic from 'npm:@anthropic-ai/sdk@1.4.0'
import { costMicroUsd, DEFAULT_MODEL, MAX_OUTPUT_TOKENS, withinBudget, worstCaseMicroUsd } from '../_shared/agents/llm.ts'
import { PRIORITIES_PROMPT, PRIORITIES_SCHEMA } from '../_shared/agents/priorities.ts'
import { noUsage, type Usage } from './summary.ts'

export async function pickPriorities(input: string, budget: { spent: number; limit: number }): Promise<{ raw: string | null; usage: Usage }> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return { raw: null, usage: noUsage() }
  const model = Deno.env.get('AGENT_LLM_MODEL') || DEFAULT_MODEL
  if (!withinBudget(budget.spent, budget.limit, worstCaseMicroUsd(model, input.length + PRIORITIES_PROMPT.length))) {
    console.warn('priorities: over the monthly budget')
    return { raw: null, usage: noUsage() }
  }

  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 })
  try {
    const response = await client.messages.create({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: PRIORITIES_PROMPT,
      messages: [{ role: 'user', content: input }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: PRIORITIES_SCHEMA } },
    })
    const usage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cost_micro_usd: costMicroUsd(model, response.usage.input_tokens, response.usage.output_tokens),
    }
    if (response.stop_reason !== 'end_turn') return { raw: null, usage }
    const text = response.content.find((b) => b.type === 'text')
    return { raw: text && text.type === 'text' ? text.text : null, usage }
  } catch (error) {
    // Logged without content: just which kind of failure it was.
    if (error instanceof Anthropic.RateLimitError) console.warn('priorities: rate limited')
    else if (error instanceof Anthropic.APIError) console.warn(`priorities: API error ${error.status}`)
    else console.warn('priorities: request failed')
    return { raw: null, usage: noUsage() }
  }
}
