-- Savings pots: household isolation and pot items.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

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
with a as (
  insert into financial_accounts (household_id, name, account_type, ownership) values (current_setting('t.hh')::uuid, 'Holiday', 'savings', 'joint')
  returning id
) select set_config('t.acc', id::text, true) from a;
with p as (
  insert into savings_pots (household_id, name, account_id) values (current_setting('t.hh')::uuid, 'Holidays', current_setting('t.acc')::uuid)
  returning id
) select set_config('t.pot', id::text, true) from p;

select lives_ok(
  format($q$insert into savings_goals (household_id, name, target_minor, pot_id, sort_order) values (%L, 'Italy', 150000, %L, 0), (%L, 'Japan', 400000, %L, 1)$q$,
         current_setting('t.hh'), current_setting('t.pot'), current_setting('t.hh'), current_setting('t.pot')),
  'Items can be added to a pot in order');
select throws_ok(
  format($q$insert into savings_goals (household_id, name, target_minor, pot_id, account_id) values (%L, 'Both', 1, %L, %L)$q$,
         current_setting('t.hh'), current_setting('t.pot'), current_setting('t.acc')),
  '23514', null, 'A pot item takes its money from the pot, not its own account');
select lives_ok(
  format($q$update savings_goals set sort_order = 5 where pot_id = %L and name = 'Italy'$q$, current_setting('t.pot')),
  'Items can be re-ordered');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from savings_pots), 0, 'An outsider cannot see the pots');
select throws_ok(
  format($q$insert into savings_goals (household_id, name, target_minor, pot_id) values (%L, 'Sneaky', 1, %L)$q$, current_setting('t.hh'), current_setting('t.pot')),
  '42501', null, 'An outsider cannot add to another household''s pot');

select pg_temp.as_user(current_setting('t.tim')::uuid);
delete from savings_pots where id = current_setting('t.pot')::uuid;
select is((select count(*)::int from savings_goals where pot_id = current_setting('t.pot')::uuid), 0, 'Deleting a pot removes its items');
select is((select count(*)::int from financial_accounts where id = current_setting('t.acc')::uuid), 1, 'Deleting a pot keeps its account');

select * from finish();
rollback;
