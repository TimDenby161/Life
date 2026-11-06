# AI agents: status

_Last updated 6 November 2026._ Six of the ten agents are built. **Live since 6 November 2026**: migrations applied, `agents` function deployed, the hourly job running (first run: all six succeeded), AI Hub deployed.

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
| Briefing notifications (Web Push, off by default) | migration `0400`, `_shared/push.ts`, `agents/notify.ts`, `public/push-sw.js`, AI Hub → Agents | 9 Vitest cases (encryption decrypted on the browser side, VAPID signature verified, gone devices); pgTAP `17_push_notifications.test.sql` (14); locally the scheduled briefing sent through FCM, which rejected the fake device, and the function forgot it |

## Known issue (CI only)

On the x86-64 build of the Supabase Postgres 17.11 image that GitHub CI uses, any function call refused for lack of EXECUTE segfaults the server. The arm64 build (local Macs and the hosted project, which reports `aarch64`) doesn't. The pgTAP tests therefore check `has_function_privilege` instead of making refused calls. Don't add tests that call a function a role can't execute.

## Not verified

- **The LLM call** (`functions/agents/summary.ts`). No API key was used, so it has never made a real request. Budget, cost, prompt and output checks are unit-tested; the code falls back to the rules headline on any failure.
- **A notification arriving on a real phone.** Needs the VAPID secrets on live and someone to turn it on; "Send a test" is the check.
- **Phone layout** of the AI Hub; it uses the same single-column patterns as other pages but wasn't looked at on a phone.
- **Live data.** The noise caps were tuned on the local demo data, which is weeks stale (76 overdue). Real data may need the thresholds in `taskManager.ts` adjusted.

## Planned

Finance, Travel, Career and Life Admin show in the AI Hub as "Not built yet", each with what it's waiting on (see [architecture.md](architecture.md#the-ten-agents)).

## Decisions for you

1. **Go live?** Steps in [setup.md](setup.md): migration, one secret, deploy, two Vault rows, push.
2. **Defaults.** Both agents are on for both of you until switched off (they only read what you can already see and change nothing without approval). Say if you'd rather they start off.
3. **AI sentence.** Worth an Anthropic key? It's the only part that costs money or sends data out.
4. **Wedding date and fitness goals after going live.** Set "Month only: September 2028" in Wedding settings, and the goals (6 active days; table tennis 1×, padel 1×, run 1× optional) in AI Hub → Agents → Fitness Coach. Both were tested locally only.
5. **The blocked four.** Each needs a decision: a bills list or statement import (Finance), email/calendar access (Life Admin), trips and a price source (Travel), goals and a job source (Career).
