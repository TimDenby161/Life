# Status

_Last updated: 22 October 2026_

## Verified locally

Validation actually run against the local Supabase stack (Docker):

- `npm run typecheck`: clean (app + node configs).
- `npm test`: 108 Vitest tests. Recurrence (shared vectors), task statistics, money and finance calculations, calendar layout, activity grouping, health helpers, error messages, login and checkbox components, and static security guards (RLS on every table, no anon grants, definer `search_path`, realtime map in sync, no secrets or `console.log` in `src`).
- `npm run test:db`: 80 pgTAP tests. Household isolation (an outsider household can't read or reference anything), forged `created_by` and history/activity rejected, completion history for one-off and weekly tasks including reopen, transfers (two legs, one-legged rejected), balances with recorded snapshots, savings-goal detection, health privacy (default shared, private categories, per-record override, owner-only writes), feed permissions, anon denied.
- `npm run build`: production bundle with CSP, PWA service worker and `404.html`, also built and served under `/Life/` to test deep links after sign-in.
- Manual browser checks: sign-in; create a recurring task, complete it, see the next occurrence and history; finances overview and account history; feed and realtime (a post made as Sophie appeared live in Tim's open feed); health partner view showing only shared categories; dashboard; statistics; settings; phone-width layouts; light and dark modes.
- Edge Function `calendar-events` tested on the local edge runtime: rejects missing auth and bad ranges, reports "not configured" honestly, and doesn't expose one household's calendar config to another.

## Not yet verified (needs your accounts)

- Real Google Calendar data through the service account (no Google credentials were used).
- Google Sheet balance sync against the real Sheets API. It was tested end to end on the local stack against a fake Google server serving a copy of the MonthReport layout.
- `external-feed` against live RSS hosts and API-Football (no API key used). The code paths for missing configuration were exercised; live responses were not.
- Hosted Supabase project, invite emails and the GitHub Pages deployment (nothing was deployed or pushed).
- Installing the PWA on a physical iPhone or Android phone.

## Decisions for you

1. **Repository name and visibility.** The app is served at `/<repo>/`. GitHub Pages on a private repo needs a paid plan; a public repo is safe (no secrets) but the code is visible.
2. **Supabase project.** Region (London suggested), and the two email addresses for the accounts.
3. **Google Calendar method.** Service account (recommended; needs a free Google Cloud project) or the simpler embed fallback (see DECISIONS.md, ADR 6).
4. **Chesterfield FC scores.** Whether to create a free API-Football key, plus any news feeds you want (hosts must be allow-listed).
5. **Health privacy.** Decided 2026-10-27: no privacy settings; all health records are visible to both of you.
6. **Units.** Weight is kg; stones/pounds display isn't implemented.

## Next steps (suggested)

- CSV import for bank statements (seam in `finances/integrations/types.ts`; `external_id` gives idempotent re-imports).
- Push notifications for tasks due today (Web Push + a scheduled Edge Function).
- Apple Health / Health Connect import (columns `source` / `external_id` are ready).
- Recurring transactions (e.g. salary, bills) and budget roll-over.
- Editing transfers in place (today: delete and re-create).
- Optional household switcher (drop the one-household-per-user index).

## Known limitations

- Net worth across currencies isn't converted; non-GBP totals are shown separately.
- Missed recurring occurrences aren't backfilled (by design, ADR 5).
- Week view is a day-by-day list, not an hourly grid.
- The free Supabase mailer is rate-limited; use "Create new user" if an invite doesn't arrive.
