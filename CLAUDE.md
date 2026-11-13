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
- The one exception is the morning Claude routine doing jobs (`_shared/agents/work.ts`, `work-save` in `agents/routine.ts`): for open one-off jobs of people with AI picks on (never a "C4" category or a repeating job) it may add a question as a task (`tasks.ai_asks_task_id`), leave a result on the job (`tasks.ai_result`) and add wedding venues (`created_by` null), only through `agent_save_work` after `cleanWork` has checked its answer. It never completes, edits or deletes a job; answers go through `answer_ai_question`. It drafts emails into the result and never sends one: the routine has no connectors (keep `clear_mcp_connections: true`), and `cleanWork` drops any result claiming something was sent, booked or paid. None of the `ai_*` task columns are client-writable.
- Daily tasks per area (Tim's call, 13 Nov 2026: added, not suggested): the same routine decides, area by area (finance, wedding, meals, holidays, shopping, health, table tennis, side hustles, people, languages), the day's tasks for each person and for Together from their goals (`life_goals`, the Goals page), none on a quiet day or several when urgent, only through `agent_save_ideas` after `cleanIdeas` (`_shared/agents/ideas.ts`, `ideas-save` in `agents/routine.ts`). People get the areas picked in Settings (`user_preferences.idea_areas`); Together's go on the Joint list needing both. Capped per area and per day; `tasks.ai_area` marks them and isn't client-writable. Claude gets goals, names and dates only (`loadAreas`), never account figures or health. Home always shows tasks added today for today.
- Meals (`src/modules/meals`, shared logic in `supabase/functions/_shared/meals.ts`): the `shopping-list` function (meal plans, shopping lists and recipes) sends Claude only day, slot, meal name, number of people, saved recipe ingredients, the names of ingredients you have (`meal_pantry`) and, to plan, your per-meal notes and quick/long choice (never who is eating), reads as the caller under RLS, and writes only through `shopping_save_list`, `recipes_save` and `meals_save_plan`. Who is in for each meal (`meal_availability`) is filled overnight by the agents function from the calendars and never overwrites a hand-set row. Recipes are one per meal name and never client-written. Its key is `MEALS_ANTHROPIC_API_KEY`; never `ANTHROPIC_API_KEY`, which switches on paid calls in the agents function (`src/test/meals-guard.test.ts` enforces this).
- Table tennis (`src/modules/tabletennis`, logic in `supabase/functions/_shared/tableTennis.ts`): league records and tables come from the public TT Leagues API through the `table-tennis` function (browsers can't call it), which writes only `tt_snapshots` via `tt_save_snapshots`. National ranking is typed in (no open feed from TT England; don't scrape rankings.ttehub.com). A session's rate is copied from its employer by trigger, never the client.
- Coach week (`src/modules/health/components/ExerciseWeek.tsx`, logic in `health/lib/weekPlan.ts`): every box is calendar exercise, something set by hand (`exercise_plan`, `owner_id` null = both of you) or logged, the coach's suggestion, or Rest. The coach is worked out live from the weekly goals and never saved, like a coach would: only into a free calendar hour (weekday evenings, weekends in the day, 30 minutes after anything busy; both free for a shared session), never on match/tournament days or all-day-away days, never booking "at most" goals, and it shows the time. Calendar titles are recognised through `exercise_names` (Tim's TT matches are written as the other team, e.g. "GS1", "Crusaders"; "1*" events are tournaments), which you teach from a day's box.
- No secrets in the frontend. `VITE_*` values are public. Google/API keys are Edge Function secrets.
- Don't present mock or estimated data as real: label sample feed data, and dash/label calculated balances.
- Match the existing style: small modules, TanStack Query hooks per module, invalidate by module root key (`['tasks']`, `['finances']`…), shadcn-style components, semantic colour tokens.
