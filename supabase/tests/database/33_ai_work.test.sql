-- Claude does jobs: the morning run can add a question as a task, leave a
-- result on a job and add wedding venues, only through agent_save_work
-- (service role). Members answer a question through answer_ai_question, which
-- ticks it off as them; none of the AI columns are client-writable.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

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
create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
grant execute on all functions in schema pg_temp to authenticated, service_role, anon;

select set_config('t.tim', '11111111-1111-1111-1111-111111111111', true);
select set_config('t.sophie', '22222222-2222-2222-2222-222222222222', true);
select set_config('t.out', '33333333-3333-3333-3333-333333333333', true);
select set_config('t.hh', (select household_id::text from household_members where user_id = current_setting('t.tim')::uuid), true);
select set_config('t.joint', (select id::text from task_lists where household_id = current_setting('t.hh')::uuid and kind = 'joint'), true);

-- Its own wedding category and jobs, so nothing depends on the seed.
delete from wedding_venues;
insert into task_categories (household_id, name, color) values (current_setting('t.hh')::uuid, 'AI work wedding', 'rose');
select set_config('t.cat', (select id::text from task_categories where name = 'AI work wedding'), true);
insert into wedding_settings (household_id, task_category_id) values (current_setting('t.hh')::uuid, current_setting('t.cat')::uuid)
on conflict (household_id) do update set task_category_id = excluded.task_category_id;
insert into tasks (household_id, list_id, title, category_id, created_by)
values (current_setting('t.hh')::uuid, current_setting('t.joint')::uuid, 'AI work: find venues', current_setting('t.cat')::uuid, current_setting('t.tim')::uuid);
insert into tasks (household_id, list_id, title, created_by)
values (current_setting('t.hh')::uuid, current_setting('t.joint')::uuid, 'AI work: compare broadband', current_setting('t.tim')::uuid);
insert into tasks (household_id, list_id, title, due_date, recurrence, created_by)
values (current_setting('t.hh')::uuid, current_setting('t.joint')::uuid, 'AI work: hoover', '2026-11-12', '{"freq":"weekly"}', current_setting('t.tim')::uuid);
select set_config('t.venues', (select id::text from tasks where title = 'AI work: find venues'), true);
select set_config('t.broadband', (select id::text from tasks where title = 'AI work: compare broadband'), true);
select set_config('t.hoover', (select id::text from tasks where title = 'AI work: hoover'), true);
select set_config('t.feed', (select count(*)::text from feed_events), true);

-- Checked as privileges, not calls (see 16_agents: refused calls crash CI's Postgres image).
select ok(not has_function_privilege('authenticated', 'public.agent_save_work(uuid, date, jsonb)', 'execute'), 'members cannot save work as Claude');
select ok(has_function_privilege('authenticated', 'public.answer_ai_question(uuid, text)', 'execute'), 'members can answer');
select ok(not has_function_privilege('anon', 'public.answer_ai_question(uuid, text)', 'execute'), 'signed-out callers cannot');
select ok(
  not has_column_privilege('authenticated', 'public.tasks', 'ai_asks_task_id', 'insert')
  and not has_column_privilege('authenticated', 'public.tasks', 'ai_asks_task_id', 'update')
  and not has_column_privilege('authenticated', 'public.tasks', 'ai_answer', 'update')
  and not has_column_privilege('authenticated', 'public.tasks', 'ai_result', 'insert')
  and not has_column_privilege('authenticated', 'public.tasks', 'ai_result', 'update'),
  'nobody can write a question, an answer or a result straight onto a task');

-- A question ----------------------------------------------------------------
select pg_temp.as_service();
select is(
  agent_save_work(current_setting('t.hh')::uuid, '2026-11-12', jsonb_build_array(
    jsonb_build_object('task_id', current_setting('t.venues'), 'kind', 'ask', 'question', 'Wedding venues: which area should I search?'),
    jsonb_build_object('task_id', current_setting('t.hoover'), 'kind', 'ask', 'question', 'Which room should be hoovered?'),
    jsonb_build_object('task_id', '00000000-0000-0000-0000-000000000000', 'kind', 'ask', 'question', 'A job that is not there?')
  )),
  '{"asked": 1, "done": 0, "venues": 0}'::jsonb,
  'a question is saved for an open one-off job; repeating and unknown jobs are skipped');
select pg_temp.as_owner();
select set_config('t.q', (select id::text from tasks where ai_asks_task_id = current_setting('t.venues')::uuid), true);
select results_eq(
  format($$select title, list_id::text, category_id::text, due_date, needs_both, duration_minutes::int, created_by::text from tasks where id = %L$$, current_setting('t.q')),
  format($$values ('Wedding venues: which area should I search?', %L, %L, '2026-11-12'::date, false, 5, %L)$$, current_setting('t.joint'), current_setting('t.cat'), current_setting('t.tim')),
  'the question is a task beside its job, due that day, for one person to answer');
select is((select count(*)::int from task_occurrences where task_id = current_setting('t.q')::uuid and status = 'open'), 1, 'with an open occurrence like any task');
select is((select count(*)::text from feed_events), current_setting('t.feed'), 'and nothing in the feed');

select pg_temp.as_service();
select is(
  agent_save_work(current_setting('t.hh')::uuid, '2026-11-12', jsonb_build_array(
    jsonb_build_object('task_id', current_setting('t.venues'), 'kind', 'ask', 'question', 'And what is the budget?'),
    jsonb_build_object('task_id', current_setting('t.q'), 'kind', 'ask', 'question', 'A question about a question?')
  )) ->> 'asked', '0', 'one question at a time for a job, and never about a question');

-- Answering -----------------------------------------------------------------
select pg_temp.as_user(current_setting('t.out')::uuid);
select throws_ok(format($$select answer_ai_question(%L, 'Somewhere')$$, current_setting('t.q')), 'P0002', null, 'an outsider cannot answer');
select pg_temp.as_user(current_setting('t.sophie')::uuid);
select throws_ok(format($$select answer_ai_question(%L, 'Somewhere')$$, current_setting('t.broadband')), 'P0002', null, 'an ordinary task is not a question');
select throws_ok(format($$select answer_ai_question(%L, '   ')$$, current_setting('t.q')), '22023', null, 'an answer needs some words');
select throws_ok(format($$update tasks set ai_answer = 'Sneaky' where id = %L$$, current_setting('t.q')), '42501', null, 'the answer cannot be written directly');
select lives_ok(format($$select answer_ai_question(%L, '  Near Bath, within an hour  ')$$, current_setting('t.q')), 'either of you can answer');
select is((select ai_answer from tasks where id = current_setting('t.q')::uuid), 'Near Bath, within an hour', 'the answer is kept on the question');
select results_eq(
  format($$select o.status, o.completed_by::text, t.status from task_occurrences o join tasks t on t.id = o.task_id where t.id = %L$$, current_setting('t.q')),
  format($$values ('done', %L, 'completed')$$, current_setting('t.sophie')),
  'and the question is ticked off as the person who answered');
select is((select count(*)::int from task_completion_events where task_id = current_setting('t.q')::uuid and event_type = 'completed'), 1, 'through the usual completion history');
select lives_ok(format($$select answer_ai_question(%L, 'Near Bath or Bristol')$$, current_setting('t.q')), 'an answer can be corrected afterwards');

-- A result ------------------------------------------------------------------
select pg_temp.as_service();
select is(
  agent_save_work(current_setting('t.hh')::uuid, '2026-11-13', jsonb_build_array(
    jsonb_build_object('task_id', current_setting('t.venues'), 'kind', 'done', 'summary', '2 venues near Bath added', 'body', 'Two that fit. Still to do: book visits.',
      'links', jsonb_build_array(jsonb_build_object('title', 'Priston Mill', 'url', 'https://example.com/priston')),
      'venues', jsonb_build_array(
        jsonb_build_object('name', 'Priston Mill', 'url', 'https://example.com/priston', 'note', 'Watermill and barn, up to 150'),
        jsonb_build_object('name', 'priston mill', 'url', 'https://example.com/again'),
        jsonb_build_object('name', 'Bad Link Barn', 'url', 'javascript:alert(1)'),
        jsonb_build_object('name', '  ')
      )),
    jsonb_build_object('task_id', current_setting('t.broadband'), 'kind', 'done', 'summary', 'Three deals compared', 'body', 'The three cheapest for our speed.',
      'venues', jsonb_build_array(jsonb_build_object('name', 'Not a wedding job', 'url', 'https://example.com/x'))),
    jsonb_build_object('task_id', current_setting('t.hoover'), 'kind', 'done', 'summary', 'Hoovered', 'body', 'No it did not.')
  )),
  '{"asked": 0, "done": 2, "venues": 2}'::jsonb,
  'results are left on their jobs; venues only from the wedding job, without repeats');
select pg_temp.as_owner();
select is((select ai_result from tasks where id = current_setting('t.broadband')::uuid),
  '{"summary": "Three deals compared", "body": "The three cheapest for our speed.", "links": [], "day": "2026-11-13"}'::jsonb, 'a result is its summary, text, links and day');
select results_eq(
  $$select name, url, note, created_by::text from wedding_venues order by name$$,
  $$values ('Bad Link Barn', null, null, null), ('Priston Mill', 'https://example.com/priston', 'Watermill and barn, up to 150', null)$$,
  'venues come with a web link or none, and nobody as who added them');
select is((select count(*)::int from feed_events where entity_type = 'wedding_venue' and created_at >= now() - interval '1 minute'), 0, 'venues from Claude do not post to the feed one by one');
select results_eq(
  format($$select status, archived_at is null, (select count(*)::int from task_occurrences o where o.task_id = t.id and o.status = 'open') from tasks t where id = %L$$, current_setting('t.venues')),
  $$values ('active', true, 1)$$,
  'the job itself is left open: ticking it off stays with you');
select is((select ai_result from tasks where id = current_setting('t.hoover')::uuid), null, 'a repeating job never gets a result');

select pg_temp.as_service();
select is(
  agent_save_work(current_setting('t.hh')::uuid, '2026-11-14', jsonb_build_array(
    jsonb_build_object('task_id', current_setting('t.venues'), 'kind', 'ask', 'question', 'Anything else about the venues?')
  )) ->> 'asked', '0', 'no more questions once a job has its result');

-- Members -------------------------------------------------------------------
select pg_temp.as_user(current_setting('t.sophie')::uuid);
select is((select ai_result ->> 'summary' from tasks where id = current_setting('t.venues')::uuid), '2 venues near Bath added', 'both of you see what Claude did');
select pg_temp.as_owner();
delete from tasks where id = current_setting('t.venues')::uuid;
select is((select count(*)::int from tasks where id = current_setting('t.q')::uuid), 0, 'deleting a job takes its questions with it');

select * from finish();
rollback;
