# AI agents: status

_Last updated 6 November 2026._ All ten agents are built. Travel and Career (migration `0600`) are local until it's applied and the function redeployed; the rest are live. **Live since 6 November 2026**: migrations applied, `agents` function deployed, the hourly job running (first run: all six succeeded), AI Hub deployed.

## Working

| Piece | Where | Checked by |
|---|---|---|
| Tables, RLS, grants, realtime | `supabase/migrations/20261106000100_agents.sql` | pgTAP `16_agents.test.sql` (49 checks), static guards |
| Run dedupe, retries (3), stuck-run recovery | `agent_claim_run` | pgTAP |
| Suggestion upsert, expiry, dismissed stays dismissed, snooze wake-up | `agent_finish_run` | pgTAP |
| Approve (create task / move date / archive), dismiss, snooze, as the caller, logged | `respond_agent_suggestion` | pgTAP, and in the browser |
| Recipient-only suggestions and briefings; owner-only settings; outsiders see nothing | RLS | pgTAP |
| Event runs queued when a task is done | trigger on `task_completion_events` | pgTAP |
| Hourly schedule | `pg_cron` → `agents_dispatch()` → Edge Function | pgTAP (job registered, no-op without secrets); scheduled path called by hand with curl |
| Dispatcher, on-demand runs, rate limit | `supabase/functions/agents` | curl and the browser against the local stack |
| Task Manager | `_shared/agents/taskManager.ts` | 32 Vitest cases; run on local demo data |
| Chief of Staff | `_shared/agents/chiefOfStaff.ts` | 12 Vitest cases; run on local demo data |
| Wedding Planner, Language Coach, Fitness Coach, Household Coordinator | `_shared/agents/{wedding,languages,fitness,household}.ts` | 24 Vitest cases; run on local data; Sophie can't see Tim's fitness or language suggestions (checked through the API) |
| Month-only wedding date; per-person fitness goals | migrations `0200`, `0300`; `FitnessGoals.tsx`, Wedding settings | Vitest, pgTAP, and entered through the UI at phone width locally |
| AI Hub (`/ai`): Overview, Suggestions, Agents, History | `src/modules/agents` | browser (desktop), typecheck, build |
| Service-role code only reads its own household and only writes agent tables | `src/test/agents-guard.test.ts` | Vitest |
| Finance (overall position only) | `_shared/agents/finance.ts`, `loadFinance` | 21 Vitest cases; on local data its net worth matched `account_balance_on` to the pound; guard checks it reads no budgets, goals, categories or transaction details |
| Life Admin (renewals) | migration `0500`, `_shared/agents/lifeAdmin.ts`, `Renewals.tsx` on the Life Admin card | 11 Vitest cases; pgTAP `18_renewals.test.sql` (9); run locally against a seeded renewal. The card itself hasn't been looked at in a browser yet |
| Travel and Career | migration `0600`, `_shared/agents/{travel,career}.ts`, `Trips.tsx`, `CareerGoals.tsx` | 20 Vitest cases; pgTAP `19_trips_career_goals.test.sql` (12); both run locally against a seeded trip, passport and goal. The cards haven't been looked at in a browser yet |
| Calendar-aware briefings and packed-day moves | migration `0700` (`calendar_integrations.owner_id`), `_shared/agents/calendar.ts`, Settings "whose calendar" | 15 Vitest cases (local time incl. BST, shared vs personal calendars, overnight events, deadlines); pgTAP `20_calendar_owner.test.sql`. The Google fetch reuses the Calendar page's code but hasn't run in the agents function yet: there's no service-account key locally |
| AI sentence sees Task Manager suggestions only (no money or health titles) | `llm.ts` `TASK_SUGGESTION` | Vitest |
| Briefing notifications (Web Push, off by default) | migration `0400`, `_shared/push.ts`, `agents/notify.ts`, `public/push-sw.js`, AI Hub → Agents | 9 Vitest cases (encryption decrypted on the browser side, VAPID signature verified, gone devices); pgTAP `17_push_notifications.test.sql` (14); locally the scheduled briefing sent through FCM, which rejected the fake device, and the function forgot it |

## Goals (9 November 2026)

Each agent now works from goals set on its card in AI Hub → Agents (`agent_settings.config`, owner only), so Tim and Sophie each get coaching aimed at their own goals.

| Piece | Where | Checked by |
|---|---|---|
| Fitness: "at most" limits, tournaments (taper before, easy day after, no conditioning or strength in the last 3 days), one joint suggestion when both have the same session to do | `fitness.ts`, `FitnessGoals.tsx` | Vitest (`goals.test.ts`); run locally |
| Weight & Food (new): Monday weight review against the pace to a target, weigh-in nudge, takeaway limits (own and together), meal planning day. Weight goes only to its owner, never to the AI sentence or a notification | migration `20261109000100` (`takeaways`), `nutrition.ts`, `FoodGoals.tsx`, Health page Takeaways | Vitest, guards, pgTAP `23_takeaways_people.test.sql`; run locally |
| Career: coaching before and after calendar events whose title has your chosen words | `career.ts` `analyseEvents`, `EventCoaching.tsx` | Vitest; no calendar locally |
| Finance: savings goals with a target date against the monthly pace (pot items funded in order) | `finance.ts` `analyseSavings`, `loadSavings` | Vitest; run locally |
| Travel: when to ask operators for offers on big trips, with an email to copy | `travel.ts` | Vitest |
| Language Coach: target dates, a weekly speaking topic for the first target, monthly speaking nudge | `languages.ts` `analyseTargets`, `LanguageTargets.tsx` | Vitest; run locally |
| Side Projects (new): weekly growth experiment against paid-user goals, sponsor pitch monthly | `projects.ts`, `SideProjects.tsx` | Vitest; run locally |
| Friends (new) and the People page | `people` table, `people.ts`, `src/modules/people` | Vitest, pgTAP; run locally |
| Sleep Coach (new) and Home's morning check-in (weight, hours slept, sleep score; Garmin has no personal API). After a short night, a bedtime for tonight, warning when the evening (with travel home) runs late; Monday review | migration `20261109000300` (sleep metrics), `sleep.ts`, `MorningCheckIn.tsx`, `SleepGoals.tsx`, Health page Sleep | Vitest, pgTAP `25_sleep_metrics.test.sql`; run locally |
| Free time for plans: calendar busy times (work included, never 'away'), travel time each way by event word, 07:00-22:00, at most 4h | `calendar.ts` `freeToday`/`busyBlocks`, `agents/lib/away.ts`, `TravelTimes.tsx` | Vitest |
| Briefing goal lines (first in the briefing) | `goals.ts`, `BriefingCard.tsx` | Vitest; run locally |

## Claude does jobs (12 November 2026)

| Piece | Where | Checked by |
|---|---|---|
| Which jobs Claude is offered, what it sees, limits, and the check on its answer | `_shared/agents/work.ts` | Vitest `work.test.ts` (15), guard test |
| Questions as tasks, answers, results on jobs, venues from Claude | migration `20261112000100_ai_work.sql` (`agent_save_work`, `answer_ai_question`) | pgTAP `33_ai_work.test.sql` (27) |
| `work-save` and the work list in `priorities-input` | `agents/routine.ts`, `context.ts` `loadWork` | curl against the local function: a question asked, led the day's picks, answered in the browser, came back with its answer, result and two sample venues saved |
| Answer box and results in the app | `tasks/components/ClaudeWork.tsx`, `TaskRow`, `TaskDetail`, `WeddingPlan` | browser at phone width, locally |

Not verified: the routine itself doing a job with web search. Locally its calls were made by hand with made-up results.

## Known issue (CI only)

On the x86-64 build of the Supabase Postgres 17.11 image that GitHub CI uses, any function call refused for lack of EXECUTE segfaults the server. The arm64 build (local Macs and the hosted project, which reports `aarch64`) doesn't. The pgTAP tests therefore check `has_function_privilege` instead of making refused calls. Don't add tests that call a function a role can't execute.

## Not verified

- **The LLM call** (`functions/agents/summary.ts`). No API key was used, so it has never made a real request. Budget, cost, prompt and output checks are unit-tested; the code falls back to the rules headline on any failure.
- **A notification arriving on a real phone.** Needs the VAPID secrets on live and someone to turn it on; "Send a test" is the check.
- **Phone layout** of the AI Hub; it uses the same single-column patterns as other pages but wasn't looked at on a phone.
- **Live data.** The noise caps were tuned on the local demo data, which is weeks stale (76 overdue). Real data may need the thresholds in `taskManager.ts` adjusted.

## Planned

None: every agent in the registry is live.

## Decisions for you

1. **Go live?** Steps in [setup.md](setup.md): migration, one secret, deploy, two Vault rows, push.
2. **Defaults.** Both agents are on for both of you until switched off (they only read what you can already see and change nothing without approval). Say if you'd rather they start off.
3. **AI sentence.** Worth an Anthropic key? It's the only part that costs money or sends data out.
4. **Wedding date and fitness goals after going live.** Set "Month only: September 2028" in Wedding settings, and the goals (6 active days; table tennis 1×, padel 1×, run 1× optional) in AI Hub → Agents → Fitness Coach. Both were tested locally only.
5. **Outside sources** (prices for Travel, job boards for Career) were left out on purpose; each would need your go-ahead.
