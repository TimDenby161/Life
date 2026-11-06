-- AI top-job picks go onto that day's briefing, only through the service role.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
end $$;
grant execute on all functions in schema pg_temp to service_role;

select set_config('t.tim', '11111111-1111-1111-1111-111111111111', true);
select set_config('t.hh', (select household_id::text from household_members where user_id = current_setting('t.tim')::uuid), true);
delete from agent_briefings where household_id = current_setting('t.hh')::uuid;
insert into agent_briefings (household_id, recipient_id, kind, period_key, content)
values (current_setting('t.hh')::uuid, current_setting('t.tim')::uuid, 'daily', '2026-11-06', '{"date":"2026-11-06","headline":"1 due today."}');

-- Checked as privileges, not calls (see 16_agents: refused calls crash CI's Postgres image).
select ok(not has_function_privilege('authenticated', 'public.agent_set_top_picks(uuid, uuid, date, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.agent_set_top_picks(uuid, uuid, date, jsonb)', 'execute'), 'members cannot set picks');

select pg_temp.as_service();
select is(agent_set_top_picks(current_setting('t.hh')::uuid, current_setting('t.tim')::uuid, '2026-11-06',
  '[{"task_id":"x","title":"Hoover","why":"Due today"}]'), true, 'picks are saved onto the day''s briefing');
select is((select content #>> '{top,0,title}' from agent_briefings where recipient_id = current_setting('t.tim')::uuid), 'Hoover', 'they sit in the briefing content');
select is((select content ->> 'headline' from agent_briefings where recipient_id = current_setting('t.tim')::uuid), '1 due today.', 'the rest of the briefing is kept');
select is(agent_set_top_picks(current_setting('t.hh')::uuid, current_setting('t.tim')::uuid, '2026-11-07', '[]'), false,
  'no briefing for that day: nothing saved');
select is(agent_set_top_picks(current_setting('t.hh')::uuid, current_setting('t.tim')::uuid, '2026-11-06', '[1,2,3,4,5,6]'), false,
  'more than five picks are refused');

select * from finish();
rollback;
