-- Rooms: household-only, and a task can only use its own household's rooms.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

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
with r as (
  insert into task_rooms (household_id, name) values (current_setting('t.hh')::uuid, 'Utility room') returning id
)
select set_config('t.room', id::text, true) from r;
select ok((select count(*) from task_rooms where household_id = current_setting('t.hh')::uuid) > 0, 'members see their rooms');

with t as (
  insert into tasks (household_id, list_id, title, room_id, recurrence, due_date)
  values (current_setting('t.hh')::uuid, current_setting('t.joint')::uuid, 'Descale the kettle',
          current_setting('t.room')::uuid, '{"freq":"monthly","afterDone":true}', current_date)
  returning id
)
select set_config('t.task', id::text, true) from t;
select is((select room_id from tasks where id = current_setting('t.task')::uuid), current_setting('t.room')::uuid, 'a job can be put in a room');

-- Outsiders ---------------------------------------------------------------------
select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from task_rooms where household_id = current_setting('t.hh')::uuid), 0, 'outsiders cannot see the rooms');
select is_empty(
  format('update task_rooms set name = %L where id = %L returning id', 'Mine now', current_setting('t.room')),
  'outsiders cannot rename a room');

-- Deleting a room leaves its tasks without one ------------------------------------
select pg_temp.as_user(current_setting('t.tim')::uuid);
delete from task_rooms where id = current_setting('t.room')::uuid;
select is((select room_id from tasks where id = current_setting('t.task')::uuid), null, 'deleting a room clears it from tasks');

select throws_ok(
  format('update tasks set room_id = %L where id = %L', gen_random_uuid(), current_setting('t.task')),
  '23503', null, 'a task cannot point at a room outside its household');

select * from finish();
rollback;
