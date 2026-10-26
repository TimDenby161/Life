-- Wedding: budget total drives the wedding pot item's target; household isolation.
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

select pg_temp.as_user(current_setting('t.tim')::uuid);
with p as (insert into savings_pots (household_id, name) values (current_setting('t.hh')::uuid, 'Wedding') returning id)
select set_config('t.pot', id::text, true) from p;
with g as (
  insert into savings_goals (household_id, name, target_minor, pot_id) values (current_setting('t.hh')::uuid, 'Wedding', 2000000, current_setting('t.pot')::uuid)
  returning id
) select set_config('t.goal', id::text, true) from g;

select lives_ok(
  format($q$insert into wedding_settings (household_id, pot_goal_id) values (%L, %L)$q$, current_setting('t.hh'), current_setting('t.goal')),
  'The wedding can be linked to a pot item');
select is((select target_minor from savings_goals where id = current_setting('t.goal')::uuid), 2000000::bigint,
  'With no budget the pot item keeps its placeholder target');

insert into wedding_budget_items (household_id, category, name, budget_minor) values
  (current_setting('t.hh')::uuid, 'Venue', 'Venue hire', 900000),
  (current_setting('t.hh')::uuid, 'Food & drink', 'Catering', 650000);
select is((select target_minor from savings_goals where id = current_setting('t.goal')::uuid), 1550000::bigint,
  'The pot target becomes the budget total');

update wedding_budget_items set budget_minor = 1000000 where name = 'Venue hire';
select is((select target_minor from savings_goals where id = current_setting('t.goal')::uuid), 1650000::bigint,
  'Changing a budget line updates the target');

update wedding_budget_items set paid_minor = 200000 where name = 'Venue hire';
select is((select target_minor from savings_goals where id = current_setting('t.goal')::uuid), 1650000::bigint,
  'Recording a payment does not change the target');

delete from wedding_budget_items where name = 'Catering';
select is((select target_minor from savings_goals where id = current_setting('t.goal')::uuid), 1000000::bigint,
  'Removing a line lowers the target');

select throws_ok(
  format($q$insert into wedding_guests (household_id, name, rsvp) values (%L, 'Aunt Jo', 'maybe')$q$, current_setting('t.hh')),
  '23514', null, 'RSVP must be pending, yes or no');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from wedding_budget_items), 0, 'An outsider cannot see the wedding budget');
select throws_ok(
  format($q$insert into wedding_guests (household_id, name) values (%L, 'Gatecrasher')$q$, current_setting('t.hh')),
  '42501', null, 'An outsider cannot add guests');
-- An outsider's own household cannot point its wedding at this household's pot item.
select throws_ok(
  format($q$insert into wedding_settings (household_id, pot_goal_id)
            select household_id, %L from household_members where user_id = %L$q$, current_setting('t.goal'), current_setting('t.out')),
  '23503', null, 'A wedding can only be linked to its own household''s pot item');

select * from finish();
rollback;
