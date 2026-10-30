-- One task waiting on another: same household only, never itself, cleared when the other goes.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

create function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $$;
grant execute on all functions in schema pg_temp to authenticated;

select set_config('t.tim', '11111111-1111-1111-1111-111111111111', true);
select set_config('t.hh', (select household_id::text from household_members where user_id = current_setting('t.tim')::uuid), true);
select set_config('t.joint', (select id::text from task_lists where household_id = current_setting('t.hh')::uuid and kind = 'joint'), true);

select pg_temp.as_user(current_setting('t.tim')::uuid);

with t as (
  insert into tasks (household_id, list_id, title)
  values (current_setting('t.hh')::uuid, current_setting('t.joint')::uuid, 'Move the money')
  returning id
)
select set_config('t.first', id::text, true) from t;
with t as (
  insert into tasks (household_id, list_id, title)
  values (current_setting('t.hh')::uuid, current_setting('t.joint')::uuid, 'Close the account')
  returning id
)
select set_config('t.then', id::text, true) from t;

update tasks set waiting_on_task_id = current_setting('t.first')::uuid where id = current_setting('t.then')::uuid;
select is((select waiting_on_task_id::text from tasks where id = current_setting('t.then')::uuid), current_setting('t.first'),
  'a member can make one task wait on another');

select throws_ok(
  format('update tasks set waiting_on_task_id = id where id = %L', current_setting('t.first')),
  '23514', null, 'a task cannot wait on itself');

select throws_ok(
  format('update tasks set waiting_on_task_id = gen_random_uuid() where id = %L', current_setting('t.first')),
  '23503', null, 'a task cannot wait on one outside the household');

delete from tasks where id = current_setting('t.first')::uuid;
select is((select waiting_on_task_id from tasks where id = current_setting('t.then')::uuid), null,
  'deleting the other task clears the wait');

select * from finish();
rollback;
