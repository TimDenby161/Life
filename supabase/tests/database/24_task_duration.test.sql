-- A task's own time: either member can set it on a shared task; it must be sensible.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

create function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

select set_config('t.task', (select t.id::text from tasks t join task_lists l on l.id = t.list_id where l.kind = 'joint' limit 1), true);

select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select lives_ok(format($$update tasks set duration_minutes = 45 where id = %L$$, current_setting('t.task')), 'a member sets how long a joint task takes');
select is((select duration_minutes from tasks where id = current_setting('t.task')::uuid), 45::smallint, 'it is saved');
select throws_ok(format($$update tasks set duration_minutes = 0 where id = %L$$, current_setting('t.task')), '23514', null, 'it has to be at least a minute');

select * from finish();
rollback;
