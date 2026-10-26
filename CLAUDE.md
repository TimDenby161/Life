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
- Health data: owner-only writes; partner visibility = record override, else category setting, else shared. Never put health data or amounts in `feed_events`, logs or analytics.
- No secrets in the frontend. `VITE_*` values are public. Google/API keys are Edge Function secrets.
- Don't present mock or estimated data as real: label sample feed data, and dash/label calculated balances.
- Match the existing style: small modules, TanStack Query hooks per module, invalidate by module root key (`['tasks']`, `['finances']`…), shadcn-style components, semantic colour tokens.
