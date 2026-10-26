# Setup

Everything below is free-tier. Nothing in this repository is secret. Values marked **secret** must never be committed or put in a `VITE_` variable.

## 1. Local development

Requirements: Node 22+, Docker, Supabase CLI.

```bash
npm install
supabase start                 # local Postgres/Auth/Realtime in Docker
supabase db reset              # migrations + local seed users
npm run db:demo                # optional: a year of demo history
cp .env.example .env.local     # then fill in from `supabase status`:
#   VITE_SUPABASE_URL=http://127.0.0.1:54321
#   VITE_SUPABASE_ANON_KEY=<Publishable key from supabase status>
npm run dev                    # http://localhost:5173
```

Sign in as `tim@life.local` / `sophie@life.local` (password `life-local-dev`). These exist only in your local Docker database.

To try the Edge Functions locally: `supabase functions serve` (put local-only secrets in `supabase/functions/.env`, which is git-ignored).

## 2. Supabase project (production)

1. Create a project at supabase.com (free plan; region e.g. *West EU (London)*).
2. **Auth → Sign In / Providers**: keep *Email* enabled. **Turn off "Allow new users to sign up"**: this makes Life invite-only.
3. **Auth → URL Configuration**:
   - Site URL: `https://<github-user>.github.io/<repo>/`
   - Redirect URLs: the same URL, plus `http://localhost:5173/` for development.
4. Apply the schema from your machine:
   ```bash
   supabase login
   supabase link --project-ref <project-ref>
   supabase db push              # applies supabase/migrations (seed.sql is NOT applied)
   ```
5. **Create the two accounts**: Auth → Users → *Invite user* for Tim's and Sophie's emails (each gets a link and sets a password in the app). Alternatively use *Add user → Create new user* with a password and "Auto confirm". The free plan's built-in mailer is heavily rate-limited, so if an invite doesn't arrive, use *Create new user* instead.
6. **Create the household**: SQL Editor, run as postgres:
   ```sql
   select public.bootstrap_household('Tim & Sophie', '[
     {"email": "tim@your-domain",    "display_name": "Tim",    "avatar_color": "indigo"},
     {"email": "sophie@your-domain", "display_name": "Sophie", "avatar_color": "rose"}
   ]'::jsonb);
   ```
7. Note **Project URL** and the **publishable (anon) key** (Settings → API). Both are public by design.

## 3. GitHub Pages

1. Create a GitHub repository and push this folder. The repo name becomes the URL path (`/<repo>/`); the workflow sets `VITE_BASE_PATH` automatically.
   - Pages on a **private** repo requires a paid GitHub plan. A public repo is fine: the code contains no secrets and all data is behind Supabase Auth + RLS. The site has `noindex`.
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
3. **Settings → Secrets and variables → Actions → Variables** (not secrets; they are public):
   - `VITE_SUPABASE_URL` = `https://<ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = publishable key
4. Push to `main`. `.github/workflows/deploy.yml` typechecks, tests, builds and deploys. `database.yml` runs the pgTAP suite on a throwaway Supabase stack in CI.
5. On iPhone: open the site in Safari → Share → *Add to Home Screen*. On Android: Chrome → *Install app*.

## 4. Edge Functions (calendar, external feed, finance sheet)

```bash
supabase functions deploy calendar-events external-feed finance-sheet-sync
supabase secrets set ALLOWED_ORIGINS="https://<github-user>.github.io,http://localhost:5173"
```

All functions require a signed-in user's JWT and use RLS to scope what they read.

## 5. Google Calendar (read-only, recommended method)

1. console.cloud.google.com → create a project (free) → *APIs & Services → Library* → enable **Google Calendar API**.
2. *IAM & Admin → Service Accounts* → create one (no roles needed) → *Keys → Add key → JSON*. A key file downloads.
3. In Google Calendar (web), open your shared calendar's **Settings and sharing → Share with specific people** → add the service account's email with **"See all event details"**.
4. On that settings page, copy the **Calendar ID** (*Integrate calendar* section).
5. Store the key as a **secret** and delete the local file:
   ```bash
   supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON="$(cat path/to/key.json)"
   rm path/to/key.json
   ```
6. In Life → **Settings → Google Calendar** → *Secure (recommended)* → paste the Calendar ID.

Trade-offs and alternatives are in [DECISIONS.md](DECISIONS.md#adr-6-google-calendar-via-a-service-account-proxy).

### Google Sheet balances (MonthReport)

Uses the same service account and secret as the calendar.

1. In the same Google Cloud project, enable the **Google Sheets API** (*APIs & Services → Library*).
2. In the sheet, **Share** → add the service account's email as a **Viewer**.
3. In Life → **Finances → Accounts → Connect sheet**, paste the sheet's link and tab name.
4. **Link rows** to choose which rows become accounts. Summary rows, and rows the sheet's own subtotals leave out, are skipped by default.

The sheet is read-only to the app. Opening the Accounts tab re-syncs if the last sync is over an hour old, so a new month's column appears on its own. Layout rules are in `supabase/functions/_shared/month-report.ts`.

## 6. External feed sources (optional)

- **News / RSS**: Settings → Feed sources → *News / RSS feed* → feed URL. The server only fetches hosts listed in `FEED_ALLOWED_HOSTS` (default `feeds.bbci.co.uk,www.theguardian.com`). To add more:
  `supabase secrets set FEED_ALLOWED_HOSTS="feeds.bbci.co.uk,www.theguardian.com,<other-host>"`
- **Football (e.g. Chesterfield FC)**: create a free account at api-football.com (api-sports.io; the free plan has a daily request limit, and responses are cached for 10 minutes). Then:
  `supabase secrets set API_FOOTBALL_KEY=<your key>` (**secret**)
  Find the team ID once (replace KEY):
  `curl -s -H "x-apisports-key: KEY" "https://v3.football.api-sports.io/teams?search=Chesterfield"`
  Add a *Football* source in Settings with that ID. Without a key the card says it's unavailable; it never shows invented scores.
- **Sample data** adds clearly labelled placeholder items to preview the layout.

## What goes where

| Value | Where | Secret? |
|---|---|---|
| Supabase URL, publishable key | `.env.local`, GitHub Actions *variables* | No |
| Supabase service-role key | Nowhere in this app | **Yes**, never use it here |
| Google service-account JSON | `supabase secrets` | **Yes** |
| API-Football key | `supabase secrets` | **Yes** |
| Calendar ID, RSS URLs, team ID | In the app (database) | No |
