# AI agents: setup and deployment

Everything below is additive. Three migrations (`20261106000100` to `0300`) create new tables and functions, add columns to `user_preferences`, `agent_settings` and `wedding_settings`, a trigger on `task_completion_events` and an hourly cron job; they change no existing data.

## Local

```bash
supabase start
supabase migration up --local          # or supabase db reset
npm run db:types
printf 'AGENT_CRON_SECRET=local-test-secret\n' > /tmp/agents.env
supabase functions serve agents --env-file /tmp/agents.env
npm run dev                             # then open /ai
```

- **Run now** in AI Hub → Agents runs an agent as the signed-in person.
- To trigger the scheduled path by hand: `curl -X POST http://127.0.0.1:54321/functions/v1/agents -H 'content-type: application/json' -H 'x-agents-secret: local-test-secret' -d '{"mode":"scheduled"}'`. Morning runs only start from 6am London time.
- Local pg_cron won't call the function until the Vault secrets exist (below); that's expected.

## Live (needs your go-ahead; I haven't done any of this)

1. **Apply the migrations:** `supabase db push` (adds `20261106000100_agents.sql`, `0200_wedding_date_approx.sql`, `0300_agent_settings_config.sql`).
2. **Pick a secret** (any long random string, e.g. `openssl rand -hex 32`) and give it to the function:
   ```bash
   supabase secrets set AGENT_CRON_SECRET=<secret>
   ```
3. **Deploy the function:** `supabase functions deploy agents`. It has `verify_jwt = false` in `config.toml` because the cron call has no user JWT; the function checks the secret or the JWT itself.
4. **Tell the cron job where to call**, in the SQL editor (same secret as step 2):
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/agents', 'agents_function_url');
   select vault.create_secret('<secret>', 'agents_cron_secret');
   ```
   The job `agents-hourly` (minute 5 of every hour) then starts working. Check it with `select * from cron.job_run_details order by start_time desc limit 5;`.
5. **Push `main`** to deploy the AI Hub page.

### Optional: the AI sentence on briefings

Off unless both of these are true: the key is set, and a person turns on "AI sentence on my briefing" in AI Hub → Agents.

```bash
supabase secrets set ANTHROPIC_API_KEY=<key>
supabase secrets set AGENT_LLM_MONTHLY_BUDGET_USD=1      # default 1; 0 turns it off for everyone
supabase secrets set AGENT_LLM_MODEL=claude-opus-5-5      # default; claude-haiku-5-5 is cheaper
```

It sends Anthropic only the briefing's task titles, counts and dates. At the default model a summary is roughly 600 tokens in and 60 out, about $0.004, so two people daily is around $0.25 a month. Before each call the function checks that even the worst case stays inside the month's budget; past it, briefings keep their rules-based headline.

## Turning it off

- Per person: AI Hub → Agents switches.
- Everyone: `select cron.unschedule('agents-hourly');` (Run now still works).
- Remove the Vault secrets, and the cron job becomes a no-op.
