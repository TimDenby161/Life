-- Exercise week plan: both of you edit every box, one box per person (or both)
-- per day, who changed it is recorded, outsiders see nothing, and
-- exercise_goals gives only your own household's activities.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

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

delete from exercise_plan;
insert into agent_settings (household_id, user_id, agent_id, config)
values (current_setting('t.hh')::uuid, current_setting('t.sophie')::uuid, 'health_coach',
  '{"activities":[{"name":"Yoga","times":2}],"events":[{"name":"Race","date":"2026-12-01"}]}')
on conflict (user_id, agent_id) do update set config = excluded.config;

select pg_temp.as_user(current_setting('t.tim')::uuid);
select lives_ok(format($$insert into exercise_plan (household_id, day, owner_id, activity) values (%L, '2026-11-16', %L, 'Yoga')$$,
  current_setting('t.hh'), current_setting('t.sophie')), 'either of you sets the other''s box');
select lives_ok(format($$insert into exercise_plan (household_id, day, activity) values (%L, '2026-11-16', 'Run')$$,
  current_setting('t.hh')), 'and a box for both');
select throws_ok(format($$insert into exercise_plan (household_id, day, activity) values (%L, '2026-11-16', 'Swim')$$,
  current_setting('t.hh')), '23505', null, 'one shared box per day');
select is((select activities from exercise_goals() where user_id = current_setting('t.sophie')::uuid),
  '[{"name":"Yoga","times":2}]'::jsonb, 'exercise_goals gives the partner''s activities and nothing else');

select pg_temp.as_user(current_setting('t.sophie')::uuid);
update exercise_plan set activity = null where owner_id = current_setting('t.sophie')::uuid;
select is((select updated_by from exercise_plan where owner_id = current_setting('t.sophie')::uuid), current_setting('t.sophie')::uuid, 'who changed it is recorded');
select throws_ok(format($$update exercise_plan set updated_by = %L$$, current_setting('t.tim')), '42501', null, 'and can''t be forged');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from exercise_plan), 0, 'an outsider sees nothing');
select is((select count(*)::int from exercise_goals()), 0, 'or anyone''s goals');

select * from finish();
rollback;
