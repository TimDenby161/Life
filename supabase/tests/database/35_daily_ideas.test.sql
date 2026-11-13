-- Daily tasks per area: only the service role adds them; a person's go on their
-- own list, Together's on the Joint list needing both; only areas people have
-- picked; capped per area and per day; no repeats; nothing in the feed.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

select set_config('t.tim', '11111111-1111-1111-1111-111111111111', true);
select set_config('t.sophie', '22222222-2222-2222-2222-222222222222', true);
select set_config('t.hh', (select household_id::text from household_members where user_id = current_setting('t.tim')::uuid), true);

delete from tasks where ai_area is not null;
delete from task_categories where household_id = current_setting('t.hh')::uuid and name = 'Table tennis';
update user_preferences set idea_areas = array['finance', 'wedding', 'meals', 'holidays', 'shopping', 'health', 'people', 'languages']
  where user_id = current_setting('t.sophie')::uuid;
update user_preferences set idea_areas = array['finance', 'wedding', 'meals', 'holidays', 'shopping', 'health', 'table_tennis', 'side_hustles', 'people', 'languages']
  where user_id = current_setting('t.tim')::uuid;
-- The only Shopping category is Sophie's.
update task_categories set owner_id = current_setting('t.sophie')::uuid where household_id = current_setting('t.hh')::uuid and lower(name) = 'shopping';
select set_config('t.feed', (select count(*)::text from feed_events), true);

select is(
  agent_save_ideas(current_setting('t.hh')::uuid, current_date, jsonb_build_array(
    jsonb_build_object('area', 'table_tennis', 'for', current_setting('t.tim'), 'title', 'Log Tuesday''s coaching session', 'minutes', 5),
    jsonb_build_object('area', 'table_tennis', 'for', current_setting('t.tim'), 'title', 'Enter the County Championships', 'minutes', 200),
    jsonb_build_object('area', 'table_tennis', 'for', current_setting('t.sophie'), 'title', 'Not one of her areas'),
    jsonb_build_object('area', 'people', 'for', 'together', 'title', 'Pick a date to have Jo and Dan round'),
    jsonb_build_object('area', 'shopping', 'for', 'together', 'title', 'Buy the kettle before Friday'),
    jsonb_build_object('area', 'nonsense', 'for', current_setting('t.tim'), 'title', 'Not an area'),
    jsonb_build_object('area', 'people', 'for', 'not-a-uuid', 'title', 'Nobody'),
    jsonb_build_object('area', 'people', 'for', current_setting('t.tim'), 'title', 'x')
  )),
  4, 'adds every usable task, several in one area, skipping areas people haven''t picked');

select is((select count(*)::int from tasks t join task_lists l on l.id = t.list_id
  where t.ai_area = 'table_tennis' and l.kind = 'personal' and l.owner_id = current_setting('t.tim')::uuid
    and t.assignee_id = current_setting('t.tim')::uuid and not t.needs_both and t.due_date = current_date),
  2, 'a person''s go on their own list, for them, for today');
select is((select count(*)::int from tasks t join task_lists l on l.id = t.list_id
  where t.ai_area in ('people', 'shopping') and l.kind = 'joint' and t.assignee_id is null and t.needs_both),
  2, 'Together''s go on the Joint list and need you both');
select is((select duration_minutes::int from tasks where title = 'Enter the County Championships'), 45, 'minutes are kept in range');
select is((select c.name from tasks t join task_categories c on c.id = t.category_id where t.title like 'Log Tuesday%'), 'Table tennis', 'an area without a category gets one');
select is((select category_id from tasks where title = 'Buy the kettle before Friday'), null, 'never under someone''s own category for Together');
select is((select count(*)::int from feed_events), current_setting('t.feed')::int, 'nothing posted to the feed');

select is(
  agent_save_ideas(current_setting('t.hh')::uuid, current_date,
    jsonb_build_array(jsonb_build_object('area', 'table_tennis', 'for', current_setting('t.tim'), 'title', 'log tuesday''s coaching session'))),
  0, 'the same task twice is skipped while open');
select is(
  agent_save_ideas(current_setting('t.hh')::uuid, current_date, (
    select jsonb_agg(jsonb_build_object('area', 'table_tennis', 'for', current_setting('t.tim'), 'title', 'Drill ' || n)) from generate_series(1, 4) n)),
  1, 'at most 3 in one area for one person a day');
select is(
  agent_save_ideas(current_setting('t.hh')::uuid, current_date, (
    select jsonb_agg(jsonb_build_object('area', a, 'for', current_setting('t.tim'), 'title', 'Step for ' || a))
    from unnest(array['finance', 'wedding', 'meals', 'holidays', 'health']) a)),
  3, 'at most 6 a day for one person');
select is(
  agent_save_ideas(current_setting('t.hh')::uuid, current_date,
    jsonb_build_array(jsonb_build_object('area', 'people', 'for', current_setting('t.sophie'), 'title', 'Message Amy about Saturday'))),
  1, 'the other person has their own');

update user_preferences set idea_areas = '{}' where user_id = current_setting('t.sophie')::uuid;
select is(
  agent_save_ideas(current_setting('t.hh')::uuid, current_date,
    jsonb_build_array(jsonb_build_object('area', 'languages', 'for', current_setting('t.sophie'), 'title', 'Ten minutes of Spanish'))),
  0, 'none for someone with no areas picked');

-- Clients can neither call it nor set ai_area; goals are shared.
select ok(not has_function_privilege('authenticated', 'public.agent_save_ideas(uuid, date, jsonb)', 'execute'), 'a signed-in person cannot call it');
select ok(not has_column_privilege('authenticated', 'public.tasks', 'ai_area', 'update'), 'ai_area is not client-writable');

select * from finish();
rollback;
