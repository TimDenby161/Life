# Life

Private household app for Tim and Sophie. React 19 + TypeScript + Vite SPA on GitHub Pages; Supabase (Auth, Postgres + RLS, Realtime, Edge Functions) is the only backend.

## Commands

- `npm run dev`: app on http://localhost:5173 (needs `supabase start` and `.env.local`)
- `npm run typecheck` / `npm test` (Vitest, TZ pinned to Europe/London)
- `npm run test:db`: pgTAP tests against the local stack (`supabase start` first)
- `supabase db reset`: re-apply migrations + `supabase/seed.sql` locally; `npm run db:demo` loads demo history
- `npm run db:types`: regenerate `src/lib/database.types.ts` after changing SQL
- `npm run build`: production build (`VITE_BASE_PATH=/<repo>/` for Pages)

Local logins (seed only): `tim@life.local`, `sophie@life.local`, `outsider@life.local`, password `life-local-dev`.

## Layout

- `src/modules/<module>/`: one folder per feature (api.ts, hooks.ts, lib/ pure logic + tests, components/, pages/). Register top-level pages in `src/modules/registry.tsx`.
- `src/components/`: shared UI (`ui/` primitives on Radix, `charts.tsx`, states, layout).
- `src/lib/`: Supabase client, money (integer minor units), dates, errors, realtime.
- `supabase/migrations/`: schema, RLS, RPCs. `supabase/functions/`: Edge Functions. `supabase/tests/database/`: pgTAP.
- `docs/`: ARCHITECTURE, DATABASE, SETUP, DECISIONS, STATUS.

## Rules that matter

- Security lives in Postgres. Every table has RLS keyed on `is_household_member(household_id)`; child tables use composite FKs `(parent_id, household_id)`. Never rely on hiding UI. New table means RLS, explicit column grants, a pgTAP test, and adding it to the realtime publication and `REALTIME_TABLES` if clients should sync (`src/test/security.test.ts` enforces this).
- Supabase grants nothing by default here (`alter default privileges ... revoke`). Grant columns explicitly; computed/trusted columns (`created_by`, status, history) are not client-writable.
- Task completion only goes through `complete_task_occurrence` / `skip_task_occurrence` / `reopen_task_occurrence`. `task_completion_events` is append-only history; statistics come from it (`src/modules/tasks/lib/stats.ts`).
- Recurrence logic exists twice (SQL `recurrence_next_date` and `tasks/lib/recurrence.ts`); change both and the shared vectors in `supabase/tests/fixtures/recurrence-cases.json`.
- Money is integer minor units (`bigint` in SQL, `number` in TS). Never use floats for amounts; parse with `parseMoney`. Transfers are two legs with `kind = 'transfer'` and never count as income or spending.
- Health data: owner-only writes, except exercise, which either member can log for the other (`logged_by` records who; the logger can also delete it). Both household members can read all of it (no privacy settings, by request). Never put health data or amounts in `feed_events`, logs or analytics.
- AI agents (`supabase/functions/agents`, logic in `supabase/functions/_shared/agents`, UI in `src/modules/agents`) only suggest. The service-role function reads one household at a time and writes only via `agent_claim_run`/`agent_finish_run`; real changes happen in `respond_agent_suggestion` as the approving person (`src/test/agents-guard.test.ts` enforces this). See `docs/ai-agents/`.
- Meals (`src/modules/meals`, shared logic in `supabase/functions/_shared/meals.ts`): the `shopping-list` function (meal plans, shopping lists and recipes) sends Claude only day, slot, meal name, number of people, saved recipe ingredients, the names of ingredients you have (`meal_pantry`) and, to plan, your per-meal notes (never who is eating), reads as the caller under RLS, and writes only through `shopping_save_list`, `recipes_save` and `meals_save_plan`. Who is in for each meal (`meal_availability`) is filled overnight by the agents function from the calendars and never overwrites a hand-set row. Recipes are one per meal name and never client-written. Its key is `MEALS_ANTHROPIC_API_KEY`; never `ANTHROPIC_API_KEY`, which switches on paid calls in the agents function (`src/test/meals-guard.test.ts` enforces this).
- No secrets in the frontend. `VITE_*` values are public. Google/API keys are Edge Function secrets.
- Don't present mock or estimated data as real: label sample feed data, and dash/label calculated balances.
- Match the existing style: small modules, TanStack Query hooks per module, invalidate by module root key (`['tasks']`, `['finances']`…), shadcn-style components, semantic colour tokens.
