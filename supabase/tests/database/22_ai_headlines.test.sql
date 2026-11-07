-- One-line headlines: readable by the household, written only by the service role.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

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
select set_config('t.out', '33333333-3333-3333-3333-333333333333', true);
select set_config('t.hh', (select household_id::text from household_members where user_id = current_setting('t.tim')::uuid), true);
delete from ai_headlines;

-- Checked as privileges, not calls (see 16_agents: refused calls crash CI's Postgres image).
select ok(not has_function_privilege('authenticated', 'public.agent_save_headlines(uuid, date, jsonb)', 'execute')
  and not has_table_privilege('authenticated', 'public.ai_headlines', 'insert'), 'members cannot write headlines');

select pg_temp.as_service();
select agent_save_headlines(current_setting('t.hh')::uuid, '2026-11-07', '[{"url":"https://www.bbc.co.uk/news/a","title":"Long","short":"Short"}]');
select agent_save_headlines(current_setting('t.hh')::uuid, '2026-11-07', '[{"url":"https://www.bbc.co.uk/news/b","title":"Long","short":"Newer"}]');
select is((select items #>> '{0,short}' from ai_headlines), 'Newer', 'a second save that day replaces the first');

select pg_temp.as_user(current_setting('t.tim')::uuid);
select is((select count(*)::int from ai_headlines), 1, 'members can read them');
select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from ai_headlines), 0, 'outsiders cannot');

select * from finish();
rollback;
