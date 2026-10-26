# Architecture

## Overview

```
 Browser (PWA, GitHub Pages)                         Supabase (free tier)
 ┌──────────────────────────────┐   HTTPS + JWT    ┌─────────────────────────────────┐
 │ React + TanStack Query       │ ───────────────▶ │ PostgREST ─▶ Postgres (RLS)     │
 │  modules/: tasks, finances,  │ ◀── realtime ─── │ Realtime (postgres_changes,RLS) │
 │  calendar, feed, health, …   │                  │ Auth (email+password, invite)   │
 │ Supabase JS (publishable key)│ ───────────────▶ │ Edge Functions                  │
 └──────────────────────────────┘                  │  calendar-events ─▶ Google API  │
                                                   │  external-feed  ─▶ RSS / scores │
                                                   └─────────────────────────────────┘
```

- **No custom server.** The browser talks directly to Supabase with the public publishable key. Every authorisation decision is made by Postgres Row Level Security using the user's JWT.
- **Edge Functions** exist only where a secret is needed (Google service account, sports API key) or a third-party fetch must happen server-side. They act *as the calling user* (`userClient`), so RLS still decides what they can read.
- **GitHub Pages** hosts static files. `npm run build` writes `dist/404.html` as a copy of `index.html`, so deep links and refreshes boot the SPA; React Router uses `import.meta.env.BASE_URL` as its basename.

## Frontend structure

```
src/
  App.tsx                 providers, auth/household gates, routes from the registry
  modules/registry.tsx    the list of top-level modules → nav + routes
  modules/<name>/
    api.ts                Supabase queries/mutations (+ query keys)
    hooks.ts              TanStack Query hooks
    lib/*.ts              pure logic (unit-tested): recurrence, stats, calc…
    components/, pages/   UI
  components/             shared UI: ui/ primitives (Radix), charts, states, layout
  lib/                    supabase client, money, dates, errors, realtime
```

Adding a module means a folder under `src/modules`, one entry in `registry.tsx`, and (if it has tables) a migration with RLS plus realtime registration. Modules may import each other's hooks (the dashboard composes them) but not each other's internals.

### Server state and sync

- TanStack Query owns server state. Keys start with the module root (`['tasks', …]`, `['finances', …]`), and mutations invalidate the root.
- `useHouseholdRealtime` subscribes once to `postgres_changes` for all household tables (filtered by `household_id`) and invalidates the matching roots, debounced 300 ms because one action touches several tables. After a reconnect it refetches everything. Realtime applies RLS per subscriber, so private health rows are never broadcast to the partner.
- Completing a task is optimistic (instant tick with Undo); everything else waits for the server.

### Offline

The service worker precaches only the app shell. API responses (financial and health data) are never cached by the service worker or persisted to storage. Queries keep in-memory data while offline; mutations use `networkMode: 'always'` so they fail immediately with an "offline" message instead of silently queueing. There is no offline editing (no conflict resolution), and the UI says so.

## Tasks: model and counting rules

- `tasks` is the definition. `task_occurrences` is each instance of work: one-off tasks have exactly one, recurring tasks one per due date.
- Recurrence rules are JSON (`daily|weekly|monthly|yearly`, interval, ISO weekdays, month day, until). `recurrence_next_date()` in SQL is authoritative; `lib/recurrence.ts` mirrors it for previews, and both are tested against the same vectors.
- After completion or skip, the next occurrence is the first rule date after `max(previous due date, yesterday)`. Missed weeks don't pile up; an overdue occurrence stays overdue until done or skipped.
- `complete/skip/reopen_task_occurrence` RPCs (SECURITY DEFINER with explicit membership checks) update the occurrence, append to `task_completion_events`, generate or undo the follow-up, and write the activity event, all in one transaction.
- **Statistics** reduce the event log to the latest event per occurrence. An occurrence counts once if that event is `completed`, so complete → undo → complete counts once and a weekly task counts once per week. Credit goes to `completed_by` (who did it); `assignee_id` (who was responsible) is snapshotted separately. "Covered for someone else" means completed by someone other than the assignee. Average time to complete only uses one-off tasks.

## Finances: model and rules

- Amounts are integer minor units (`bigint` in Postgres, safe integers in JS). Input is parsed from strings with no float arithmetic.
- Balance = latest recorded balance (`account_balance_history`) + later transactions, or opening balance + all transactions. Liabilities are negative.
- Charts separate **recorded** balances (solid dots) from **calculated** values (dashed lines, labelled as calculated).
- Transfers are two legs with a shared `transfer_id`, created by `create_transfer` and guarded by a deferred constraint trigger (exactly two legs, opposite signs). They are excluded from income and spending everywhere.
- Multi-currency: each account has a currency; totals are per currency with no FX conversion (shown separately).
- Bank/import readiness: `source`, `external_id` (idempotent re-sync), `import_batch_id`, and account `external_provider/external_account_id`. See `src/modules/finances/integrations/types.ts`.

## Calendar

Read-only. The `calendar-events` Edge Function signs a JWT for a Google service account (scope `calendar.readonly`), lists events for the household's configured calendar IDs and returns normalised events. The browser never sees Google credentials. A fallback "embed" mode stores a Google embed URL and shows Google's iframe (trade-offs in DECISIONS.md). Task due dates are merged into every view client-side.

## Feed

- Messages (`feed_posts`, `feed_comments`), read receipts (`feed_reads`) and pinning.
- Automatic activity (`feed_events`) is written only by trusted database functions: task added (only shared or for-someone-else tasks), task completed, savings goal reached. The client groups bursts by the same person. Health data and amounts never go into the feed.
- External sources use a provider registry (`modules/feed/providers`). RSS and football run through the `external-feed` Edge Function, which allow-lists RSS hosts and reads API keys from secrets. The `mock` provider is always labelled "Sample data · not live". Each source card shows its own loading, error and unavailable state.

## Health

Per-user records: weight (`health_measurements`), exercise (`health_exercise_sessions`: a description and a duration) and periods (`health_periods`). The next-period date is the last start plus the average cycle, labelled as an estimate. RLS function `health_is_visible(owner, household, category, visibility)`: the owner always sees their own records; the partner sees a record if it is marked `shared`, or if it is `inherit` and the owner shares that category. Default is private. Only the owner can write. The app shows numbers and trends only, never interpretations. `source`/`external_id` columns are ready for Apple Health / Health Connect imports.

## Charts

Recharts with shared building blocks in `components/charts.tsx`. The categorical palette is the validated dataviz reference palette (`--chart-1…6` in `index.css`, separate light/dark steps). A person always has the same colour. Every chart has a table view, there's a legend whenever there are 2+ series, marks are thin and gridlines recessive, and calculated series are dashed.

## Security summary

- RLS on every table; `anon` has no grants; defaults revoked so new tables start closed.
- Composite FKs stop cross-household references even with forged UUIDs.
- Column-level grants make audit/derived columns read-only to clients.
- SECURITY DEFINER functions all use `set search_path = ''` and check membership explicitly.
- Invite-only auth: public sign-up disabled; household membership can only be created by an admin (`bootstrap_household`).
- Production CSP (meta tag): scripts only from self, network only to the Supabase project, frames only from Google Calendar.
- Static guard tests (`src/test/security.test.ts`) and pgTAP tests (`supabase/tests/database`) cover the above.
