-- Jobs: recurring tasks that come back a set time after they were last done.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

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
select set_config('t.today', public.household_today(current_setting('t.hh')::uuid)::text, true);

create function pg_temp.open_due(p_task text) returns date language sql as $$
  select due_date from task_occurrences where task_id = p_task::uuid and status = 'open'
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- Rule validation -------------------------------------------------------------
select ok(public.is_valid_recurrence('{"freq":"weekly","interval":2,"afterDone":true}'), 'job rule accepted');
select ok(not public.is_valid_recurrence('{"freq":"weekly","weekdays":[1],"afterDone":true}'), 'jobs cannot have fixed weekdays');
select ok(not public.is_valid_recurrence('{"freq":"monthly","afterDone":false}'), 'afterDone must be true when present');

-- A weekly job last done 10 days ago is already 3 days overdue ------------------
select pg_temp.as_user(current_setting('t.tim')::uuid);
with t as (
  insert into tasks (household_id, list_id, title, due_date, recurrence, last_done_on)
  values (current_setting('t.hh')::uuid, current_setting('t.joint')::uuid, 'Dishwasher',
          current_setting('t.today')::date, '{"freq":"weekly","afterDone":true}', current_setting('t.today')::date - 10)
  returning id
)
select set_config('t.job', id::text, true) from t;

select is(pg_temp.open_due(current_setting('t.job')), current_setting('t.today')::date - 3,
  'due one interval after the hand-set last-done date, even if that is past');

-- Doing it today brings it back a week from today -------------------------------
select set_config('t.occ', (select id::text from task_occurrences where task_id = current_setting('t.job')::uuid and status = 'open'), true);
select lives_ok(format('select complete_task_occurrence(%L)', current_setting('t.occ')), 'Tim completes the job');
select is(pg_temp.open_due(current_setting('t.job')), current_setting('t.today')::date + 7, 'next one is due a week after it was done');
select is((select generated_from from task_occurrences where task_id = current_setting('t.job')::uuid and status = 'open'),
  current_setting('t.occ')::uuid, 'next occurrence is linked to the completion');
select is(public.task_last_done_on(current_setting('t.job')::uuid), current_setting('t.today')::date, 'last done is today');

-- Undo puts it back as it was --------------------------------------------------
select lives_ok(format('select reopen_task_occurrence(%L)', current_setting('t.occ')), 'Tim undoes the completion');
select is(pg_temp.open_due(current_setting('t.job')), current_setting('t.today')::date - 3, 'reopened: overdue again');

-- Sophie corrects the last-done date by hand ------------------------------------
select pg_temp.as_user(current_setting('t.sophie')::uuid);
update tasks set last_done_on = current_setting('t.today')::date - 1 where id = current_setting('t.job')::uuid;
select is(pg_temp.open_due(current_setting('t.job')), current_setting('t.today')::date + 6, 'changing last done reschedules the job');

-- A job never done is due from its start; skipping restarts the clock ----------
with t as (
  insert into tasks (household_id, list_id, title, due_date, recurrence)
  values (current_setting('t.hh')::uuid, current_setting('t.joint')::uuid, 'Change the sheets',
          current_setting('t.today')::date, '{"freq":"weekly","interval":2,"afterDone":true}')
  returning id
)
select set_config('t.sheets', id::text, true) from t;
select is(pg_temp.open_due(current_setting('t.sheets')), current_setting('t.today')::date, 'never-done job is due on its start date');
select skip_task_occurrence((select id from task_occurrences where task_id = current_setting('t.sheets')::uuid and status = 'open'));
select is(pg_temp.open_due(current_setting('t.sheets')), current_setting('t.today')::date + 14, 'skipping brings it back one interval from today');

-- Outsiders can't touch it -----------------------------------------------------
select pg_temp.as_user(current_setting('t.out')::uuid);
update tasks set last_done_on = current_setting('t.today')::date where id = current_setting('t.job')::uuid;
select pg_temp.as_user(current_setting('t.tim')::uuid);
select is(pg_temp.open_due(current_setting('t.job')), current_setting('t.today')::date + 6, 'outsider cannot change the last-done date');

select * from finish();
rollback;
