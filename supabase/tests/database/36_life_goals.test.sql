-- Goals are shared within the household (either of you edits any, including
-- Together's); outsiders see and add nothing.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

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

delete from life_goals;

select pg_temp.as_user(current_setting('t.tim')::uuid);
select lives_ok(format($$insert into life_goals (household_id, owner_id, area, goal) values (%L, %L, 'table_tennis', 'Top 200 in England')$$,
  current_setting('t.hh'), current_setting('t.tim')), 'a member adds their own goal');
select lives_ok(format($$insert into life_goals (household_id, area, goal) values (%L, 'wedding', 'September 2028')$$,
  current_setting('t.hh')), 'and a Together one');
select throws_ok(format($$insert into life_goals (household_id, area, goal) values (%L, 'career', 'Not an area')$$,
  current_setting('t.hh')), '23514', null, 'only the ten areas');

select pg_temp.as_user(current_setting('t.sophie')::uuid);
update life_goals set goal = 'Around September 2028' where area = 'wedding';
select is((select goal from life_goals where area = 'wedding'), 'Around September 2028', 'the partner can edit it');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from life_goals), 0, 'an outsider sees no goals');
select throws_ok(format($$insert into life_goals (household_id, area, goal) values (%L, 'people', 'Sneaky')$$,
  current_setting('t.hh')), '42501', null, 'an outsider cannot add one');

select * from finish();
rollback;
