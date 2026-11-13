-- Calendar names for the Coach week: either of you can read and teach one, a name is only remembered once,
-- created_by can't be forged, and outsiders see nothing.
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

delete from exercise_names;
insert into exercise_names (household_id, owner_id, phrase, activity, created_by)
values (current_setting('t.hh')::uuid, current_setting('t.tim')::uuid, 'GS1', 'TT match', current_setting('t.tim')::uuid);

select pg_temp.as_user(current_setting('t.tim')::uuid);
select is((select activity from exercise_names where phrase = 'GS1'), 'TT match', 'a member reads the household''s names');

select pg_temp.as_user(current_setting('t.sophie')::uuid);
select lives_ok(format($$insert into exercise_names (household_id, owner_id, phrase, activity) values (%L, %L, 'Barnes Yoga', 'Yoga')$$,
  current_setting('t.hh'), current_setting('t.sophie')), 'a member teaches a name');
select lives_ok(format($$insert into exercise_names (household_id, phrase, activity) values (%L, 'Surrey', null)$$,
  current_setting('t.hh')), 'and one that is not exercise');
select throws_ok(format($$insert into exercise_names (household_id, owner_id, phrase, activity) values (%L, %L, 'barnes yoga', 'Yoga')$$,
  current_setting('t.hh'), current_setting('t.sophie')), '23505', null, 'a name is remembered once');
select throws_ok(format($$insert into exercise_names (household_id, phrase, activity, created_by) values (%L, 'Forged', 'Run', %L)$$,
  current_setting('t.hh'), current_setting('t.tim')), '42501', null, 'created_by is not client-writable');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from exercise_names), 0, 'an outsider sees nothing');
select throws_ok(format($$insert into exercise_names (household_id, phrase, activity) values (%L, 'Sneaky', 'Run')$$, current_setting('t.hh')),
  '42501', null, 'an outsider cannot add one');

select * from finish();
rollback;
