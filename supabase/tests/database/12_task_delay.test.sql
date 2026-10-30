-- Putting a task off: open occurrences only, members only, and a repeating task starts again.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

create function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $$;
grant execute on all functions in schema pg_temp to authenticated;

select set_config('t.tim', '11111111-1111-1111-1111-111111111111', true);
select set_config('t.out', '33333333-3333-3333-3333-333333333333', true);
select set_config('t.hh', (select household_id::text from household_members where user_id = current_setting('t.tim')::uuid), true);
select set_config('t.joint', (select id::text from task_lists where household_id = current_setting('t.hh')::uuid and kind = 'joint'), true);

select pg_temp.as_user(current_setting('t.tim')::uuid);

with t as (
  insert into tasks (household_id, list_id, title, due_date, recurrence)
  values (current_setting('t.hh')::uuid, current_setting('t.joint')::uuid, 'Water the fern', current_date, '{"freq": "weekly"}')
  returning id
)
select set_config('t.task', id::text, true) from t;
select set_config('t.occ', (select id::text from task_occurrences where task_id = current_setting('t.task')::uuid and status = 'open'), true);

select is((select delay_count from task_occurrences where id = current_setting('t.occ')::uuid), 0, 'a new occurrence has not been put off');

update task_occurrences set delay_count = 1, due_date = current_date + 1 where id = current_setting('t.occ')::uuid;
select is((select delay_count from task_occurrences where id = current_setting('t.occ')::uuid), 1, 'a member can put an open task off');

select throws_ok(
  format('update task_occurrences set delay_count = -1 where id = %L', current_setting('t.occ')),
  '23514', null, 'the count cannot go below zero');

select pg_temp.as_user(current_setting('t.out')::uuid);
update task_occurrences set delay_count = 9 where id = current_setting('t.occ')::uuid;
select pg_temp.as_user(current_setting('t.tim')::uuid);
select is((select delay_count from task_occurrences where id = current_setting('t.occ')::uuid), 1, 'an outsider cannot change it');

select complete_task_occurrence(current_setting('t.occ')::uuid);
select is((select delay_count from task_occurrences where task_id = current_setting('t.task')::uuid and status = 'open'), 0,
  'the next time round starts again');

update task_occurrences set delay_count = 5 where id = current_setting('t.occ')::uuid;
select is((select delay_count from task_occurrences where id = current_setting('t.occ')::uuid), 1, 'a finished occurrence cannot be changed');

update tasks set importance_votes = 2 where id = current_setting('t.task')::uuid;
select is((select importance_votes from tasks where id = current_setting('t.task')::uuid), 2, 'a member can vote on a task');

select pg_temp.as_user(current_setting('t.out')::uuid);
update tasks set importance_votes = -9 where id = current_setting('t.task')::uuid;
select pg_temp.as_user(current_setting('t.tim')::uuid);
select is((select importance_votes from tasks where id = current_setting('t.task')::uuid), 2, 'an outsider cannot');

select is((select subtasks_collapsed from tasks where id = current_setting('t.task')::uuid), true, 'subtasks start minimised');
update tasks set subtasks_collapsed = false where id = current_setting('t.task')::uuid;
select is((select subtasks_collapsed from tasks where id = current_setting('t.task')::uuid), false, 'a member can open a task''s subtasks');

select * from finish();
rollback;
