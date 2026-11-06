# AI agents: implementation plan

Design: [architecture.md](architecture.md). Each milestone is small enough to test on its own, and nothing is deployed or applied to the live database without the owners' go-ahead.

Milestones 1 to 3, and the first four agents of milestone 4, are built and tested locally (6 November 2026); see [status.md](status.md).

## Milestone 1: foundation

- Migration `20261106000100_agents.sql`: `agent_settings`, `agent_runs`, `agent_suggestions`, `agent_briefings`, `agent_actions`, with RLS, column grants and realtime; `user_preferences.ai_summaries`.
- SQL functions: `agent_claim_run` and `agent_finish_run` (service role only); `respond_agent_suggestion` (members; approve / dismiss / snooze, with the approved action applied as the caller); trigger that queues an event run when a task is completed; `agents_dispatch()` + pg_cron schedule that calls the Edge Function using Vault secrets and does nothing if they aren't set.
- Pure modules in `supabase/functions/_shared/agents/`: `registry.ts`, `schedule.ts` (what is due, run keys, local time), `dates.ts`, `types.ts`.
- Edge Function `agents`: scheduled mode (cron secret) and on-demand mode (user JWT), dispatcher, error capture, usage recording.
- Tests: pgTAP `16_agents.test.sql` (RLS, recipient privacy, no client writes, claim dedupe/retry/stuck, finish upsert/expire/dismissed-stays, approve/dismiss/snooze, cross-user and outsider denial, event queueing); Vitest for schedule and registry; the existing static guards cover RLS, grants and realtime.

## Milestone 2: Smart Task Manager

- `taskManager.ts`: neglected and put-off tasks, deadline risks, duplicates, repeat candidates (one-offs done 3+ times), joint workload with effort estimates, automation candidates, weekly plan. Every finding carries a plain-English reason and, where useful, an action (create task, move date, archive duplicate).
- Approving a create/move/archive action changes the real task tables through `respond_agent_suggestion`.
- Tests: one Vitest case per rule, privacy routing (personal → owner only), and no suggestions for waiting or archived tasks.

## Milestone 3: Chief of Staff + AI Hub

- `chiefOfStaff.ts`: per-person daily briefing (due today, overdue, deadlines in 14 days, deadline clusters, what the other person finished, top suggestions) and a Monday weekly plan.
- Optional LLM sentence (`llm.ts`): off by default; needs `ANTHROPIC_API_KEY` and the person's opt-in; monthly budget; tokens and cost recorded.
- AI Hub page at `/ai`: Overview (briefing, live Focus from Top jobs, top suggestions), Suggestions (approve / snooze / dismiss with reasons), Agents (on/off, schedule, data access, last run, Run now), History (runs, actions, errors, usage and cost).
- Tests: briefing rules, budget maths, LLM output validation, a component test for the suggestion card.

## Milestone 4: more agents

Built: Wedding Planner, Language Coach, Fitness Coach, Household Coordinator (one pure module each in `_shared/agents/`, a loader in `functions/agents/context.ts`, a `cadence` in the registry; the dispatcher runs every live agent and then the Chief of Staff, which now combines all their suggestions).

Still to do, each blocked on a decision:

1. Finance: a bills/recurring costs list, or CSV statement import.
2. Life Admin: approved email or calendar access.
3. Travel: trip data in the app, and an approved price source.
4. Career: goals, and an approved job source.

## Going live (needs the owners)

1. `supabase db push` (applies the agents migration; additive, no existing data changed).
2. `supabase secrets set AGENT_CRON_SECRET=<random>` (and optionally `ANTHROPIC_API_KEY`, `AGENT_LLM_MONTHLY_BUDGET_USD`).
3. `supabase functions deploy agents`.
4. In the SQL editor, store the Vault secrets the cron job reads (see [setup.md](setup.md)).
5. Push `main` to deploy the AI Hub.

## Progress

See [status.md](status.md).
