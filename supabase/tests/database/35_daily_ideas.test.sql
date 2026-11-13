-- Daily ideas: only the service role adds them; they land on the person's own
-- list for today under the area's category; one open idea an area per person.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

select set_config('t.tim', '11111111-1111-1111-1111-111111111111', true);
select set_config('t.sophie', '22222222-2222-2222-2222-222222222222', true);
select set_config('t.out', '33333333-3333-3333-3333-333333333333', true);
select set_config('t.hh', (select household_id::text from household_members where user_id = current_setting('t.tim')::uuid), true);

delete from tasks where ai_area is not null;
delete from task_categories where household_id = current_setting('t.hh')::uuid and name = 'Table tennis';
-- The only Shopping category is Sophie's.
update task_categories set owner_id = current_setting('t.sophie')::uuid where household_id = current_setting('t.hh')::uuid and lower(name) = 'shopping';

select is(
  agent_save_ideas(current_setting('t.hh')::uuid, current_setting('t.tim')::uuid, current_date,
    '[{"area":"table_tennis","title":"Log Tuesday''s coaching session","minutes":5},
      {"area":"shopping","title":"Price up a new kettle","minutes":200},
      {"area":"nonsense","title":"Not an area"},
      {"area":"people","title":"x"}]'::jsonb),
  2, 'adds one task for each real area with a real title');

select is((select count(*)::int from tasks t join task_lists l on l.id = t.list_id
  where t.ai_area is not null and l.kind = 'personal' and l.owner_id = current_setting('t.tim')::uuid
    and t.assignee_id = current_setting('t.tim')::uuid and t.due_date = current_date and t.created_by = current_setting('t.tim')::uuid),
  2, 'on his own list, for him, for today');
select is((select duration_minutes::int from tasks where ai_area = 'shopping'), 45, 'minutes are kept in range');
select is((select c.name from tasks t join task_categories c on c.id = t.category_id where t.ai_area = 'table_tennis'), 'Table tennis', 'an area without a category gets one');
select is((select category_id from tasks where ai_area = 'shopping'), null,
  'never goes under the other person''s category: none rather than theirs');

select is(
  agent_save_ideas(current_setting('t.hh')::uuid, current_setting('t.tim')::uuid, current_date, '[{"area":"table_tennis","title":"Another one"}]'::jsonb),
  0, 'no second idea while the area''s last one is open');
select is(
  agent_save_ideas(current_setting('t.hh')::uuid, current_setting('t.sophie')::uuid, current_date, '[{"area":"table_tennis","title":"Sophie''s own"}]'::jsonb),
  1, 'the other person has their own');
select throws_ok(
  format($$select agent_save_ideas(%L, %L, current_date, '[]')$$, current_setting('t.hh'), current_setting('t.out')),
  '42501', null, 'only for members of the household');

-- Clients can neither call it nor set ai_area.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('t.tim'), 'role', 'authenticated')::text, true);
select throws_ok(
  format($$select agent_save_ideas(%L, %L, current_date, '[]')$$, current_setting('t.hh'), current_setting('t.tim')),
  '42501', null, 'a signed-in person cannot call it');
select throws_ok($$update tasks set ai_area = 'finance' where ai_area = 'table_tennis'$$, '42501', null, 'ai_area is not client-writable');

select * from finish();
rollback;
