# AI agents: architecture

_Written 6 November 2026, from the repository at commit 82920cc._

Part 1 describes the Life app as it is. Part 2 is the agent design built on it. The implementation plan and progress are in [implementation-plan.md](implementation-plan.md).

## Part 1: the existing application

### Stack

| Layer | What it is |
|---|---|
| Frontend | React 19 + TypeScript + Vite SPA, installed as a PWA. TanStack Query for server state, Radix + shadcn-style components, Tailwind 4, Recharts. |
| Hosting | GitHub Pages (static files only, `deploy.yml` on push to `main`). |
| Backend | Supabase only: Postgres 17 with RLS, Auth (email + password, invite only), Realtime, Edge Functions (Deno). No custom server. |
| Integrations | Google Calendar (read-only service account, `calendar-events`), Google Sheet balance sync (`finance-sheet-sync`), RSS and API-Football (`external-feed`). Secrets live in Edge Function secrets. |
| Tests | Vitest (pure logic, components, static security guards in `src/test/security.test.ts`), pgTAP (`supabase/tests/database`, 15 files), CI in `.github/workflows`. |

### Modules (tabs)

Home (pot tiles + Top jobs), Tasks, Jobs, Finances, Investments, Wedding, Calendar, Feed, Languages, Health, Statistics, Settings. Each lives in `src/modules/<name>/` and is registered in `src/modules/registry.tsx`.

### Tasks, in detail

- `tasks` is the definition; `task_occurrences` is each instance (one for a one-off, one per due date for a repeat). Completion, skip and reopen only go through `complete/skip/reopen_task_occurrence`, which append to the append-only `task_completion_events` (with a snapshot of title, category, assignee).
- Recurrence: fixed rules (`daily|weekly|monthly|yearly`) or jobs (`afterDone: true`, due one interval after last done). Logic in SQL (`recurrence_next_date`) and mirrored in `tasks/lib/recurrence.ts`.
- Ownership: one Joint list and one personal list per member. A category can have an owner (`task_categories.owner_id`), which forces its tasks onto that person. `needs_both` marks "Together" tasks. `ownerOf`/`inView` in `tasks/lib/owner.ts` decide whose a task is.
- Prioritisation already exists as rules, not AI: `tasks/lib/topJobs.ts` scores every open task (due date, cycle progress, deadline run-up, votes, priority, wording, time of day). Home's Top jobs is that score. Delays grow 1, 2, 4, 7 days (`delay_count`), `importance_votes`, hard `deadline`, `waiting_on_task_id`, dated subtasks.
- Statistics come from the event log (`tasks/lib/stats.ts`), defaulting to joint tasks because personal use is lopsided.

### Data isolation and permissions

- Every table has RLS keyed on `is_household_member(household_id)`; children use composite FKs `(parent_id, household_id)`; default privileges are revoked, so every column grant is explicit; `anon` has nothing.
- Within the household almost everything is shared by design: both members read all tasks (personal lists included), all finances, and all health and investment records (by request, ADR 9). Health, languages and investments are owner-write only. `user_preferences` is the only owner-only table.
- Trusted columns (`created_by`, history, activity) are written only by SECURITY DEFINER functions with `search_path = ''` and explicit membership checks.

### Existing AI, agents, schedules

- **No AI integration, no MCP server, no agent framework, no LLM key.** Top jobs was deliberately built as rules; the owners were told an LLM version would need a paid key and would send task titles to Anthropic.
- **No scheduled jobs.** Nothing runs while the app is closed. Edge Functions only run when a signed-in browser calls them. `pg_cron`, `pg_net` and Vault are available in the Supabase image (pg_net and Vault already installed locally) but unused.
- **No notifications.** Push is listed as a "next step" in STATUS.md.

### Limitations that shape the design

1. **Background execution.** GitHub Pages can't run anything. The only always-on compute is Postgres (pg_cron) and Edge Functions (on request). Scheduled agents must be pg_cron → pg_net → Edge Function.
2. **Edge Functions act as the user** today (`userClient`). A scheduled run has no user, so it needs the service-role key, which bypasses RLS. That code has to scope every read by `household_id` itself and must not write application data.
3. **Free tier.** Edge Function invocations and pg_cron are cheap but not unlimited; one hourly tick per project is fine, per-minute polling is not.
4. **Ranking lives in the browser.** `taskScore` depends on the hour of day and imports app modules (`@/` alias, date-fns), so it can't run unchanged in Deno, and a score computed at 6am is stale by lunch. The agents should not duplicate it.
5. **Shared-by-default privacy.** "Private" barely exists in the data model; the agents must not make it worse by, for example, telling one person conclusions drawn from the other's personal list.
6. **Migrations are applied by hand.** The owners run `supabase db push` themselves; nothing here gets deployed without asking.

## Part 2: the agent design

### Principles

- **Rules first, LLM only where it adds something.** Every agent's analysis is deterministic TypeScript with unit tests. An LLM is used for one thing only (an optional one-sentence briefing summary), is off unless a key is set and the person opts in, and has a monthly budget.
- **Agents advise, people act.** Agents write only to agent tables. Nothing changes a task, a balance or anything else until a person presses Approve, and the approval runs as that person through the normal tables and triggers.
- **No new task system.** Approved suggestions become ordinary tasks (or ordinary edits to existing ones).
- **No framework.** A registry, a dispatcher and plain functions. LangChain or CrewAI would add a dependency and a runtime for what is a loop over pure functions.

### Components

```
pg_cron (hourly :05) ──pg_net──▶ Edge Function `agents`  (service role, scheduled mode)
                                   │  for each household:
                                   │    which agents are due?  (schedule.ts, local time)
                                   │    agent_claim_run()      (dedupe + retry, SQL)
                                   │    load context           (explicit household-scoped reads)
                                   │    analyse                (pure TS: taskManager, chiefOfStaff)
                                   │    [optional LLM summary] (budget-checked)
                                   │    agent_finish_run()     (write suggestions/briefings, expire stale)
Browser AI Hub ──JWT──▶ same function (on-demand mode, rate-limited, membership checked)
Browser AI Hub ──RPC──▶ respond_agent_suggestion()  approve → task insert/update as the user
task completed ─trigger─▶ queued agent_run ("event") ─▶ picked up by the next hourly tick
```

| Piece | Where | Notes |
|---|---|---|
| Agent registry | `supabase/functions/_shared/agents/registry.ts` | Pure; imported by the Edge Function and the UI (same pattern as `month-report.ts`). Each agent: id, name, status (`live`/`planned`), default schedule, what data it reads, which actions it can propose. |
| Orchestrator | `supabase/functions/agents/index.ts` | The dispatcher. Chief of Staff runs after the Task Manager in the same tick and reads its fresh output, rather than re-analysing. |
| Specialist logic | `supabase/functions/_shared/agents/*.ts` | Pure functions over a typed context. Unit-tested in `src/modules/agents/lib/*.test.ts`. |
| Scheduling | `pg_cron` job `agents-hourly` | Calls the function with a shared secret held in Vault. One tick an hour; daily agents run on the first tick after 6am local, weekly ones on Monday. Missed ticks catch up later the same day/week. |
| State + history | Postgres tables (below) | RLS like every other table. |
| AI Hub | `src/modules/agents/` at `/ai` | Overview, Suggestions, Agents, History. |

### Data model

| Table | Holds | Who can read | Who writes |
|---|---|---|---|
| `agent_settings` | Per person per agent: enabled, schedule (`daily`/`weekly`/`off`). | Owner only | Owner |
| `user_preferences.ai_summaries` | Per person: the optional AI sentence on/off (a column on the existing owner-only table). | Owner only | Owner |
| `agent_runs` | Execution history: agent, trigger (`scheduled`/`event`/`manual`), run key, status, attempts, timings, counts, tokens, estimated cost, error message. | Household | Service role only, via `agent_claim_run` / `agent_finish_run` |
| `agent_suggestions` | Observations and proposals: kind, title, why, severity, optional action payload, `recipients` (one shared row when it's for both, so it's approved once), status `pending/snoozed/approved/dismissed/expired`, dedupe key, the task it is about. | Its recipients | Agents create; people change status only through `respond_agent_suggestion` |
| `agent_briefings` | Structured daily/weekly briefing per person (JSON facts, optional AI sentence flagged as AI). | Recipient only | Service role only |
| `agent_actions` | Append-only log of every response: approved / dismissed / snoozed, by whom, and the task created or changed. | Household | `respond_agent_suggestion` only |

Memory, as the brief distinguishes it:

1. **Preferences and goals**: `agent_settings`, `user_preferences.ai_summaries`. (No goals are stored yet; the planned Fitness Coach needs them.)
2. **Application records**: the existing tables, read at run time. Nothing is copied; suggestions keep only a task id and a title snapshot for display.
3. **Agent observations**: `agent_suggestions` with no action (kind `insight`, `workload`, …). Always phrased as observations ("looks like", counts), never as facts about the people.
4. **Pending suggestions**: `agent_suggestions.status = 'pending'` (or `snoozed` until a date).
5. **Approved actions**: `agent_suggestions.status = 'approved'` + `agent_actions` rows with the resulting task id.
6. **Execution history**: `agent_runs`.

Context for each run is loaded with narrow selects (open occurrences with task fields, 180 days of completion events, lists, categories, members), plus each specialist's own data. Task descriptions, comments, supplier contact details, guest names, weight, periods, accounts and investments are never loaded; `src/test/agents-guard.test.ts` holds the allow-list. Only the task briefing ever goes to the LLM.

### Execution modes

- **Scheduled.** Hourly tick; `schedule.ts` decides what is due from the household's local time (Europe/London, DST-safe). Run keys are `daily:2026-11-06`, `weekly:2026-W45`.
- **Event-driven.** An `after insert` trigger on `task_completion_events` inserts a `queued` Task Manager run keyed by the local hour (`event:2026-11-06T14`), `on conflict do nothing`. The next tick runs it. No HTTP calls from triggers; bursts of completions collapse to one run. Approaching deadlines are covered by the daily run.
- **On demand.** "Run now" in the AI Hub calls the function with the person's JWT. The function checks membership, then runs the same pipeline with run key `manual:<10-minute bucket>`, so double taps and repeated presses inside ten minutes don't re-run.

### Reliability

- **No duplicate runs.** `agent_runs` has a unique `(household_id, agent_id, run_key)`. `agent_claim_run` inserts or re-claims atomically: it returns a run id only for a new key, a `queued` run, a `failed` run with fewer than 3 attempts, or a `running` run stuck for over 15 minutes. Otherwise it returns null and the caller skips.
- **Retries.** A failure records the error and leaves the run `failed`; the next hourly tick re-claims it (up to 3 attempts).
- **No repeated or conflicting suggestions.** Each suggestion has a dedupe key (e.g. `task:<task id>`), unique per agent; a task gets at most one "what to do about it" suggestion, so two rules can't propose different dates. Per-kind caps (e.g. three "not done for a while" per person) stop a backlog becoming a flood. A run upserts: pending ones are refreshed, dismissed and approved ones are left alone (so a dismissed idea doesn't come back), snoozed ones wake when their date passes, and pending ones the run no longer produces become `expired` (the task was done, so the advice no longer applies). Approving checks the suggestion is still pending and that its task still exists and is open.

### Safety and permissions

- **Two people, one household.** Suggestions about a task on someone's personal list or in their owned category go to that person only. Joint-task suggestions go to whoever has the agent enabled. Workload balance only uses joint tasks, as Statistics does. Briefings are recipient-only.
- **Each person controls their own agents.** Settings are owner-only. Turning an agent off means that person gets nothing from it; the other person's settings never switch it back on for them.
- **Writes.** Service-role code calls exactly two SQL functions, which only touch agent tables. Every change to application data comes from `respond_agent_suggestion`, running as the person who pressed Approve, with the action payload re-validated in SQL (same household, task still open, date sane). Supported actions: create a task, move an open task's date, archive a task (reversible from Tasks). No deletes, no messages, no money, no bookings.
- **Secrets.** `SUPABASE_SERVICE_ROLE_KEY` (provided by Supabase), `AGENT_CRON_SECRET` and the optional `ANTHROPIC_API_KEY` are Edge Function secrets. The cron secret and project URL for pg_net are in Vault. Nothing new reaches the browser.
- **Untrusted content.** Task titles are data. They are passed to the optional LLM inside a structured tool schema, the output is a single plain sentence checked for length, and it is shown labelled as AI. It cannot trigger actions.
- **No health data or amounts** in agent tables, run logs, feed or LLM prompts (same rule as `feed_events`).

### Cost

- Default cost is zero: rules only, one Edge Function call an hour (~720/month, inside the free tier).
- With the LLM summary on: one small Haiku call per person per day (a few hundred tokens), so pennies a month. Usage is recorded per run (input/output tokens, estimated cost) and a monthly cap (`AGENT_LLM_MONTHLY_BUDGET_USD`, default 1) is checked before every call; over the cap, the briefing falls back to the rules text.

### The ten agents

| Agent | Status | Reads | Notes |
|---|---|---|---|
| Chief of Staff | Live | Tasks, history, every agent's pending suggestions | Daily briefing per person, Monday weekly plan, deadline clusters, changes since yesterday, the top suggestions from all agents. Live ranking stays with Top jobs on Home. |
| Smart Task Manager | Live, daily + after completions | Tasks, 6 months of history | Put-off and overdue tasks, deadline risks, duplicates, one-offs that should be jobs, joint workload with effort estimates, automation candidates, weekly plan. |
| Wedding Planner | Live, daily | Wedding date (exact or month only), budget lines, supplier role and name, RSVP state, wedding-category tasks | Payments due in 30 days, budget lines with no supplier, overspends, RSVP chasing within 90 days of the date, monthly summary, a prompt to set the date. With only the month known it talks in months, skips RSVP timing and, within a year, asks for the exact day. Overdue checklist items are left to the Task Manager. |
| Language Coach | Live, daily | The person's own `language_progress` | Review pile-ups (20+), words that keep slipping (lapses ≥ 2, still at a short interval), languages left alone 5+ days. Never adds new words, so nothing mastered comes back. |
| Fitness Coach | Live, daily | The person's own exercise sessions (description, date, minutes); never weight or periods | Recovery after a week 1.5× the usual or 6 days in a row (and nothing that adds volume then), strength and mobility balance, one table tennis session a week rotating footwork / explosiveness / endurance, gaps for someone who usually trains. Says "nothing logged", never "you didn't exercise". With goals (`agent_settings.config`: active days a week, activities × times, optional ones) it nudges a required activity from Thursday, flags active days behind pace, reviews last week on Mondays, and moves the rest-day nudge to after seven in a row. |
| Household Coordinator | Live, weekly | Tasks, rooms, history | A library of 13 maintenance jobs (smoke alarms, boiler, filters…) suggested three at a time when nothing similar exists; rooms with no jobs. |
| Finance | Live, daily | GBP accounts counted in net worth (type, owner, opening balance), recorded balances, and transactions as account, date and amount only | The overall position only, by request: no bills, budgets or spending. Net worth worked out exactly as the Finances page does, at each sheet update (or month end, without the sheet): the change since the last one and what moved it, the year-on-year change, per person and joint, passing a £50k step; flagged when it falls 3%+ or three times running. Also: sheet balances older than 45 days (offers a task), card and loan balances rising three updates running. Money figures appear in its suggestions (both of you can see all finances anyway); they never go to the AI sentence or notifications. |
| Travel Planning Agent | Planned | | No trip data in the app; no approved price source. |
| Career Development Agent | Planned | | No goals stored; needs approval for any job board. |
| Life Admin | Live, daily | The `renewals` list (names, owners, dates); open task titles | A reminder when something enters its warning window (presets: passport 6 months, MOT a month, insurance 4 weeks, energy fix 7 weeks…), urgent in the last week and once expired; offers a task ("Compare car insurance quotes") unless an open task already mentions it. A personal renewal only reminds its owner. "Renewed" on the card moves a repeating one on by its period. No email or calendar access. |

"Planned" agents appear in the AI Hub with a "Not built yet" badge and no switch, so nothing pretends to work.
