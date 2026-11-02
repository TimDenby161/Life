-- Investments: both members read each other's holdings, only the owner writes,
-- outsiders see nothing.
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
select set_config('t.sophie', '22222222-2222-2222-2222-222222222222', true);
select set_config('t.out', '33333333-3333-3333-3333-333333333333', true);
select set_config('t.hh', (select household_id::text from household_members where user_id = current_setting('t.tim')::uuid), true);

delete from investment_holdings;
delete from investment_settings;

select pg_temp.as_user(current_setting('t.tim')::uuid);
select lives_ok(
  format('insert into investment_holdings (household_id, ticker, name, in_pie, value_minor, target_pct) values (%L, %L, %L, true, 360000, 60)',
         current_setting('t.hh'), 'VNRG', 'Vanguard FTSE North America'),
  'a member adds a holding');
select lives_ok(
  format('insert into investment_settings (household_id, monthly_minor) values (%L, 35000)', current_setting('t.hh')),
  'a member saves their settings');
select is((select user_id from investment_holdings where ticker = 'VNRG'), current_setting('t.tim')::uuid, 'the holding belongs to whoever added it');
select throws_ok(
  format('insert into investment_holdings (household_id, ticker, name, value_minor) values (%L, %L, %L, -1)', current_setting('t.hh'), 'BAD', 'Bad'),
  '23514', null, 'values cannot be negative');

-- Partner: reads, can't write ------------------------------------------------------
select pg_temp.as_user(current_setting('t.sophie')::uuid);
select is((select count(*)::int from investment_holdings where ticker = 'VNRG'), 1, 'the partner can see holdings');
select is((select monthly_minor from investment_settings where user_id = current_setting('t.tim')::uuid), 35000::bigint, 'the partner can see settings');
select is_empty('update investment_holdings set value_minor = 0 where ticker = ''VNRG'' returning id', 'the partner cannot change someone else''s holding');
select is_empty('delete from investment_holdings where ticker = ''VNRG'' returning id', 'the partner cannot delete someone else''s holding');
select throws_ok(
  format('insert into investment_holdings (household_id, user_id, ticker, name) values (%L, %L, %L, %L)',
         current_setting('t.hh'), current_setting('t.tim'), 'COIN', 'Coinbase'),
  '42501', null, 'nobody can add holdings for someone else');

-- Outsiders ------------------------------------------------------------------------
select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from investment_holdings) + (select count(*)::int from investment_settings), 0, 'outsiders see nothing');

select * from finish();
rollback;
