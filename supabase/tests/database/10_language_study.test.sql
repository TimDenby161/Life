-- Languages (Mandarin, Spanish): both members read each other's progress, only the owner writes,
-- outsiders see nothing, and linked jobs must be the household's own.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

create function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $$;
grant execute on all functions in schema pg_temp to authenticated;

select set_config('t.tim', '11111111-1111-1111-1111-111111111111', true);
select set_config('t.sophie', '22222222-2222-2222-2222-222222222222', true);
select set_config('t.out', '33333333-3333-3333-3333-333333333333', true);
select set_config('t.hh', (select household_id::text from household_members where user_id = current_setting('t.tim')::uuid), true);
select set_config('t.joint', (select id::text from task_lists where household_id = current_setting('t.hh')::uuid and kind = 'joint'), true);

-- Start clean (rolled back at the end) so local test data doesn't collide.
delete from language_progress;
delete from language_study;

select pg_temp.as_user(current_setting('t.tim')::uuid);
with t as (
  insert into tasks (household_id, list_id, title, recurrence, due_date)
  values (current_setting('t.hh')::uuid, current_setting('t.joint')::uuid, 'Learn 3 new Mandarin words',
          '{"freq":"daily","afterDone":true}', current_date)
  returning id
)
select set_config('t.task', id::text, true) from t;

select lives_ok(
  format('insert into language_study (household_id, language, words_task_id) values (%L, %L, %L)',
         current_setting('t.hh'), 'zh', current_setting('t.task')),
  'a member saves their study settings with a linked job');
select lives_ok(
  format('insert into language_progress (household_id, language, kind, item, learned_on, due_on) values (%L, %L, %L, %L, current_date, current_date + 1)',
         current_setting('t.hh'), 'zh', 'word', '你好'),
  'a member records a learned word');
select is((select user_id from language_progress where item = '你好'), current_setting('t.tim')::uuid, 'progress belongs to whoever learned it');

-- Partner: reads, can't write ------------------------------------------------------
select pg_temp.as_user(current_setting('t.sophie')::uuid);
select is((select count(*)::int from language_progress where item = '你好'), 1, 'the partner can see progress');
select is_empty(
  format('update language_progress set interval_days = 300 where item = %L returning id', '你好'),
  'the partner cannot change someone else''s progress');
select throws_ok(
  format('insert into language_progress (household_id, user_id, language, kind, item, learned_on, due_on) values (%L, %L, %L, %L, %L, current_date, current_date)',
         current_setting('t.hh'), current_setting('t.tim'), 'zh', 'word', '谢谢'),
  '42501', null, 'nobody can record progress for someone else');

select lives_ok(
  format('insert into language_progress (household_id, language, kind, item, learned_on, due_on) values (%L, %L, %L, %L, current_date, current_date + 1)',
         current_setting('t.hh'), 'es', 'word', 'hola'),
  'Spanish words can be learned too');
select throws_ok(
  format('insert into language_study (household_id, language) values (%L, %L)', current_setting('t.hh'), 'fr'),
  '23514', null, 'only the languages the app teaches');

-- Outsiders ------------------------------------------------------------------------
select pg_temp.as_user(current_setting('t.out')::uuid);
select is((select count(*)::int from language_progress) + (select count(*)::int from language_study), 0, 'outsiders see nothing');

-- Linked jobs ------------------------------------------------------------------------
select pg_temp.as_user(current_setting('t.tim')::uuid);
select throws_ok(
  format('update language_study set review_task_id = %L where user_id = %L', gen_random_uuid(), current_setting('t.tim')),
  '23503', null, 'a linked job must be one of the household''s tasks');
delete from tasks where id = current_setting('t.task')::uuid;
select is((select words_task_id from language_study where user_id = current_setting('t.tim')::uuid), null, 'deleting a linked job unlinks it');

select throws_ok(
  format('update language_progress set learned_on = current_date - 30 where item = %L', '你好'),
  '42501', null, 'when an item was learned is not editable');

select * from finish();
rollback;
