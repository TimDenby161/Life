-- Sleep readings: built-in metrics, logged by their owner, readable by both.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

create function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

select set_config('t.hh', (select household_id::text from household_members where user_id = '11111111-1111-1111-1111-111111111111'), true);
select is((select count(*)::int from health_metric_definitions where owner_id is null and key in ('sleep_duration', 'sleep_score')), 2, 'both sleep metrics exist');

select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select lives_ok(format($$insert into health_measurements (household_id, metric_id, value) select %L, id, 82 from health_metric_definitions where key = 'sleep_score'$$,
  current_setting('t.hh')), 'a member logs their sleep score');
select is((select m.category from health_measurements m join health_metric_definitions d on d.id = m.metric_id where d.key = 'sleep_score' and m.value = 82), 'sleep', 'it is filed under sleep');

select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is((select count(*)::int from health_measurements m join health_metric_definitions d on d.id = m.metric_id where d.key = 'sleep_score' and m.value = 82), 1, 'the partner can read it');

select * from finish();
rollback;
