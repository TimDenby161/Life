# Security

## Reporting a problem

Please report security issues privately through
[GitHub's private vulnerability reporting](https://github.com/TimDenby161/Life/security/advisories/new),
not in a public issue. This is a private two-person app, so expect a reply within about a week.

## What there is to protect

Life is a single-page app (GitHub Pages) over Supabase. Accounts are invited, not open, and
everything the app stores belongs to one household. All protection lives in Postgres, never in
hidden UI:

- **Row level security on every table**, keyed on `is_household_member(household_id)`; child
  tables carry composite foreign keys so a row can't point into another household.
- **Nothing granted by default.** Tables, columns and functions are granted one by one; computed
  and history columns (`created_by`, status, completion history, AI fields) are not client
  writable. No function is executable by `anon`, and PUBLIC holds no EXECUTE on any function
  (since 2026-11-26).
- **Trusted writes go through SECURITY DEFINER functions** on an empty `search_path`, which check
  membership themselves.
- **Edge Functions** read one household at a time; the service-role key and Google and Anthropic
  keys are Edge Function secrets, never in the frontend (`VITE_*` values are public by design).
- **AI only suggests**: agents write through fixed RPCs and never send, book or pay.

The guards are tested on every push: `src/test/security.test.ts` (static checks of the
migrations), and the pgTAP suite in `supabase/tests/database/` (household isolation, forged
fields, function grants) on a throwaway local stack (`.github/workflows/database.yml`).
