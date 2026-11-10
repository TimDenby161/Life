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

-- Its own joint task, so the test doesn't depend on what the seed or other tests left behind.
insert into tasks (household_id, list_id, title, created_by)
select household_id, id, 'Duration test', '11111111-1111-1111-1111-111111111111' from task_lists where kind = 'joint' limit 1;
select set_config('t.task', (select id::text from tasks where title = 'Duration test'), true);

select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select lives_ok(format($$update tasks set duration_minutes = 45 where id = %L$$, current_setting('t.task')), 'a member sets how long a joint task takes');
select is((select duration_minutes from tasks where id = current_setting('t.task')::uuid), 45::smallint, 'it is saved');
select throws_ok(format($$update tasks set duration_minutes = 0 where id = %L$$, current_setting('t.task')), '23514', null, 'it has to be at least a minute');

select * from finish();
rollback;
