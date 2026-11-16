-- Cashflow: shared within the household, sensible amounts only, outsiders see
-- nothing, and created_by can't be forged.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

create function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

select set_config('t.tim', '11111111-1111-1111-1111-111111111111', true);
select set_config('t.sophie', '22222222-2222-2222-2222-222222222222', true);
select set_config('t.out', '33333333-3333-3333-3333-333333333333', true);
select set_config('t.hh', (select household_id::text from household_members where user_id = current_setting('t.tim')::uuid), true);

delete from cashflow_items;

select pg_temp.as_user(current_setting('t.tim')::uuid);
select lives_ok(format($$insert into cashflow_items (household_id, direction, name, amount_minor, owner_id) values (%L, 'in', 'Salary', 300000, %L)$$,
  current_setting('t.hh'), current_setting('t.tim')), 'a member adds their income');
select lives_ok(format($$insert into cashflow_items (household_id, direction, name, amount_minor) values (%L, 'out', 'Mortgage', 120000)$$,
  current_setting('t.hh')), 'and a joint outgoing');
select throws_ok(format($$insert into cashflow_items (household_id, direction, name, amount_minor) values (%L, 'out', 'Nothing', 0)$$,
  current_setting('t.hh')), '23514', null, 'amounts are more than zero');
select throws_ok(format($$insert into cashflow_items (household_id, direction, name, amount_minor, created_by) values (%L, 'out', 'Forged', 100, %L)$$,
  current_setting('t.hh'), current_setting('t.sophie')), '42501', null, 'created_by is not client-writable');

select pg_temp.as_user(current_setting('t.sophie')::uuid);
update cashflow_items set amount_minor = 125000 where name = 'Mortgage';
select is((select amount_minor from cashflow_items where name = 'Mortgage'), 125000::bigint, 'the partner can change it');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from cashflow_items), 0, 'an outsider sees nothing');
select throws_ok(format($$insert into cashflow_items (household_id, direction, name, amount_minor) values (%L, 'out', 'Sneaky', 100)$$,
  current_setting('t.hh')), '42501', null, 'an outsider cannot add to it');

select * from finish();
rollback;
