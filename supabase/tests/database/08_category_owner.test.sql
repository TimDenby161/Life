-- Category owners: every task in an owned category is assigned to the owner.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

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

create function pg_temp.assignees(p_task text) returns text language sql as $$
  select (select assignee_id::text from tasks where id = p_task::uuid) || '/' ||
         coalesce((select assignee_id::text from task_occurrences where task_id = p_task::uuid and status = 'open'), '-')
$$;
grant execute on all functions in schema pg_temp to authenticated;

select pg_temp.as_user(current_setting('t.sophie')::uuid);

-- A task already in the category before it gets an owner -------------------------
with c as (
  insert into task_categories (household_id, name, color) values (current_setting('t.hh')::uuid, 'Table Tennis', 'indigo')
  returning id
)
select set_config('t.cat', id::text, true) from c;
with t as (
  insert into tasks (household_id, list_id, title, assignee_id, category_id)
  values (current_setting('t.hh')::uuid, current_setting('t.joint')::uuid, 'Restring bat',
          current_setting('t.sophie')::uuid, current_setting('t.cat')::uuid)
  returning id
)
select set_config('t.old', id::text, true) from t;
select is(pg_temp.assignees(current_setting('t.old')), current_setting('t.sophie') || '/' || current_setting('t.sophie'),
  'without an owner the category leaves assignees alone');

update task_categories set owner_id = current_setting('t.tim')::uuid where id = current_setting('t.cat')::uuid;
select is(pg_temp.assignees(current_setting('t.old')), current_setting('t.tim') || '/' || current_setting('t.tim'),
  'giving the category an owner hands its tasks and open occurrences over');

-- New tasks and edits -------------------------------------------------------------
with t as (
  insert into tasks (household_id, list_id, title, assignee_id, category_id)
  values (current_setting('t.hh')::uuid, current_setting('t.joint')::uuid, 'Book a table',
          current_setting('t.sophie')::uuid, current_setting('t.cat')::uuid)
  returning id
)
select set_config('t.new', id::text, true) from t;
select is(pg_temp.assignees(current_setting('t.new')), current_setting('t.tim') || '/' || current_setting('t.tim'),
  'a new task in an owned category goes to the owner');

update tasks set assignee_id = null where id = current_setting('t.new')::uuid;
select is(pg_temp.assignees(current_setting('t.new')), current_setting('t.tim') || '/' || current_setting('t.tim'),
  'the assignee cannot be changed away from the owner');

update task_occurrences set assignee_id = current_setting('t.sophie')::uuid
where task_id = current_setting('t.new')::uuid and status = 'open';
select is(pg_temp.assignees(current_setting('t.new')), current_setting('t.tim') || '/' || current_setting('t.tim'),
  'an open occurrence cannot be reassigned either');

-- Moving a task in and out ----------------------------------------------------------
with t as (
  insert into tasks (household_id, list_id, title, assignee_id)
  values (current_setting('t.hh')::uuid, current_setting('t.joint')::uuid, 'Pay league fees', current_setting('t.sophie')::uuid)
  returning id
)
select set_config('t.moved', id::text, true) from t;
update tasks set category_id = current_setting('t.cat')::uuid where id = current_setting('t.moved')::uuid;
select is(pg_temp.assignees(current_setting('t.moved')), current_setting('t.tim') || '/' || current_setting('t.tim'),
  'moving a task into an owned category reassigns it');

update tasks set category_id = null, assignee_id = current_setting('t.sophie')::uuid where id = current_setting('t.moved')::uuid;
select is(pg_temp.assignees(current_setting('t.moved')), current_setting('t.sophie') || '/' || current_setting('t.sophie'),
  'out of the category it can be assigned to anyone again');

-- Clearing the owner, and outsiders ------------------------------------------------
update task_categories set owner_id = null where id = current_setting('t.cat')::uuid;
update tasks set assignee_id = current_setting('t.sophie')::uuid where id = current_setting('t.new')::uuid;
select is(pg_temp.assignees(current_setting('t.new')), current_setting('t.sophie') || '/' || current_setting('t.sophie'),
  'once the category is joint again, tasks can be reassigned');

select throws_ok(
  format('update task_categories set owner_id = %L where id = %L', current_setting('t.out'), current_setting('t.cat')),
  '23503', null, 'the owner must be a member of the household');

select * from finish();
rollback;
