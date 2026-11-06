-- =============================================================================
-- AI agents: settings, run history, suggestions, briefings and the approval log.
-- Design: docs/ai-agents/architecture.md.
--
--   agent_settings     per person per agent: on/off and (Chief of Staff) how
--                      often to brief. Owner only.
--   agent_runs         execution history. Written only by the agents Edge
--                      Function (service role) through agent_claim_run /
--                      agent_finish_run, and queued by the completion trigger.
--   agent_suggestions  what the agents noticed or propose. Visible only to its
--                      recipients. Status changes only through
--                      respond_agent_suggestion.
--   agent_briefings    daily/weekly briefing per person. Recipient only.
--   agent_actions      append-only log of every approve / dismiss / snooze.
--
-- Agents never write application data. Approving a suggestion applies its
-- action as the person who approved it, inside respond_agent_suggestion.
-- No health data or amounts are ever stored here.
-- =============================================================================

alter table public.user_preferences
  add column ai_summaries boolean not null default false;
-- user_preferences already has table-level select/insert/update for the owner.

-- -----------------------------------------------------------------------------
-- Settings
-- -----------------------------------------------------------------------------
create table public.agent_settings (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null default auth.uid(),
  agent_id text not null check (agent_id ~ '^[a-z_]{2,40}$'),
  enabled boolean not null default true,
  schedule text not null default 'daily' check (schedule in ('daily', 'weekly')),
  updated_at timestamptz not null default now(),
  primary key (user_id, agent_id),
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade
);

create trigger agent_settings_updated_at before update on public.agent_settings
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Runs
-- -----------------------------------------------------------------------------
create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  agent_id text not null check (agent_id ~ '^[a-z_]{2,40}$'),
  trigger text not null check (trigger in ('scheduled', 'event', 'manual')),
  -- daily:2026-11-06, weekly:2026-W45, event:2026-11-06T14, manual:2026-11-06T14:20
  run_key text not null check (char_length(run_key) between 1 and 60),
  requested_by uuid references public.profiles (id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  attempts smallint not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  suggestions_count integer not null default 0,
  briefings_count integer not null default 0,
  error text check (char_length(error) <= 500),
  llm_input_tokens integer not null default 0,
  llm_output_tokens integer not null default 0,
  llm_cost_micro_usd bigint not null default 0,
  created_at timestamptz not null default now(),
  unique (id, household_id),
  unique (household_id, agent_id, run_key)
);

create index agent_runs_household_created_idx on public.agent_runs (household_id, created_at desc);
create index agent_runs_queued_idx on public.agent_runs (status) where status in ('queued', 'failed', 'running');

-- -----------------------------------------------------------------------------
-- Suggestions
-- -----------------------------------------------------------------------------
create table public.agent_suggestions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  agent_id text not null check (agent_id ~ '^[a-z_]{2,40}$'),
  -- Who sees it. One shared row for a joint suggestion, so approving it once is enough.
  recipients uuid[] not null check (cardinality(recipients) between 1 and 2),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 120),
  kind text not null check (kind ~ '^[a-z_]{2,40}$'),
  severity smallint not null default 1 check (severity between 1 and 3),
  title text not null check (char_length(title) between 1 and 200),
  reason text not null check (char_length(reason) between 1 and 1000),
  task_id uuid,
  action jsonb check (action is null or (jsonb_typeof(action) = 'object' and action ->> 'type' in ('create_task', 'move_due_date', 'archive_task'))),
  status text not null default 'pending' check (status in ('pending', 'snoozed', 'approved', 'dismissed', 'expired')),
  snoozed_until date,
  responded_by uuid references public.profiles (id) on delete set null,
  responded_at timestamptz,
  first_run_id uuid references public.agent_runs (id) on delete set null,
  last_run_id uuid references public.agent_runs (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  unique (household_id, agent_id, dedupe_key),
  foreign key (task_id, household_id) references public.tasks (id, household_id) on delete set null (task_id),
  check ((status = 'snoozed') = (snoozed_until is not null))
);

create index agent_suggestions_household_status_idx on public.agent_suggestions (household_id, status);

create trigger agent_suggestions_updated_at before update on public.agent_suggestions
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Briefings
-- -----------------------------------------------------------------------------
create table public.agent_briefings (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  recipient_id uuid not null,
  kind text not null check (kind in ('daily', 'weekly')),
  period_key text not null check (char_length(period_key) between 1 and 20),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  -- Optional one-sentence summary written by an LLM; shown labelled as AI.
  ai_summary text check (char_length(ai_summary) <= 400),
  run_id uuid references public.agent_runs (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (recipient_id, kind, period_key),
  foreign key (household_id, recipient_id) references public.household_members (household_id, user_id) on delete cascade
);

create trigger agent_briefings_updated_at before update on public.agent_briefings
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Approval log (append-only)
-- -----------------------------------------------------------------------------
create table public.agent_actions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  suggestion_id uuid not null,
  agent_id text not null,
  response text not null check (response in ('approved', 'dismissed', 'snoozed')),
  action_type text,
  -- No FK: the log outlives the task.
  task_id uuid,
  title text not null,
  actor_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  foreign key (suggestion_id, household_id) references public.agent_suggestions (id, household_id) on delete cascade
);

create index agent_actions_household_created_idx on public.agent_actions (household_id, created_at desc);

-- -----------------------------------------------------------------------------
-- RLS + grants
-- -----------------------------------------------------------------------------
alter table public.agent_settings enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_suggestions enable row level security;
alter table public.agent_briefings enable row level security;
alter table public.agent_actions enable row level security;

create policy "agent_settings: own" on public.agent_settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.is_household_member(household_id));

-- Runs hold counts, timings and costs, never content.
create policy "agent_runs: members read" on public.agent_runs
  for select to authenticated using (public.is_household_member(household_id));

create policy "agent_suggestions: recipients read" on public.agent_suggestions
  for select to authenticated
  using (public.is_household_member(household_id) and (select auth.uid()) = any (recipients));

create policy "agent_briefings: recipient reads" on public.agent_briefings
  for select to authenticated using (recipient_id = (select auth.uid()));

-- You see responses to suggestions you can see (the subquery applies their RLS).
create policy "agent_actions: read with the suggestion" on public.agent_actions
  for select to authenticated
  using (exists (select 1 from public.agent_suggestions s where s.id = suggestion_id));

grant select, delete on public.agent_settings to authenticated;
grant insert (household_id, agent_id, enabled, schedule) on public.agent_settings to authenticated;
grant update (enabled, schedule) on public.agent_settings to authenticated;
grant select on public.agent_runs to authenticated;
grant select on public.agent_suggestions to authenticated;
grant select on public.agent_briefings to authenticated;
grant select on public.agent_actions to authenticated;

-- -----------------------------------------------------------------------------
-- Run lifecycle (service role only: the agents Edge Function)
-- -----------------------------------------------------------------------------

-- Starts a run, or returns null if this run key has already been dealt with.
-- Re-claims a queued run, a failed one with attempts left, or one stuck running
-- for 15 minutes (the function died). The unique run key makes it atomic, so two
-- overlapping ticks can never both run the same job.
create or replace function public.agent_claim_run(
  p_household_id uuid,
  p_agent_id text,
  p_run_key text,
  p_trigger text,
  p_requested_by uuid default null
)
returns uuid
language sql
set search_path = ''
as $$
  insert into public.agent_runs (household_id, agent_id, run_key, trigger, requested_by, status, attempts, started_at)
  values (p_household_id, p_agent_id, p_run_key, p_trigger, p_requested_by, 'running', 1, now())
  on conflict (household_id, agent_id, run_key) do update
    set status = 'running', attempts = public.agent_runs.attempts + 1, started_at = now(), finished_at = null, error = null
    where public.agent_runs.status = 'queued'
       or (public.agent_runs.status = 'failed' and public.agent_runs.attempts < 3)
       or (public.agent_runs.status = 'running' and public.agent_runs.started_at < now() - interval '15 minutes')
  returning id;
$$;

-- Records the outcome of a run. On success:
--   * each suggestion is upserted by its dedupe key: pending ones are refreshed,
--     expired ones come back, approved and dismissed ones are left alone;
--   * snoozed suggestions whose date has come are pending again;
--   * pending suggestions this run no longer produced are expired (their task
--     was done or changed, so the advice no longer applies);
--   * briefings replace the same person's briefing for the same period.
create or replace function public.agent_finish_run(
  p_run_id uuid,
  p_error text default null,
  p_suggestions jsonb default '[]'::jsonb,
  p_briefings jsonb default '[]'::jsonb,
  p_usage jsonb default '{}'::jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_run public.agent_runs;
  v_today date;
  v_members uuid[];
  v_item jsonb;
  v_recipients uuid[];
  v_keys text[] := '{}';
begin
  select * into v_run from public.agent_runs where id = p_run_id for update;
  if not found or v_run.status <> 'running' then
    raise exception 'Run % is not running', p_run_id using errcode = 'P0001';
  end if;

  if p_error is not null then
    update public.agent_runs
    set status = 'failed', error = left(p_error, 500), finished_at = now()
    where id = p_run_id;
    return;
  end if;

  v_today := public.household_today(v_run.household_id);
  select array_agg(user_id) into v_members from public.household_members where household_id = v_run.household_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_suggestions, '[]'::jsonb)) loop
    select array_agg(distinct r::uuid) into v_recipients from jsonb_array_elements_text(v_item -> 'recipients') r;
    if v_recipients is null or not (v_recipients <@ v_members) then
      raise exception 'Suggestion recipients must be household members' using errcode = '22023';
    end if;
    v_keys := v_keys || (v_item ->> 'dedupe_key');

    insert into public.agent_suggestions (
      household_id, agent_id, recipients, dedupe_key, kind, severity, title, reason, task_id, action,
      first_run_id, last_run_id
    )
    values (
      v_run.household_id, v_run.agent_id, v_recipients, v_item ->> 'dedupe_key', v_item ->> 'kind',
      coalesce((v_item ->> 'severity')::smallint, 1), v_item ->> 'title', v_item ->> 'reason',
      (v_item ->> 'task_id')::uuid, nullif(v_item -> 'action', 'null'::jsonb), v_run.id, v_run.id
    )
    on conflict (household_id, agent_id, dedupe_key) do update
      set recipients = excluded.recipients,
          kind = excluded.kind,
          severity = excluded.severity,
          title = excluded.title,
          reason = excluded.reason,
          task_id = excluded.task_id,
          action = excluded.action,
          last_run_id = excluded.last_run_id,
          status = case when public.agent_suggestions.status = 'expired' then 'pending' else public.agent_suggestions.status end
      where public.agent_suggestions.status in ('pending', 'snoozed', 'expired');
  end loop;

  update public.agent_suggestions
  set status = 'pending', snoozed_until = null
  where household_id = v_run.household_id and agent_id = v_run.agent_id
    and status = 'snoozed' and snoozed_until <= v_today;

  update public.agent_suggestions
  set status = 'expired', snoozed_until = null
  where household_id = v_run.household_id and agent_id = v_run.agent_id
    and status in ('pending', 'snoozed') and not (dedupe_key = any (v_keys));

  for v_item in select * from jsonb_array_elements(coalesce(p_briefings, '[]'::jsonb)) loop
    insert into public.agent_briefings (household_id, recipient_id, kind, period_key, content, ai_summary, run_id)
    values (
      v_run.household_id, (v_item ->> 'recipient_id')::uuid, v_item ->> 'kind', v_item ->> 'period_key',
      v_item -> 'content', left(v_item ->> 'ai_summary', 400), v_run.id
    )
    on conflict (recipient_id, kind, period_key) do update
      set content = excluded.content, ai_summary = excluded.ai_summary, run_id = excluded.run_id;
  end loop;

  update public.agent_runs
  set status = 'succeeded',
      finished_at = now(),
      suggestions_count = jsonb_array_length(coalesce(p_suggestions, '[]'::jsonb)),
      briefings_count = jsonb_array_length(coalesce(p_briefings, '[]'::jsonb)),
      llm_input_tokens = coalesce((p_usage ->> 'input_tokens')::integer, 0),
      llm_output_tokens = coalesce((p_usage ->> 'output_tokens')::integer, 0),
      llm_cost_micro_usd = coalesce((p_usage ->> 'cost_micro_usd')::bigint, 0)
  where id = p_run_id;
end;
$$;

revoke execute on function public.agent_claim_run(uuid, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.agent_finish_run(uuid, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.agent_claim_run(uuid, text, text, text, uuid) to service_role;
grant execute on function public.agent_finish_run(uuid, text, jsonb, jsonb, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- Responding to a suggestion (members)
-- -----------------------------------------------------------------------------

-- approve | dismiss | snooze. Approving applies the suggestion's action as the
-- caller, re-checking it first; a suggestion without an action becomes a one-off
-- task due today (on the joint list if it was for both of us, else the caller's).
-- Returns the task created or changed, if any.
create or replace function public.respond_agent_suggestion(
  p_suggestion_id uuid,
  p_response text,
  p_snooze_until date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.agent_suggestions;
  v_me uuid := auth.uid();
  v_today date;
  v_action jsonb;
  v_type text;
  v_task public.tasks;
  v_task_id uuid;
  v_list_id uuid;
  v_date date;
  v_occ_id uuid;
begin
  select * into v_s from public.agent_suggestions where id = p_suggestion_id for update;
  if not found or not public.is_household_member(v_s.household_id) or not (v_me = any (v_s.recipients)) then
    raise exception 'Suggestion not found' using errcode = 'P0002';
  end if;
  if v_s.status not in ('pending', 'snoozed') then
    raise exception 'This suggestion is already %', v_s.status using errcode = 'P0001';
  end if;
  v_today := public.household_today(v_s.household_id);

  if p_response = 'dismiss' then
    update public.agent_suggestions
    set status = 'dismissed', snoozed_until = null, responded_by = v_me, responded_at = now()
    where id = v_s.id;
    insert into public.agent_actions (household_id, suggestion_id, agent_id, response, task_id, title, actor_id)
    values (v_s.household_id, v_s.id, v_s.agent_id, 'dismissed', v_s.task_id, v_s.title, v_me);
    return null;
  end if;

  if p_response = 'snooze' then
    if p_snooze_until is null or p_snooze_until <= v_today or p_snooze_until > v_today + 90 then
      raise exception 'Snooze until a date in the next 90 days' using errcode = '22023';
    end if;
    update public.agent_suggestions
    set status = 'snoozed', snoozed_until = p_snooze_until, responded_by = v_me, responded_at = now()
    where id = v_s.id;
    insert into public.agent_actions (household_id, suggestion_id, agent_id, response, task_id, title, actor_id)
    values (v_s.household_id, v_s.id, v_s.agent_id, 'snoozed', v_s.task_id, v_s.title, v_me);
    return null;
  end if;

  if p_response <> 'approve' then
    raise exception 'Unknown response %', p_response using errcode = '22023';
  end if;

  v_action := coalesce(v_s.action, jsonb_build_object('type', 'create_task', 'title', v_s.title));
  v_type := v_action ->> 'type';

  if v_type = 'create_task' then
    if v_action ->> 'list' = 'joint' or (v_action ->> 'list' is null and cardinality(v_s.recipients) > 1) then
      select id into v_list_id from public.task_lists where household_id = v_s.household_id and kind = 'joint';
    else
      select id into v_list_id from public.task_lists
      where household_id = v_s.household_id and kind = 'personal' and owner_id = v_me;
    end if;
    v_date := coalesce((v_action ->> 'due_date')::date, v_today);
    if v_date < v_today then
      v_date := v_today;
    end if;
    -- Inserted as the caller: created_by defaults to auth.uid(); checks,
    -- category-owner and occurrence triggers all apply as usual.
    insert into public.tasks (household_id, list_id, title, category_id, due_date, recurrence, needs_both, assignee_id)
    values (
      v_s.household_id, v_list_id, left(trim(v_action ->> 'title'), 200),
      (select c.id from public.task_categories c
       where c.household_id = v_s.household_id and c.id = (v_action ->> 'category_id')::uuid),
      v_date,
      v_action -> 'recurrence',
      coalesce((v_action ->> 'needs_both')::boolean, false),
      case when (select l.kind from public.task_lists l where l.id = v_list_id) = 'personal' then v_me end
    )
    returning id into v_task_id;

  elsif v_type in ('move_due_date', 'archive_task') then
    select * into v_task from public.tasks
    where id = v_s.task_id and household_id = v_s.household_id for update;
    if not found or v_task.archived_at is not null then
      raise exception 'That task no longer exists' using errcode = 'P0002';
    end if;
    v_task_id := v_task.id;

    if v_type = 'archive_task' then
      update public.tasks set archived_at = now() where id = v_task.id;
    else
      v_date := (v_action ->> 'due_date')::date;
      if v_date is null or v_date < v_today or v_date > v_today + 365 then
        raise exception 'Pick a date in the coming year' using errcode = '22023';
      end if;
      select id into v_occ_id from public.task_occurrences where task_id = v_task.id and status = 'open';
      if v_occ_id is null then
        raise exception 'That task is already done' using errcode = 'P0001';
      end if;
      if v_task.recurrence is null then
        -- The task keeps a one-off's date; its trigger moves the open occurrence.
        update public.tasks set due_date = v_date where id = v_task.id;
      else
        update public.task_occurrences set due_date = v_date where id = v_occ_id;
      end if;
    end if;
  else
    raise exception 'Unknown action %', v_type using errcode = '22023';
  end if;

  update public.agent_suggestions
  set status = 'approved', snoozed_until = null, responded_by = v_me, responded_at = now()
  where id = v_s.id;
  insert into public.agent_actions (household_id, suggestion_id, agent_id, response, action_type, task_id, title, actor_id)
  values (v_s.household_id, v_s.id, v_s.agent_id, 'approved', v_type, v_task_id, v_s.title, v_me);
  return v_task_id;
end;
$$;

grant execute on function public.respond_agent_suggestion(uuid, text, date) to authenticated;

-- -----------------------------------------------------------------------------
-- Event-driven runs: a completed task queues one Task Manager run per hour.
-- The hourly dispatcher picks it up; no HTTP from inside a transaction.
-- -----------------------------------------------------------------------------
create or replace function public.agent_queue_task_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.agent_runs (household_id, agent_id, trigger, run_key, status)
  values (
    new.household_id, 'task_manager', 'event',
    'event:' || to_char(now() at time zone coalesce(
      (select h.timezone from public.households h where h.id = new.household_id), 'Europe/London'), 'YYYY-MM-DD"T"HH24'),
    'queued'
  )
  on conflict (household_id, agent_id, run_key) do nothing;
  return null;
end;
$$;

create trigger task_completion_events_queue_agents after insert on public.task_completion_events
  for each row when (new.event_type = 'completed')
  execute function public.agent_queue_task_event();

-- -----------------------------------------------------------------------------
-- Schedule: every hour pg_cron asks the agents Edge Function to run whatever is
-- due. The URL and shared secret come from Vault (see docs/ai-agents/setup.md);
-- until both are stored this does nothing.
-- -----------------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create or replace function public.agents_dispatch()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'agents_function_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'agents_cron_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-agents-secret', v_secret),
    body := '{"mode":"scheduled"}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;

revoke execute on function public.agents_dispatch() from public, anon, authenticated;

select cron.schedule('agents-hourly', '5 * * * *', 'select public.agents_dispatch()');

-- -----------------------------------------------------------------------------
-- Realtime
-- -----------------------------------------------------------------------------
alter publication supabase_realtime add table public.agent_settings;
alter publication supabase_realtime add table public.agent_runs;
alter publication supabase_realtime add table public.agent_suggestions;
alter publication supabase_realtime add table public.agent_briefings;
