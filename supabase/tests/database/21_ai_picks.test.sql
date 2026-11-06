-- AI top-job picks per tab: readable by the household, written only by the
-- service role, upserted per day, with old days cleared.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

create function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
end $$;
grant execute on all functions in schema pg_temp to authenticated, service_role, anon;

select set_config('t.tim', '11111111-1111-1111-1111-111111111111', true);
select set_config('t.sophie', '22222222-2222-2222-2222-222222222222', true);
select set_config('t.out', '33333333-3333-3333-3333-333333333333', true);
select set_config('t.hh', (select household_id::text from household_members where user_id = current_setting('t.tim')::uuid), true);
delete from ai_picks;

-- Checked as privileges, not calls (see 16_agents: refused calls crash CI's Postgres image).
select ok(not has_function_privilege('authenticated', 'public.agent_save_picks(uuid, text, date, jsonb)', 'execute'), 'members cannot write picks');
select ok(not has_table_privilege('authenticated', 'public.ai_picks', 'insert') and not has_table_privilege('authenticated', 'public.ai_picks', 'update'),
  'picks are read-only for members');

select pg_temp.as_service();
select agent_save_picks(current_setting('t.hh')::uuid, 'together', '2026-11-07', '[{"task_id":"x","title":"Big shop","why":"Both free","where":"home"}]');
select agent_save_picks(current_setting('t.hh')::uuid, 'together', '2026-11-07', '[{"task_id":"y","title":"Plan holiday","why":"Free evening","where":"anywhere"}]');
select is((select picks #>> '{0,title}' from ai_picks where view = 'together'), 'Plan holiday', 'a second save that day replaces the picks');
select agent_save_picks(current_setting('t.hh')::uuid, current_setting('t.tim'), '2026-10-01', '[]');
select agent_save_picks(current_setting('t.hh')::uuid, current_setting('t.tim'), '2026-11-07', '[]');
select is((select count(*)::int from ai_picks where day < '2026-10-31'), 0, 'picks older than a week are cleared');

select pg_temp.as_user(current_setting('t.sophie')::uuid);
select is((select count(*)::int from ai_picks), 2, 'both of you see every tab''s picks');
select throws_ok($$insert into ai_picks (household_id, view, day, picks) values ('00000000-0000-0000-0000-000000000000', 'together', '2026-11-07', '[]')$$,
  '42501', null, 'members cannot add picks');

select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from ai_picks), 0, 'outsiders see none');

select * from finish();
rollback;
