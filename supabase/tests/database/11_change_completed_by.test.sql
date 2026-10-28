-- Changing who did a completed task: a new history event, never an edit.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

create function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $$;
grant execute on all functions in schema pg_temp to authenticated;

select set_config('t.tim', '11111111-1111-1111-1111-111111111111', true);
select set_config('t.sophie', '22222222-2222-2222-2222-222222222222', true);
select set_config('t.out', '33333333-3333-3333-3333-333333333333', true);
select set_config('t.hh', (select household_id::text from household_members where user_id = current_setting('t.tim')::uuid), true);
select set_config('t.joint', (select id::text from task_lists where household_id = current_setting('t.hh')::uuid and kind = 'joint'), true);

select pg_temp.as_user(current_setting('t.tim')::uuid);

with t as (
  insert into tasks (household_id, list_id, title)
  values (current_setting('t.hh')::uuid, current_setting('t.joint')::uuid, 'Descale the kettle')
  returning id
)
select set_config('t.task', id::text, true) from t;
select set_config('t.occ', (select id::text from task_occurrences where task_id = current_setting('t.task')::uuid), true);

select throws_ok(
  format('select set_task_occurrence_completed_by(%L, %L)', current_setting('t.occ'), current_setting('t.sophie')),
  'P0001', null, 'an open task has nobody to change');

select complete_task_occurrence(current_setting('t.occ')::uuid);
select set_config('t.at', (select completed_at::text from task_occurrences where id = current_setting('t.occ')::uuid), true);

select set_task_occurrence_completed_by(current_setting('t.occ')::uuid, current_setting('t.sophie')::uuid);

select is((select completed_by::text from task_occurrences where id = current_setting('t.occ')::uuid),
  current_setting('t.sophie'), 'the occurrence now says Sophie did it');
select is((select completed_by::text from tasks where id = current_setting('t.task')::uuid),
  current_setting('t.sophie'), 'a one-off task follows');
select is((select count(*)::int from task_completion_events where occurrence_id = current_setting('t.occ')::uuid),
  2, 'the original event is kept and a new one added');
select ok(exists (
  select 1 from task_completion_events
  where occurrence_id = current_setting('t.occ')::uuid and event_type = 'completed'
    and completed_by = current_setting('t.sophie')::uuid and occurred_at = current_setting('t.at')::timestamptz
), 'the new event credits Sophie at the original completion time');
select is((select actor_id::text from feed_events where event_type = 'task.completed' and entity_id = current_setting('t.task')::uuid),
  current_setting('t.sophie'), 'the feed credits Sophie too');

select throws_ok(
  format('select set_task_occurrence_completed_by(%L, %L)', current_setting('t.occ'), current_setting('t.out')),
  '22023', null, 'only a household member can be credited');

-- We both did it ---------------------------------------------------------------------
select set_task_occurrence_completed_by(current_setting('t.occ')::uuid, current_setting('t.sophie')::uuid, current_setting('t.tim')::uuid);
select is((select also_completed_by::text from task_occurrences where id = current_setting('t.occ')::uuid),
  current_setting('t.tim'), 'a second person can be credited');
select ok(exists (
  select 1 from task_completion_events
  where occurrence_id = current_setting('t.occ')::uuid and completed_by = current_setting('t.sophie')::uuid
    and also_completed_by = current_setting('t.tim')::uuid
), 'the new event carries both people');
select is((select summary from feed_events where event_type = 'task.completed' and entity_id = current_setting('t.task')::uuid),
  'Sophie and Tim completed “Descale the kettle”', 'the feed names both');
select throws_ok(
  format('select set_task_occurrence_completed_by(%L, %L, %L)', current_setting('t.occ'), current_setting('t.tim'), current_setting('t.tim')),
  '22023', null, 'the two people must differ');

select reopen_task_occurrence(current_setting('t.occ')::uuid);
select is((select also_completed_by from task_occurrences where id = current_setting('t.occ')::uuid),
  null, 'reopening clears the second person');

select pg_temp.as_user(current_setting('t.out')::uuid);
select throws_ok(
  format('select set_task_occurrence_completed_by(%L, %L)', current_setting('t.occ'), current_setting('t.tim')),
  'P0002', null, 'an outsider cannot touch it');

select * from finish();
rollback;
