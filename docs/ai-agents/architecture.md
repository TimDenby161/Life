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
| Chief of Staff | Live | Tasks, history, every agent's pending suggestions, the person's calendar (times and titles) | Daily briefing per person, Monday weekly plan, deadline clusters, changes since yesterday, the top suggestions from all agents. Live ranking stays with Top jobs on Home. |
| Smart Task Manager | Live, daily + after completions | Tasks, 6 months of history, calendars for the week ahead | Put-off and overdue tasks, deadline risks, duplicates, one-offs that should be jobs, joint workload with effort estimates, automation candidates, weekly plan. |
| Wedding Planner | Live, daily | Wedding date (exact or month only), budget lines, supplier role and name, RSVP state, wedding-category tasks | Payments due in 30 days, budget lines with no supplier, overspends, RSVP chasing within 90 days of the date, monthly summary, a prompt to set the date. With only the month known it talks in months, skips RSVP timing and, within a year, asks for the exact day. Overdue checklist items are left to the Task Manager. |
| Language Coach | Live, daily | The person's own `language_progress` | Review pile-ups (20+), words that keep slipping (lapses ≥ 2, still at a short interval), languages left alone 5+ days. Never adds new words, so nothing mastered comes back. |
| Fitness Coach | Live, daily | The person's own exercise sessions (description, date, minutes); never weight or periods | Recovery after a week 1.5× the usual or 6 days in a row (and nothing that adds volume then), strength and mobility balance, one table tennis session a week rotating footwork / explosiveness / endurance, gaps for someone who usually trains. Says "nothing logged", never "you didn't exercise". With goals (`agent_settings.config`: active days a week, activities × times, optional ones) it nudges a required activity from Thursday, flags active days behind pace, reviews last week on Mondays, and moves the rest-day nudge to after seven in a row. |
| Household Coordinator | Live, weekly | Tasks, rooms, history | A library of 13 maintenance jobs (smoke alarms, boiler, filters…) suggested three at a time when nothing similar exists; rooms with no jobs. |
| Finance | Live, daily | GBP accounts counted in net worth (type, owner, opening balance), recorded balances, and transactions as account, date and amount only | The overall position only, by request: no bills, budgets or spending. Net worth worked out exactly as the Finances page does, at each sheet update (or month end, without the sheet): the change since the last one and what moved it, the year-on-year change, per person and joint, passing a £50k step; flagged when it falls 3%+ or three times running. Also: sheet balances older than 45 days (offers a task), card and loan balances rising three updates running. Money figures appear in its suggestions (both of you can see all finances anyway); they never go to the AI sentence or notifications. |
| Travel | Live, daily | The `trips` list; passport dates from `renewals`; open task titles | One card per trip listing what's still to sort once its window opens (time off 12 weeks before, travel 10 weeks abroad / 4 at home, stay 8 weeks, insurance 6 weeks, abroad only), urgent in the last fortnight; "Pack for…" three days out; for trips abroad within a year, a passport that expires within six months of coming home, or isn't on Renewals. No prices or outside sources; never books anything. |
| Career | Live, daily | The person's own `career_goals` | Check-in nudges after each goal's period (weekly to quarterly), a target date within four weeks (offers a "Next step" task), a missed target (done, new date or drop it), and one "Add a career goal" for someone with none. Reminders go only to the owner. Never searches for jobs, applies or contacts anyone. |
| Life Admin | Live, daily | The `renewals` list (names, owners, dates); open task titles | A reminder when something enters its warning window (presets: passport 6 months, MOT a month, insurance 4 weeks, energy fix 7 weeks…), urgent in the last week and once expired; offers a task ("Compare car insurance quotes") unless an open task already mentions it. A personal renewal only reminds its owner. "Renewed" on the card moves a repeating one on by its period. No email or calendar access. |

"Planned" agents appear in the AI Hub with a "Not built yet" badge and no switch, so nothing pretends to work.

## Calendar awareness

The Task Manager and Chief of Staff read the household's connected Google Calendars (the same service account as the Calendar page, `_shared/google-calendar.ts`) from yesterday to a week ahead, keeping only times, titles and whose calendar it is (`calendar_integrations.owner_id`, set in Settings; empty = shared, counts for both). Titles hidden in Settings stay hidden, and a calendar with "Plan around it" off (`use_for_agents`, e.g. Birthdays) is ignored. A day is packed with 3+ timed events or 4+ booked hours (`_shared/agents/calendar.ts`).

- Briefing: today's events, the count in the headline ("2 events"), and packed days in the next six.
- Task Manager: a job due on a packed day in the coming week is suggested a move to the nearest clearer day within three, never past its deadline. Someone's own job moves if their day is packed; a joint one only if everyone's is, or either's if it needs you both. Timed tasks and daily jobs stay put. Up to three a person.
- The AI sentence gets only the number of events. If the calendar can't be read, the run carries on without it.

## Pages driven by the agents

Every page with an agent opens on that agent's view, with the page itself under **Details** (`src/modules/agents/pageAgents.ts` maps pages to agents; `AgentShell` wraps the routes in `App.tsx`). The agent view shows the page title, what the agent noticed (observations) and suggests (with approve / snooze / dismiss), when each agent last ran with Run now, and a link to agent settings. Home's view is the morning briefing plus the top five suggestions from all agents; Calendar's is today's events and packed days from the briefing, plus moves off packed days.

| Page | Agent view |
|---|---|
| Home | Chief of Staff briefing + top suggestions from every agent |
| Tasks | Task Manager (overdue, put off, deadlines, duplicates, packed days) |
| Jobs | Household Coordinator + the Task Manager's repeating-job findings |
| Calendar | Today and packed days + moves off packed days |
| Finances, Investments | Finance |
| Wedding | Wedding Planner |
| Languages | Language Coach |
| Health | Fitness Coach |
| Statistics | Workload |

Feed, Settings and the AI Hub have no agent view. A link into a page (any query such as `?lang=zh`, or a sub-path) opens Details directly, so task and language deep links work as before; `?view=agent` / `?view=details` choose explicitly.

## AI priorities (Claude picks the top jobs)

Per person, off by default (`user_preferences.ai_priorities`, the "AI picks my top jobs" switch in AI Hub → Agents). In the Chief of Staff's morning run (and Refresh), the function builds a shortlist of up to 40 jobs the person could do (late, due within a week, a deadline within three weeks, or voted / high priority; never ones waiting on another), and sends Claude the titles, categories, dates, flags and today's busy times for them and their partner, with no event titles, ids, health data or amounts (`_shared/agents/priorities.ts`). Claude returns up to five refs with a short reason; anything not on the shortlist is dropped. The picks are stored on the briefing (`content.top`) and go first in Home's Top jobs on the person's own tab that day, marked ✦ with the reason; everything else keeps the usual score order. No key, over budget, an error or an odd answer all mean no picks, and Top jobs stays as it was.

Two ways to run it. **The morning Claude routine** (the default, on the household's Claude subscription, no API key): a scheduled Claude Code routine at 06:15 UTC calls the agents function with `x-priorities-secret` (`PRIORITIES_SECRET`): `{"mode":"priorities-input"}` returns each opted-in person's shortlist (refs are task ids) and the judging instructions; it decides, then sends `{"mode":"priorities-save", key, picks}` for each person. The function re-checks every pick against that person's shortlist and saves them through `agent_set_top_picks` (service role only) onto that day's briefing. Later briefing refreshes keep the day's picks. **Or the API**: with `ANTHROPIC_API_KEY` set, the Chief of Staff run asks Claude itself (below).

API model `AGENT_LLM_MODEL` (default claude-opus-5-5), effort medium. About 3,000 tokens in and a few hundred out: roughly $0.02 a call, so about $1–2 a month for two people with the odd refresh. It shares the monthly cap with the AI sentence (`AGENT_LLM_MONTHLY_BUDGET_USD`, default now $3).

## Claude does jobs (12 Nov 2026)

The same morning routine also works through the to-do list. `priorities-input` now carries `work_instructions`, a `work_answer` example and `work`: per household, the open one-off jobs of the people with "AI picks my top jobs" on (theirs, shared, or for both; up to 80), with title, category and dates, any questions Claude asked before with their answers, and, when a wedding venue job is on the list, the wedding's month, the number of guests on the list and the venue names already saved. Never a "C4" category, a repeating job, a job waiting on another, one that already has a result, or one whose question is still waiting (`_shared/agents/work.ts`, `loadWork` in `context.ts`).

For each job the routine either leaves it, asks, or does it with web search, and sends `{"mode":"work-save", key, items}`:

- `{ref, kind: "ask", question}` becomes a task of its own beside the job (same list, category and person; due that day; 5 minutes; never `needs_both`), with `tasks.ai_asks_task_id` pointing at the job. It has an answer box wherever it shows (Home, Tasks, the Wedding plan). `answer_ai_question` saves the answer in `tasks.ai_answer` and ticks the question off as the person answering, through `complete_task_occurrence`. The next morning the job comes back with `answers`. A question closed without an answer comes back as `unanswered` and is not asked again. Open questions always lead that day's picks (`withQuestions`), whatever the routine picked.
- `{ref, kind: "done", summary, body, links, venues}` is left on the job as `tasks.ai_result` (summary, plain text, up to 8 web links, the day). The job row shows ✦ and the summary; its detail shows all of it, labelled as Claude's web search to be checked. `venues` (venue jobs on the wedding checklist only) are added to `wedding_venues` with `created_by` null, shown as "· Claude", skipping names and links already there, with no feed posts.

`cleanWork` checks everything against the jobs offered as they are now: unknown refs, repeats, questions or summaries holding links, anything that isn't an http(s) link, text over the limits and items over the day's limits (3 results, 2 new questions, 3 questions waiting at once) are dropped. `agent_save_work` (service role only) re-checks that each job is an open one-off in the household. Nothing completes, edits, moves or deletes a job. Emails and messages are only ever drafted into a result for you to send: the routine runs with no connectors and no mail credentials, its prompt forbids sending by any means, and `cleanWork` drops a result whose summary says anything was sent, booked or paid. The routine has web search but not web fetch, and is told that titles, answers and anything it reads on the web are data, not instructions.

**Morning pop-up.** On Home, on days the run did or asked something, a sheet titled "This morning" lists the jobs done that day (each opens to the full result) and every question still waiting, with answer boxes (`MorningRunSummary`, `agents/lib/morningRun.ts`). Accept closes it until the next day's run on every device (`user_preferences.ai_work_seen_on`, migration `20261112000200`). Only for people with AI picks on.

This is the one place an agent changes application data without an approval; it was asked for on 12 November 2026.

## Daily ideas (13 Nov 2026)

Tim asked for tasks in every area of life to land on the daily list, added rather than suggested. So each morning the routine adds one small task (5 to 45 minutes) in each of finance, wedding, meals, holidays, shopping, health, table tennis, side hustles, people and languages that each person has picked in Settings (`user_preferences.idea_areas`, all ten by default; Sophie's leave out table tennis and side hustles), whether or not they have AI picks on.

- **Input** (`priorities-input` → `ideas`): per person, the areas without an open idea of theirs, each with a few facts from `loadAreas` (savings goal names, the wedding month and venue and guest counts, trip names and dates, shopping list names and dates, birthdays and friends not seen for a while, languages studied, the last coaching day, side hustle names, how many meals are planned) and the titles of their open jobs there. Names and dates only: no amounts, notes, or health readings or exercise (health gets no facts).
- **Output** (`ideas-save`): `{area, title, minutes}` per area, checked by `cleanIdeas` against the areas still free, then written by `agent_save_ideas` (service role only): on the person's own list, for them, due today, under the area's category (the wedding checklist's for the wedding; one named for the area that isn't the other person's, made if missing; none if the name is taken by the other person's category). `tasks.ai_area` marks them and isn't client-writable.
- **Limits**: one open idea per area per person, so they never pile up; they're ordinary tasks you tick off or delete. Personal-list tasks post nothing to the feed.
- **Home**: tasks added today for today (by hand or as ideas) always show in Today's tasks, even when the AI plan is full (`added` in `todaysPlan`).

## Home and per-tab picks (7 Nov 2026)

Home's agent view is three cards and nothing else: **Today (weekday)**, the rest of today's calendar (my calendars and shared ones with "Plan around it" on, read live, finished events dropped); **Tasks I can do today**, the Top jobs card with the day's AI picks first; and **News**, the top five headlines from the first RSS source in the Feed (one tap adds BBC News if there's none).

AI picks are now per Top jobs tab in `ai_picks` (household-readable, written only through `agent_save_picks`): each person with "AI picks my top jobs" on gets their own tab picked, and Together is picked when anyone has it on. A person's tab is only picked with their own switch on, because it sends their job titles to Claude. Each pick says whether it needs you at home or can be done anywhere; the **At home / Out** switch on the card (remembered on the device for the day) leaves only the anywhere jobs, using a word list (`canDoAnywhere`) for jobs the AI didn't tag. Up to eight picks a tab, with at least three anywhere jobs when there are any.
