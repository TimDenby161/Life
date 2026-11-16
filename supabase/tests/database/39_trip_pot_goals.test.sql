-- Holidays and the wedding drive their pot items: a linked item's amount and
-- due date follow the trip (cost - paid, day before) or the wedding (budget
-- total, day before), edits to the item itself are put back, and a trip can
-- only link its own household's item.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

create function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

select set_config('t.tim', '11111111-1111-1111-1111-111111111111', true);
select set_config('t.out', '33333333-3333-3333-3333-333333333333', true);
select set_config('t.hh', (select household_id::text from household_members where user_id = current_setting('t.tim')::uuid), true);

delete from trips;
delete from wedding_budget_items;
delete from wedding_settings;

select pg_temp.as_user(current_setting('t.tim')::uuid);
with p as (insert into savings_pots (household_id, name) values (current_setting('t.hh')::uuid, 'Holidays') returning id)
select set_config('t.pot', id::text, true) from p;
with g as (
  insert into savings_goals (household_id, name, target_minor, target_date, pot_id)
  values (current_setting('t.hh')::uuid, 'Rome', 100000, '2028-01-01', current_setting('t.pot')::uuid) returning id
)
select set_config('t.goal', id::text, true) from g;
with g as (
  insert into savings_goals (household_id, name, target_minor, pot_id)
  values (current_setting('t.hh')::uuid, 'Wedding', 2000000, current_setting('t.pot')::uuid) returning id
)
select set_config('t.wgoal', id::text, true) from g;

-- Holidays --------------------------------------------------------------------------------
select lives_ok(format($$insert into trips (household_id, name, starts_on, ends_on, cost_minor, paid_minor, pot_goal_id)
  values (%L, 'Rome', '2027-05-10', '2027-05-14', 250000, 50000, %L)$$, current_setting('t.hh'), current_setting('t.goal')),
  'A holiday can be saved in a pot item');
select is((select target_minor from savings_goals where id = current_setting('t.goal')::uuid), 200000::bigint,
  'The item is the cost less what is paid');
select is((select target_date from savings_goals where id = current_setting('t.goal')::uuid), '2027-05-09'::date,
  'Due the day before it starts');

update trips set cost_minor = 300000, starts_on = '2027-06-01', ends_on = '2027-06-05' where name = 'Rome';
select is((select (target_minor, target_date)::text from savings_goals where id = current_setting('t.goal')::uuid), '(250000,2027-05-31)',
  'Changing the plan changes the item');

update trips set paid_minor = 300000 where name = 'Rome';
select is((select target_minor from savings_goals where id = current_setting('t.goal')::uuid), 0::bigint,
  'A fully paid holiday needs nothing more');

update trips set paid_minor = 100000 where name = 'Rome';
update savings_goals set target_minor = 1, target_date = '2030-01-01' where id = current_setting('t.goal')::uuid;
select is((select (target_minor, target_date)::text from savings_goals where id = current_setting('t.goal')::uuid), '(200000,2027-05-31)',
  'Editing a linked item keeps the holiday''s amount and date');

update trips set pot_goal_id = null where name = 'Rome';
update savings_goals set target_minor = 123400 where id = current_setting('t.goal')::uuid;
select is((select target_minor from savings_goals where id = current_setting('t.goal')::uuid), 123400::bigint,
  'Once unlinked the item is edited freely');

update trips set pot_goal_id = current_setting('t.goal')::uuid where name = 'Rome';
select throws_ok(format($$insert into trips (household_id, name, starts_on, ends_on, pot_goal_id)
  values (%L, 'Paris', '2027-07-01', '2027-07-03', %L)$$, current_setting('t.hh'), current_setting('t.goal')), '23505', null,
  'A pot item pays for one holiday');

-- Wedding ---------------------------------------------------------------------------------
insert into wedding_settings (household_id, pot_goal_id, wedding_date) values (current_setting('t.hh')::uuid, current_setting('t.wgoal')::uuid, '2028-09-01');
select is((select (target_minor, target_date)::text from savings_goals where id = current_setting('t.wgoal')::uuid), '(2000000,2028-08-31)',
  'With no budget the wedding item keeps its amount but takes the date');
insert into wedding_budget_items (household_id, category, name, budget_minor, paid_minor)
  values (current_setting('t.hh')::uuid, 'Venue', 'Venue', 1500000, 0);
update wedding_settings set wedding_date = '2028-09-20' where household_id = current_setting('t.hh')::uuid;
select is((select (target_minor, target_date)::text from savings_goals where id = current_setting('t.wgoal')::uuid), '(1500000,2028-09-19)',
  'The wedding item follows the budget and the date');

-- Isolation -------------------------------------------------------------------------------
select pg_temp.as_user(current_setting('t.out')::uuid);
select throws_ok(format($$insert into trips (household_id, name, starts_on, ends_on, pot_goal_id)
  values ((select household_id from household_members where user_id = %L), 'Oslo', '2027-08-01', '2027-08-03', %L)$$,
  current_setting('t.out'), current_setting('t.goal')), '23503', null,
  'A trip can only use its own household''s pot item');

select * from finish();
rollback;
