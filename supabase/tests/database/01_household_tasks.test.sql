-- Household isolation, task permissions, recurrence and completion history.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

-- Helpers ---------------------------------------------------------------------
create function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
grant execute on all functions in schema pg_temp to authenticated;

select set_config('t.tim', '11111111-1111-1111-1111-111111111111', true);
select set_config('t.sophie', '22222222-2222-2222-2222-222222222222', true);
select set_config('t.out', '33333333-3333-3333-3333-333333333333', true);
select set_config('t.hh', (select household_id::text from household_members where user_id = current_setting('t.tim')::uuid), true);
select set_config('t.joint', (select id::text from task_lists where household_id = current_setting('t.hh')::uuid and kind = 'joint'), true);
-- A Tuesday 1-2 weeks ahead, so the test is independent of today's date.
select set_config('t.tuesday', (current_date + ((2 - extract(isodow from current_date)::int + 7) % 7) + 7)::text, true);

-- Household membership + list visibility ---------------------------------------
select pg_temp.as_user(current_setting('t.tim')::uuid);
select is((select count(*)::int from task_lists), 3, 'Tim sees Joint, Tim and Sophie lists');
select is((select count(*)::int from profiles), 2, 'Tim sees exactly the two household profiles');
select is((select count(*)::int from households), 1, 'Tim sees only his household');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from task_lists), 2, 'Outsider only sees their own household lists');
select is((select count(*)::int from task_lists where household_id = current_setting('t.hh')::uuid), 0,
  'Outsider cannot see Tim & Sophie lists');

-- Joint task assigned to Sophie, created by Tim -------------------------------
select pg_temp.as_user(current_setting('t.tim')::uuid);
with t as (
  insert into tasks (household_id, list_id, title, assignee_id, due_date)
  values (current_setting('t.hh')::uuid, current_setting('t.joint')::uuid, 'Book dentist',
          current_setting('t.sophie')::uuid, current_date + 3)
  returning id
)
select set_config('t.task', id::text, true) from t;

select is((select assignee_id from task_occurrences where task_id = current_setting('t.task')::uuid),
  current_setting('t.sophie')::uuid, 'One-off task gets one occurrence assigned to Sophie');
select is((select created_by from tasks where id = current_setting('t.task')::uuid),
  current_setting('t.tim')::uuid, 'created_by is set from the session');

select pg_temp.as_user(current_setting('t.sophie')::uuid);
select is((select count(*)::int from tasks where id = current_setting('t.task')::uuid), 1, 'Sophie sees the joint task');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from tasks where id = current_setting('t.task')::uuid), 0, 'Outsider cannot see the task');
select throws_ok(
  format('insert into tasks (household_id, list_id, title) values (%L, %L, %L)',
         current_setting('t.hh'), current_setting('t.joint'), 'sneaky'),
  '42501', null, 'Outsider cannot create a task in another household');
select throws_ok(
  format('insert into tasks (household_id, list_id, title) values (current_household_id(), %L, %L)',
         current_setting('t.joint'), 'sneaky'),
  '23503', null, 'Outsider cannot point their task at another household''s list');
select throws_ok(
  format('select complete_task_occurrence((select id from task_occurrences where task_id = %L))', current_setting('t.task')),
  'P0002', null, 'Outsider cannot complete another household''s task');

select pg_temp.as_user(current_setting('t.tim')::uuid);
select throws_ok(
  format('insert into tasks (household_id, list_id, title, created_by) values (%L, %L, %L, %L)',
         current_setting('t.hh'), current_setting('t.joint'), 'forged', current_setting('t.sophie')),
  '42501', null, 'created_by cannot be forged');
select throws_ok(
  format('insert into task_completion_events (household_id, occurrence_id, task_id, event_type, occurred_at, task_title, is_recurring) values (%L, gen_random_uuid(), gen_random_uuid(), ''completed'', now(), ''x'', false)',
         current_setting('t.hh')),
  '42501', null, 'Completion history cannot be written directly');
select throws_ok(
  format('update tasks set status = ''completed'' where id = %L', current_setting('t.task')),
  '42501', null, 'Task status can only change through the completion RPC');
select throws_ok(
  format('insert into feed_events (household_id, event_type, summary) values (%L, ''task.completed'', ''fake'')', current_setting('t.hh')),
  '42501', null, 'Activity events cannot be forged');

-- Complete a one-off task ---------------------------------------------------------
select lives_ok(
  format('select complete_task_occurrence((select id from task_occurrences where task_id = %L), %L)',
         current_setting('t.task'), current_setting('t.sophie')),
  'Tim records that Sophie completed the task');
select is((select status from tasks where id = current_setting('t.task')::uuid), 'completed', 'One-off task is completed');
select results_eq(
  format('select completed_by, recorded_by, event_type from task_completion_events where task_id = %L', current_setting('t.task')),
  format('values (%L::uuid, %L::uuid, ''completed''::text)', current_setting('t.sophie'), current_setting('t.tim')),
  'Completion event credits Sophie and records Tim as the recorder');
select is((select count(*)::int from feed_events where entity_id = current_setting('t.task')::uuid and event_type = 'task.completed'),
  1, 'A task.completed activity event is emitted');

-- Recurring: bins every Tuesday ----------------------------------------------
with t as (
  insert into tasks (household_id, list_id, title, assignee_id, due_date, recurrence)
  values (current_setting('t.hh')::uuid, current_setting('t.joint')::uuid, 'Bins out', current_setting('t.tim')::uuid,
          current_setting('t.tuesday')::date, '{"freq":"weekly","weekdays":[2]}')
  returning id
)
select set_config('t.bins', id::text, true) from t;

select is((select due_date from task_occurrences where task_id = current_setting('t.bins')::uuid and status = 'open'),
  current_setting('t.tuesday')::date, 'First bins occurrence is on the anchor Tuesday');

select set_config('t.week1', (select id::text from task_occurrences where task_id = current_setting('t.bins')::uuid), true);
select pg_temp.as_user(current_setting('t.sophie')::uuid);
select lives_ok(format('select complete_task_occurrence(%L)', current_setting('t.week1')), 'Sophie completes week 1');
select is((select due_date from task_occurrences where task_id = current_setting('t.bins')::uuid and status = 'open'),
  current_setting('t.tuesday')::date + 7, 'Week 2 occurrence generated for the following Tuesday');
select throws_ok(format('select complete_task_occurrence(%L)', current_setting('t.week1')), 'P0001', null,
  'A completed occurrence cannot be completed twice');

-- Reopen undoes the generated follow-up and is itself recorded.
select lives_ok(format('select reopen_task_occurrence(%L)', current_setting('t.week1')), 'Week 1 can be reopened');
select is((select count(*)::int from task_occurrences where task_id = current_setting('t.bins')::uuid), 1,
  'Reopening removes the untouched generated occurrence');
select is((select count(*)::int from feed_events where event_type = 'task.completed' and metadata ->> 'occurrence_id' = current_setting('t.week1')),
  0, 'Reopening removes the completion activity');

select pg_temp.as_user(current_setting('t.tim')::uuid);
select lives_ok(format('select complete_task_occurrence(%L)', current_setting('t.week1')), 'Tim completes week 1');
select lives_ok(
  format('select complete_task_occurrence((select id from task_occurrences where task_id = %L and status = ''open''))', current_setting('t.bins')),
  'Tim completes week 2 early');
select bag_eq(
  format($q$select event_type, completed_by, due_date from task_completion_events
            where task_id = %L$q$, current_setting('t.bins')),
  format($q$values ('completed'::text, %L::uuid, %L::date), ('reopened', null, %L::date),
                   ('completed', %L::uuid, %L::date), ('completed', %L::uuid, %L::date)$q$,
         current_setting('t.sophie'), current_setting('t.tuesday'), current_setting('t.tuesday'),
         current_setting('t.tim'), current_setting('t.tuesday'),
         current_setting('t.tim'), (current_setting('t.tuesday')::date + 7)::text),
  'Full history of who completed each week is retained');
select is((select due_date from task_occurrences where task_id = current_setting('t.bins')::uuid and status = 'open'),
  current_setting('t.tuesday')::date + 14, 'Week 3 is generated');

-- Anonymous access ----------------------------------------------------------------
select pg_temp.as_admin();
set local role anon;
select throws_ok('select count(*) from tasks', '42501', null, 'anon has no access to tasks');

select * from finish();
rollback;
