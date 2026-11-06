-- AI agents: run dedupe and retries, suggestion upsert/expiry, recipient-only
-- privacy, approve/dismiss/snooze applied as the caller, event queueing.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(52);

create function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
end $$;
grant execute on all functions in schema pg_temp to authenticated, service_role, anon;

select set_config('t.tim', '11111111-1111-1111-1111-111111111111', true);
select set_config('t.sophie', '22222222-2222-2222-2222-222222222222', true);
select set_config('t.out', '33333333-3333-3333-3333-333333333333', true);
select set_config('t.hh', (select household_id::text from household_members where user_id = current_setting('t.tim')::uuid), true);
select set_config('t.joint', (select id::text from task_lists where household_id = current_setting('t.hh')::uuid and kind = 'joint'), true);

delete from agent_runs;
delete from agent_suggestions;
delete from agent_briefings;
delete from agent_settings where household_id = current_setting('t.hh')::uuid;

-- A suggestion payload in the shape the Edge Function sends.
create function pg_temp.sugg(p_key text, p_recipients text[], p_action jsonb default null, p_task uuid default null)
returns jsonb language sql as $$
  select jsonb_build_object('dedupe_key', p_key, 'kind', 'neglected', 'severity', 2, 'title', 'Title ' || p_key,
    'reason', 'Because ' || p_key, 'recipients', to_jsonb(p_recipients), 'action', p_action, 'task_id', p_task);
$$;
grant execute on all functions in schema pg_temp to authenticated, service_role, anon;

-- Only the service role runs agents --------------------------------------------------
-- Checked as privileges rather than by calling them: on the x86-64 build of the
-- Supabase Postgres 17.11 image (GitHub CI), any refused function call segfaults
-- the server. The arm64 build (local and the hosted project) doesn't.
select ok(not has_function_privilege('authenticated', 'public.agent_claim_run(uuid, text, text, text, uuid)', 'execute'),
  'members cannot start agent runs');
select ok(not has_function_privilege('authenticated', 'public.agent_finish_run(uuid, text, jsonb, jsonb, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.agent_finish_run(uuid, text, jsonb, jsonb, jsonb)', 'execute'),
  'members cannot record agent results');
select ok(not has_function_privilege('authenticated', 'public.agents_dispatch()', 'execute'), 'members cannot trigger the dispatcher');
select pg_temp.as_user(current_setting('t.tim')::uuid);

-- Claiming: dedupe, retries, stuck runs -----------------------------------------------
select pg_temp.as_service();
select set_config('t.run1', agent_claim_run(current_setting('t.hh')::uuid, 'task_manager', 'daily:2026-11-06', 'scheduled')::text, true);
select isnt(current_setting('t.run1'), '', 'the first claim of a run key starts a run');
select is(agent_claim_run(current_setting('t.hh')::uuid, 'task_manager', 'daily:2026-11-06', 'scheduled'), null,
  'a second claim of the same key is refused while it runs');

select agent_finish_run(current_setting('t.run1')::uuid, 'boom');
select is((select status from agent_runs where id = current_setting('t.run1')::uuid), 'failed', 'an error marks the run failed');
select is(agent_claim_run(current_setting('t.hh')::uuid, 'task_manager', 'daily:2026-11-06', 'scheduled'),
  current_setting('t.run1')::uuid, 'a failed run is retried under the same row');
select agent_finish_run(current_setting('t.run1')::uuid, 'boom again');
select agent_claim_run(current_setting('t.hh')::uuid, 'task_manager', 'daily:2026-11-06', 'scheduled');
select agent_finish_run(current_setting('t.run1')::uuid, 'third time');
select is((select attempts from agent_runs where id = current_setting('t.run1')::uuid), 3::smallint, 'attempts are counted');
select is(agent_claim_run(current_setting('t.hh')::uuid, 'task_manager', 'daily:2026-11-06', 'scheduled'), null,
  'after three failures it stops retrying');

select set_config('t.run2', agent_claim_run(current_setting('t.hh')::uuid, 'task_manager', 'daily:2026-11-07', 'scheduled')::text, true);
reset role;
update agent_runs set started_at = now() - interval '20 minutes' where id = current_setting('t.run2')::uuid;
select pg_temp.as_service();
select is(agent_claim_run(current_setting('t.hh')::uuid, 'task_manager', 'daily:2026-11-07', 'scheduled'),
  current_setting('t.run2')::uuid, 'a run stuck for 15 minutes can be claimed again');

-- Results: suggestions and briefings -------------------------------------------------
reset role;
insert into tasks (household_id, list_id, title, due_date, created_by)
values (current_setting('t.hh')::uuid, current_setting('t.joint')::uuid, 'Agent test: one-off', current_date - 10, current_setting('t.tim')::uuid);
select set_config('t.task', (select id::text from tasks where title = 'Agent test: one-off'), true);
select pg_temp.as_service();

select lives_ok(format($$select agent_finish_run(%L, null, %L::jsonb, %L::jsonb)$$,
  current_setting('t.run2'),
  jsonb_build_array(
    pg_temp.sugg('joint-new', array[current_setting('t.tim'), current_setting('t.sophie')],
      jsonb_build_object('type', 'create_task', 'title', 'Agent test: descale the kettle', 'list', 'joint',
        'recurrence', jsonb_build_object('freq', 'weekly', 'interval', 4, 'afterDone', true))),
    pg_temp.sugg('tim-only', array[current_setting('t.tim')]),
    pg_temp.sugg('sophie-only', array[current_setting('t.sophie')]),
    pg_temp.sugg('move', array[current_setting('t.tim')],
      jsonb_build_object('type', 'move_due_date', 'due_date', current_date + 3), current_setting('t.task')::uuid),
    pg_temp.sugg('archive', array[current_setting('t.tim')], jsonb_build_object('type', 'archive_task'), current_setting('t.task')::uuid),
    pg_temp.sugg('snooze-me', array[current_setting('t.tim')])
  )::text,
  jsonb_build_array(jsonb_build_object('recipient_id', current_setting('t.tim'), 'kind', 'daily', 'period_key', '2026-11-07',
    'content', jsonb_build_object('dueToday', 2)))::text
), 'the service role records suggestions and briefings');
select is((select status from agent_runs where id = current_setting('t.run2')::uuid), 'succeeded', 'the run is marked succeeded');
select is((select suggestions_count from agent_runs where id = current_setting('t.run2')::uuid), 6, 'the run counts its suggestions');

select throws_ok(format($$select agent_finish_run(%L, null, %L::jsonb)$$,
  agent_claim_run(current_setting('t.hh')::uuid, 'task_manager', 'manual:a', 'manual'),
  jsonb_build_array(pg_temp.sugg('x', array[current_setting('t.out')]))::text),
  '22023', null, 'suggestions can only go to members of the household');

-- Privacy ---------------------------------------------------------------------------
select pg_temp.as_user(current_setting('t.sophie')::uuid);
select is((select array_agg(dedupe_key order by dedupe_key) from agent_suggestions), array['joint-new', 'sophie-only'],
  'a person sees joint suggestions and their own, not their partner''s');
select is((select count(*)::int from agent_briefings), 0, 'briefings are private to their recipient');
select ok((select count(*) from agent_runs) > 0, 'both members can see run history');
select throws_ok(
  format($$insert into agent_suggestions (household_id, agent_id, recipients, dedupe_key, kind, title, reason) values (%L, 'x', array[%L]::uuid[], 'k', 'k', 't', 'r')$$,
    current_setting('t.hh'), current_setting('t.sophie')),
  '42501', null, 'members cannot write suggestions directly');
select throws_ok($$update agent_suggestions set status = 'approved'$$, '42501', null, 'members cannot change status directly');
select throws_ok(
  format($$select respond_agent_suggestion((select id from agent_suggestions where dedupe_key = 'tim-only' and household_id = %L), 'dismiss')$$,
    current_setting('t.hh')),
  'P0002', null, 'nobody can respond to a suggestion that isn''t theirs');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from agent_suggestions) + (select count(*)::int from agent_runs) + (select count(*)::int from agent_actions),
  0, 'outsiders see nothing');

select pg_temp.as_user(current_setting('t.tim')::uuid);
select is((select count(*)::int from agent_briefings), 1, 'the recipient sees their briefing');
select is((select count(*)::int from agent_suggestions), 5, 'Tim sees the joint suggestion and his four');

-- Approve: create a task -------------------------------------------------------------
select set_config('t.newtask',
  respond_agent_suggestion((select id from agent_suggestions where dedupe_key = 'joint-new'), 'approve')::text, true);
select is((select created_by from tasks where id = current_setting('t.newtask')::uuid), current_setting('t.tim')::uuid,
  'an approved task is created as the person who approved it');
select is((select list_id from tasks where id = current_setting('t.newtask')::uuid), current_setting('t.joint')::uuid,
  'a joint suggestion becomes a joint task');
select is((select recurrence ->> 'afterDone' from tasks where id = current_setting('t.newtask')::uuid), 'true', 'the proposed repeat is kept');
select is((select count(*)::int from task_occurrences where task_id = current_setting('t.newtask')::uuid and status = 'open'), 1,
  'the new task gets its first occurrence through the usual trigger');
select is((select response || ':' || action_type from agent_actions where task_id = current_setting('t.newtask')::uuid), 'approved:create_task',
  'the approval is logged with the task it created');
select throws_ok($$select respond_agent_suggestion((select id from agent_suggestions where dedupe_key = 'joint-new'), 'approve')$$,
  'P0001', null, 'a suggestion can only be approved once');

-- Sophie sees the joint suggestion is done, so it can't be approved twice by two people.
select pg_temp.as_user(current_setting('t.sophie')::uuid);
select is((select status from agent_suggestions where dedupe_key = 'joint-new'), 'approved', 'the partner sees the joint suggestion approved');

-- Approve: move a date, archive ------------------------------------------------------
select pg_temp.as_user(current_setting('t.tim')::uuid);
select respond_agent_suggestion((select id from agent_suggestions where dedupe_key = 'move'), 'approve');
select is((select due_date from task_occurrences where task_id = current_setting('t.task')::uuid and status = 'open'), current_date + 3,
  'approving a new date moves the open occurrence');
select is((select due_date from tasks where id = current_setting('t.task')::uuid), current_date + 3, 'and the one-off task''s own date');
select respond_agent_suggestion((select id from agent_suggestions where dedupe_key = 'archive'), 'approve');
select isnt((select archived_at from tasks where id = current_setting('t.task')::uuid), null, 'approving an archive archives the task');

-- Dismiss and snooze -----------------------------------------------------------------
select lives_ok($$select respond_agent_suggestion((select id from agent_suggestions where dedupe_key = 'tim-only'), 'dismiss')$$,
  'a recipient can dismiss');
select throws_ok($$select respond_agent_suggestion((select id from agent_suggestions where dedupe_key = 'snooze-me'), 'snooze', current_date)$$,
  '22023', null, 'snoozing needs a future date');
select lives_ok($$select respond_agent_suggestion((select id from agent_suggestions where dedupe_key = 'snooze-me'), 'snooze', current_date + 2)$$,
  'a recipient can snooze');
select is((select count(*)::int from agent_actions where actor_id = current_setting('t.tim')::uuid), 5, 'every response is logged');

-- The next run: dismissed stays dismissed, missing ones expire, snoozed wake up ------
reset role;
update agent_suggestions set snoozed_until = current_date where dedupe_key = 'snooze-me';
select pg_temp.as_service();
select agent_finish_run(
  agent_claim_run(current_setting('t.hh')::uuid, 'task_manager', 'daily:2026-11-08', 'scheduled'), null,
  jsonb_build_array(
    pg_temp.sugg('tim-only', array[current_setting('t.tim')]),
    pg_temp.sugg('snooze-me', array[current_setting('t.tim')])
  ));
reset role;
select is((select status from agent_suggestions where dedupe_key = 'tim-only'), 'dismissed', 'a dismissed suggestion does not come back');
select is((select status from agent_suggestions where dedupe_key = 'sophie-only'), 'expired', 'one the run no longer makes expires');
select is((select status from agent_suggestions where dedupe_key = 'snooze-me'), 'pending', 'a snoozed one is back when its date comes');
select is((select status from agent_suggestions where dedupe_key = 'joint-new'), 'approved', 'an approved one is left alone');

-- Settings are each person's own ------------------------------------------------------
select pg_temp.as_user(current_setting('t.tim')::uuid);
select lives_ok(format($$insert into agent_settings (household_id, agent_id, enabled, schedule) values (%L, 'chief_of_staff', true, 'weekly')$$,
  current_setting('t.hh')), 'a member saves their own agent settings');
select lives_ok($$update agent_settings set config = '{"activeDays": 6, "activities": [{"name": "Padel", "times": 1}]}' where agent_id = 'chief_of_staff'$$,
  'a member saves their own goals in the config');
select throws_ok($$update agent_settings set config = '[1, 2]' where agent_id = 'chief_of_staff'$$, '23514', null, 'config must be an object');
select lives_ok($$update wedding_settings set wedding_date = '2028-09-01', wedding_date_approx = true$$, 'a member can set a month-only wedding date');
select pg_temp.as_user(current_setting('t.sophie')::uuid);
select is((select count(*)::int from agent_settings), 0, 'the partner cannot see them');
select is_empty($$update agent_settings set enabled = false returning user_id$$, 'or change them');
select throws_ok(
  format($$insert into agent_settings (household_id, user_id, agent_id) values (%L, %L, 'task_manager')$$,
    current_setting('t.hh'), current_setting('t.tim')),
  '42501', null, 'nobody can save settings for someone else');

-- Event-driven: completing a task queues a Task Manager run ----------------------------
reset role;
delete from agent_runs where trigger = 'event' and household_id = current_setting('t.hh')::uuid;
select pg_temp.as_user(current_setting('t.tim')::uuid);
select complete_task_occurrence((select id from task_occurrences where task_id = current_setting('t.newtask')::uuid and status = 'open'));
reset role;
select is((select count(*)::int from agent_runs where trigger = 'event' and status = 'queued' and agent_id = 'task_manager'
  and household_id = current_setting('t.hh')::uuid), 1, 'completing a task queues a Task Manager run');
select is(agent_claim_run(current_setting('t.hh')::uuid, 'task_manager',
  (select run_key from agent_runs where trigger = 'event' and household_id = current_setting('t.hh')::uuid), 'event') is not null,
  true, 'the dispatcher can claim the queued run');

-- The dispatcher is a no-op until its Vault secrets exist ------------------------------
select lives_ok('select agents_dispatch()', 'dispatching without Vault secrets does nothing');
select isnt((select jobid from cron.job where jobname = 'agents-hourly'), null, 'the hourly schedule is registered');

select * from finish();
rollback;
