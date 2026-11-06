-- Trips are shared within the household; career goals are readable by both but
-- written only by their owner; outsiders see neither.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

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

-- Trips ---------------------------------------------------------------------------------
delete from trips;
delete from career_goals;

select pg_temp.as_user(current_setting('t.tim')::uuid);
select lives_ok(format($$insert into trips (household_id, name, starts_on, ends_on) values (%L, 'Rome', '2026-12-18', '2026-12-22')$$,
  current_setting('t.hh')), 'a member adds a trip');
select is((select transport from trips where name = 'Rome'), 'todo', 'everything starts as to do');
select throws_ok(format($$insert into trips (household_id, name, starts_on, ends_on) values (%L, 'Back to front', '2026-12-22', '2026-12-18')$$,
  current_setting('t.hh')), '23514', null, 'a trip cannot end before it starts');
select throws_ok($$update trips set transport = 'maybe'$$, '23514', null, 'only todo, done or not needed');

select pg_temp.as_user(current_setting('t.sophie')::uuid);
update trips set stay = 'done' where name = 'Rome';
select is((select stay from trips where name = 'Rome'), 'done', 'the partner can tick a trip item');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from trips), 0, 'an outsider sees no trips');

-- Career goals --------------------------------------------------------------------------
select pg_temp.as_user(current_setting('t.tim')::uuid);
select lives_ok(format($$insert into career_goals (household_id, title, target_date) values (%L, 'Pass the APM exam', '2027-06-30')$$,
  current_setting('t.hh')), 'a member adds their own goal');
select throws_ok(format($$insert into career_goals (household_id, user_id, title) values (%L, %L, 'Not mine')$$,
  current_setting('t.hh'), current_setting('t.sophie')), '42501', null, 'nobody adds a goal for someone else');

select pg_temp.as_user(current_setting('t.sophie')::uuid);
select is((select count(*)::int from career_goals), 1, 'the partner can read it');
update career_goals set title = 'Changed';
delete from career_goals;
select pg_temp.as_user(current_setting('t.tim')::uuid);
select is((select title from career_goals), 'Pass the APM exam', 'the partner cannot change or delete it');
update career_goals set last_reviewed_on = '2026-11-06', done_at = now();
select isnt((select done_at from career_goals), null, 'the owner can check in and finish it');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from career_goals), 0, 'an outsider sees no goals');

select * from finish();
rollback;
