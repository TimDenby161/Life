# Database

Postgres on Supabase. Migrations in `supabase/migrations/` (apply with `supabase db push` to the hosted project, or `supabase db reset` locally). Types: `npm run db:types`.

## Conventions

- Every household-owned row has `household_id`. RLS uses `is_household_member(household_id)` (SECURITY DEFINER, so no policy recursion).
- Child tables reference parents with composite FKs `(parent_id, household_id) → parent(id, household_id)`; people with `(household_id, user_id) → household_members`. A row can't point into another household.
- `created_by` / `author_id` / `user_id` default to `auth.uid()` and are not client-writable.
- Clients get explicit per-column `insert`/`update` grants; `anon` gets nothing.
- Timestamps are `timestamptz`; date-only facts (due dates, transaction dates) are `date`.
- Money is `bigint` minor units with currency on the account (or the budget/goal).

## Tables

| Area | Table | Purpose / notes |
|---|---|---|
| Core | `profiles` | One per auth user (trigger-created). Visible to self and household. |
| | `households` | Name, default currency, timezone. |
| | `household_members` | (household, user, role). One household per user. Admin-only writes. |
| | `user_preferences` | Per-user theme, week start, settings JSON. |
| | `feed_events` | Automatic activity. Written only by definer functions. |
| Tasks | `task_lists` | Exactly one Joint list + one personal list per member. |
| | `task_categories` | Household categories. |
| | `tasks` | Definition: list, assignee, priority, due date/time, recurrence JSON, archived. |
| | `task_occurrences` | Each instance of work; status `open/done/skipped`; assignee snapshot; `generated_from`. |
| | `task_completion_events` | Append-only history: `completed/skipped/reopened`, who did it, who recorded it, task snapshot. No FKs, so it survives deletion. |
| | `task_subtasks`, `task_comments` | Checklist items (reset per recurrence) and comments. |
| Finances | `financial_accounts` | Joint/personal, type, currency, opening balance; `is_liability` generated. |
| | `finance_categories` | Income/expense categories. |
| | `financial_transactions` | Signed `amount_minor`, kind `income/expense/transfer/adjustment`, `transfer_id`, import fields. |
| | `account_balance_history` | Recorded balances (real data points). |
| | `budgets` | Monthly amount per expense category, effective from a month. |
| | `savings_goals` | Target, optional linked account or manual amount; `reached_at` set automatically. |
| | view `financial_account_balances` | `security_invoker` view of current balances. |
| Feed | `feed_posts`, `feed_comments`, `feed_reads` | Messages, replies, read receipts. Only authors edit text; anyone can pin. |
| | `feed_sources` | External provider config (no secrets). |
| Calendar | `calendar_integrations` | Google calendar ID or embed URL per household (no credentials); `owner_id` says whose calendar it is (empty = shared), for the agents. |
| Health | `health_metric_definitions` | Built-in metrics; only `weight` remains. Not client-writable. |
| | `health_measurements` | Value + unit + time; import fields. |
| | `health_exercise_sessions` | Free-text `description`, `started_at`, `duration_minutes` |
| | `health_periods` | `started_on`, optional `ended_on`. Tracker shown on the Health tab of a profile with `tracks_periods` (Sophie; set by migration, not client-writable). |
| Languages | `language_study` | Per person and language (`zh`, `es`); `active` says who learns what (stopping keeps settings and progress): words/characters a day, HSK start level, the jobs each part ticks off. |
| | `language_progress` | One row per word or character a person has learned, keyed by its text; `due_on`/`interval_days` are the review schedule. The word lists themselves ship with the app. |
| Investments | `investment_holdings` | One row per holding per person: value entered by hand (no price feed), whether it's in the Pie, shares/bonds/cash, target % of the long-term mix, verdict (keep/sell/review) and why. Owner writes, both read. |
| AI agents | `agent_settings` | Per person per agent: on/off, briefing schedule, `config` JSON (e.g. fitness goals). Owner only. |
| | `agent_runs` | Execution history: trigger, run key (unique per agent), status, attempts, counts, LLM tokens and estimated cost, error. Read by both; written only by the service role. |
| | `agent_suggestions` | What agents noticed or propose: kind, why, severity, optional action, `recipients`, status (pending/snoozed/approved/dismissed/expired), dedupe key. Recipients only. |
| | `agent_briefings` | Daily/weekly briefing JSON per person, optional AI sentence. Recipient only. |
| | `agent_actions` | Append-only log of approve/dismiss/snooze and the task it created or changed. |
| | `renewals` | Things that expire (passport, MOT, insurance, contracts): name, owner (null = joint), expiry date, days of warning, months between renewals. Household-shared; read by Life Admin. |
| | `trips` | Trips for the Travel agent: name, dates, owner (null = both), abroad, and todo/done/not_needed for time off, travel, stay and insurance. No bookings or prices. Household-shared. |
| | `career_goals` | One person's career goals: title, target date, check-in period, last check-in, done. Both read; owner writes. |
| | `push_subscriptions` | Devices a person allowed briefing notifications on (Web Push endpoint and keys). Endpoint must be a browser push service. Owner only; `user_preferences.briefing_push` is the on/off switch (off by default). |
| | `investment_settings` | Per person: monthly contribution, how much to keep as cash for the wedding (null = undecided), date values were checked. The plan is computed in `investments/lib/plan.ts`. |

## Functions (RPC)

| Function | Who | What |
|---|---|---|
| `complete_task_occurrence(id, completed_by?, completed_at?, note?)` | member | Marks done, appends history, generates next occurrence, logs activity. |
| `skip_task_occurrence(id, note?)` | member | Recurring only; history + next occurrence. |
| `reopen_task_occurrence(id, note?)` | member | Undo; removes untouched follow-up and the activity event. |
| `create_transfer(from, to, amount, date, description, to_amount?, notes?)` | member (invoker) | Inserts both legs atomically. |
| `account_balance_on(account, date)` | member | Balance at a date (RLS applies). |
| `recurrence_next_date(rule, anchor, after)` | any | Pure recurrence maths. |
| `respond_agent_suggestion(id, response, snooze_until?)` | recipient | approve / dismiss / snooze; approving applies the action (create task, move date, archive) as the caller. |
| `agent_claim_run(...)`, `agent_finish_run(...)` | **service role only** | Start a run (refused if its key is done) and record its results. Used by the `agents` Edge Function. |
| `push_subscriptions_gone(household_id, ids)` | **service role only** | Forget devices the push service says have unsubscribed. |
| `bootstrap_household(name, members jsonb)` | **admin only** | Creates the household, lists and default categories. |

## RLS summary

- **Household data** (tasks, finances, feed, calendar config): any member can read and write; inserts must set the caller as creator.
- **Task history and activity**: read-only to clients; written by RPCs and triggers.
- **Health** and **languages**: read by any household member; insert, update and delete only by the owner.
- **Preferences**: owner only.
- **Outsiders** (other households, `anon`): nothing. Verified by `supabase/tests/database/*.test.sql`.

## Testing

`npm run test:db` generates the recurrence test from the shared fixture and runs pgTAP against the local stack. The tests impersonate Tim, Sophie and an outsider via `request.jwt.claims`, run inside a rolled-back transaction, and work with or without demo data.
