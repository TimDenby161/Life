# Status

_Last updated: 26 November 2026_

**Live since 26 October 2026**: the app on GitHub Pages and the hosted Supabase project (Ireland),
with migrations applied by `supabase db push`, Google Calendar and Sheets sync, push notifications
and the agents. Open work is kept in the owner's task list, not here.

The rest of this page is the local verification done on 22 October 2026, before going live. The
suites have grown since (26 November 2026: 795 Vitest tests, 551 pgTAP tests). The "needs your
accounts" and "decisions" lists from then are settled and have been removed.

## Verified locally

Validation actually run against the local Supabase stack (Docker):

- `npm run typecheck`: clean (app + node configs).
- `npm test`: 108 Vitest tests. Recurrence (shared vectors), task statistics, money and finance calculations, calendar layout, activity grouping, health helpers, error messages, login and checkbox components, and static security guards (RLS on every table, no anon grants, definer `search_path`, realtime map in sync, no secrets or `console.log` in `src`).
- `npm run test:db`: 80 pgTAP tests. Household isolation (an outsider household can't read or reference anything), forged `created_by` and history/activity rejected, completion history for one-off and weekly tasks including reopen, transfers (two legs, one-legged rejected), balances with recorded snapshots, savings-goal detection, health privacy (default shared, private categories, per-record override, owner-only writes), feed permissions, anon denied.
- `npm run build`: production bundle with CSP, PWA service worker and `404.html`, also built and served under `/Life/` to test deep links after sign-in.
- Manual browser checks: sign-in; create a recurring task, complete it, see the next occurrence and history; finances overview and account history; feed and realtime (a post made as Sophie appeared live in Tim's open feed); health partner view showing only shared categories; dashboard; statistics; settings; phone-width layouts; light and dark modes.
- Edge Function `calendar-events` tested on the local edge runtime: rejects missing auth and bad ranges, reports "not configured" honestly, and doesn't expose one household's calendar config to another.

## Next steps (suggested)

- CSV import for bank statements (seam in `finances/integrations/types.ts`; `external_id` gives idempotent re-imports).
- Apple Health / Health Connect import (columns `source` / `external_id` are ready).
- Recurring transactions (e.g. salary, bills) and budget roll-over.
- Editing transfers in place (today: delete and re-create).
- Optional household switcher (drop the one-household-per-user index).

## Known limitations

- Net worth across currencies isn't converted; non-GBP totals are shown separately.
- Missed recurring occurrences aren't backfilled (by design, ADR 5).
- Week view is a day-by-day list, not an hourly grid.
- The free Supabase mailer is rate-limited; use "Create new user" if an invite doesn't arrive.
