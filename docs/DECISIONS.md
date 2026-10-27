# Architecture decisions

Short records of choices that shape the codebase. Add new ones at the end.

## ADR 1: Supabase only, no custom server
Static hosting on GitHub Pages plus Supabase (Auth, Postgres, Realtime, Edge Functions) covers everything on the free tiers. Authorisation lives in RLS, so the browser can safely talk to Postgres directly. Edge Functions are used only where a secret or server-side fetch is unavoidable.

## ADR 2: Household model with one household per user
`households` + `household_members`, with a unique index on `user_id`. This keeps `current_household_id()` unambiguous and the UI simple. Supporting several households later means dropping that index and adding a switcher; the schema is already keyed by `household_id` everywhere.

## ADR 3: Composite foreign keys for tenant isolation
RLS stops reading other households' rows, but a plain FK would still let a client *reference* a foreign UUID. Composite FKs `(id, household_id)` make cross-household references impossible at the constraint level.

## ADR 4: Tasks = definitions + occurrences + append-only history
Overwriting a `done` flag loses who did what. Every task has occurrences (one for one-off tasks), and every completion, skip or reopen is appended to `task_completion_events` with a snapshot of the task. Statistics reduce the log to the latest event per occurrence, which prevents double counting and survives task edits and deletion. Mutations happen through RPCs so the three tables can't drift apart.

## ADR 5: Recurrence in SQL, mirrored in TS
Generating occurrences in the database keeps both users consistent and makes completion atomic. The UI needs previews, so the logic is mirrored in TypeScript. Both implementations are tested against one fixture file. Missed periods aren't backfilled: the next occurrence is the first rule date after max(previous due, yesterday).

## ADR 6: Google Calendar via a service-account proxy
Options considered:

| Option | Pros | Cons |
|---|---|---|
| **Service account + Edge Function (chosen)** | One-time setup; read-only scope; credentials never reach the browser; events merge with tasks in our own views; works in the iOS PWA | Requires a Google Cloud project and sharing the calendar with the service account |
| Google embed iframe (supported as fallback) | No setup | Only renders if the viewer's browser is signed in to Google with access; third-party cookie blocking often breaks it in Safari and iOS home-screen apps; can't show tasks alongside; Google's styling |
| Per-user Google OAuth | Uses each person's own access | Needs refresh tokens stored server-side (an extra secret store), OAuth consent setup and token refresh logic; overkill for one shared calendar |
| Secret iCal URL via Edge Function | Simple fetch | The URL is itself a full-read credential; parsing recurring ICS events correctly is non-trivial |

## ADR 7: Integer money, per-account currency, no FX
`bigint` minor units avoid rounding errors. Each account has a currency; totals are grouped by currency, with no conversion (which would need a rate source and would turn "real" numbers into estimates).

## ADR 8: Recorded vs calculated balances
Balances can be *recorded* (from a statement) or *calculated* (opening + transactions). Charts show recorded points as solid dots and calculated series as dashed lines labelled "calculated", so estimates are never presented as historical fact.

## ADR 9: Health is visible to the household, writes enforced in RLS
Originally private-by-default with per-category and per-record sharing. On 2026-10-27 Tim and Sophie asked for no privacy settings at all, so both members read everything; only the owner can write. Health data never appears in the activity feed, logs or household analytics.

## ADR 10: No offline editing
The PWA caches the app shell only. Safe offline edits need a local store, a sync queue and conflict resolution, and finance and task history make conflicts consequential. Mutations fail fast offline with a clear message; reading already-loaded data still works.

## ADR 11: Activity feed noise control
Only notable events are logged (shared or for-someone-else tasks, completions, goals reached), and the client collapses bursts by the same person. Activity rows are written by definer functions, so they can't be forged.

## ADR 12: Native `<select>` and bottom-sheet dialogs
On phones, native selects give the OS picker and better accessibility than custom listboxes. Dialogs become bottom sheets under `sm`. Radix primitives (via shadcn-style wrappers) cover the rest.
