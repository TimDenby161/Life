-- Wedding tasks start on Together, and a manual change sticks.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

create function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $$;
grant execute on all functions in schema pg_temp to authenticated;

select set_config('t.tim', '11111111-1111-1111-1111-111111111111', true);
select set_config('t.hh', (select household_id::text from household_members where user_id = current_setting('t.tim')::uuid), true);
select set_config('t.joint', (select id::text from task_lists where household_id = current_setting('t.hh')::uuid and kind = 'joint'), true);
select set_config('t.mine', (select id::text from task_lists where household_id = current_setting('t.hh')::uuid and kind = 'personal' and owner_id = current_setting('t.tim')::uuid), true);

select pg_temp.as_user(current_setting('t.tim')::uuid);

with c as (
  insert into task_categories (household_id, name, color) values (current_setting('t.hh')::uuid, 'Wedding', 'rose') returning id
)
select set_config('t.cat', id::text, true) from c;
insert into wedding_settings (household_id, task_category_id) values (current_setting('t.hh')::uuid, current_setting('t.cat')::uuid)
  on conflict (household_id) do update set task_category_id = excluded.task_category_id;

with t as (
  insert into tasks (household_id, list_id, title, category_id)
  values (current_setting('t.hh')::uuid, current_setting('t.joint')::uuid, 'Choose the flowers', current_setting('t.cat')::uuid)
  returning id, needs_both
)
select set_config('t.task', id::text, true) from t;
select is((select needs_both from tasks where id = current_setting('t.task')::uuid), true, 'a new wedding task takes both of us');

update tasks set needs_both = false where id = current_setting('t.task')::uuid;
update tasks set title = 'Choose the flowers soon' where id = current_setting('t.task')::uuid;
select is((select needs_both from tasks where id = current_setting('t.task')::uuid), false, 'unticking it by hand sticks');

with t as (
  insert into tasks (household_id, list_id, title)
  values (current_setting('t.hh')::uuid, current_setting('t.joint')::uuid, 'Plan the first dance')
  returning id
)
select set_config('t.moved', id::text, true) from t;
select is((select needs_both from tasks where id = current_setting('t.moved')::uuid), false, 'an ordinary task does not');
update tasks set category_id = current_setting('t.cat')::uuid where id = current_setting('t.moved')::uuid;
select is((select needs_both from tasks where id = current_setting('t.moved')::uuid), true, 'moving a task into the wedding category marks it');

with t as (
  insert into tasks (household_id, list_id, title, category_id)
  values (current_setting('t.hh')::uuid, current_setting('t.mine')::uuid, 'Write my speech', current_setting('t.cat')::uuid)
  returning id
)
select set_config('t.own', id::text, true) from t;
select is((select needs_both from tasks where id = current_setting('t.own')::uuid), false, 'one on a personal list stays that person''s');

select * from finish();
rollback;
