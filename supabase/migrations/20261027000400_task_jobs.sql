-- =============================================================================
-- Jobs: repeating tasks that come back a set time after they were last done
-- (change the sheets every 2 weeks, run the dishwasher every week) rather than
-- on fixed dates.
--
-- A job is a recurring task whose rule has "afterDone": true. The next
-- occurrence is due one interval after the job was last done, where "last
-- done" is the later of:
--   * the most recent completed occurrence (in household local time), and
--   * tasks.last_done_on, a date the household sets by hand ("we last changed
--     the sheets on Sunday") for work done before or outside the app.
-- Skipping a job restarts the clock from today.
--
-- recurrence_next_date is unchanged: re-anchoring the series at the last-done
-- date and asking for the next date after it gives exactly one interval later.
-- =============================================================================

alter table public.tasks add column last_done_on date;

grant insert (last_done_on), update (last_done_on) on public.tasks to authenticated;

create or replace function public.is_valid_recurrence(p_rule jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_day jsonb;
begin
  if p_rule is null then
    return true;
  end if;
  if jsonb_typeof(p_rule) <> 'object' then
    return false;
  end if;
  for v_key in select jsonb_object_keys(p_rule) loop
    if v_key not in ('freq', 'interval', 'weekdays', 'monthDay', 'until', 'afterDone') then
      return false;
    end if;
  end loop;
  if coalesce(p_rule ->> 'freq', '') not in ('daily', 'weekly', 'monthly', 'yearly') then
    return false;
  end if;
  if p_rule ? 'interval' and (
    jsonb_typeof(p_rule -> 'interval') <> 'number'
    or (p_rule ->> 'interval')::numeric <> trunc((p_rule ->> 'interval')::numeric)
    or (p_rule ->> 'interval')::numeric not between 1 and 365
  ) then
    return false;
  end if;
  if p_rule ? 'weekdays' then
    if p_rule ->> 'freq' <> 'weekly' or jsonb_typeof(p_rule -> 'weekdays') <> 'array'
       or jsonb_array_length(p_rule -> 'weekdays') = 0 then
      return false;
    end if;
    for v_day in select jsonb_array_elements(p_rule -> 'weekdays') loop
      if jsonb_typeof(v_day) <> 'number' or v_day::text not in ('1', '2', '3', '4', '5', '6', '7') then
        return false;
      end if;
    end loop;
  end if;
  if p_rule ? 'monthDay' and (
    p_rule ->> 'freq' <> 'monthly'
    or jsonb_typeof(p_rule -> 'monthDay') <> 'number'
    or (p_rule -> 'monthDay')::text !~ '^([1-9]|[12][0-9]|3[01])$'
  ) then
    return false;
  end if;
  if p_rule ? 'until' then
    if jsonb_typeof(p_rule -> 'until') <> 'string' or (p_rule ->> 'until') !~ '^\d{4}-\d{2}-\d{2}$' then
      return false;
    end if;
    begin
      perform (p_rule ->> 'until')::date;
    exception when others then
      return false;
    end;
  end if;
  -- Jobs repeat a plain interval after the last time; fixed days don't apply.
  if p_rule ? 'afterDone' and (
    p_rule -> 'afterDone' <> 'true'::jsonb or p_rule ? 'weekdays' or p_rule ? 'monthDay'
  ) then
    return false;
  end if;
  return true;
end;
$$;

-- The date a job was last done: latest completion (local date) or the
-- hand-set last_done_on, whichever is later. Null when never done.
create or replace function public.task_last_done_on(p_task_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    t.last_done_on,
    (select max((o.completed_at at time zone coalesce(h.timezone, 'Europe/London'))::date)
     from public.task_occurrences o
     where o.task_id = t.id and o.status = 'done')
  )
  from public.tasks t
  join public.households h on h.id = t.household_id
  where t.id = p_task_id;
$$;

create or replace function public.task_generate_next_occurrence(p_task_id uuid, p_after date, p_generated_from uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_anchor date;
  v_after date;
  v_date date;
  v_seq integer;
  v_id uuid;
begin
  select * into v_task from public.tasks where id = p_task_id;
  if not found or v_task.recurrence is null or v_task.archived_at is not null then
    return null;
  end if;
  if exists (select 1 from public.task_occurrences o where o.task_id = p_task_id and o.status = 'open') then
    return null;
  end if;

  v_anchor := v_task.due_date;
  v_after := p_after;
  if v_task.recurrence ? 'afterDone' then
    v_anchor := public.task_last_done_on(p_task_id);
    if p_generated_from is not null
       and (select o.status from public.task_occurrences o where o.id = p_generated_from) = 'skipped' then
      v_anchor := greatest(v_anchor, public.household_today(v_task.household_id));
    end if;
    if v_anchor is null then
      -- Never done: due from the start date.
      v_anchor := v_task.due_date;
    else
      -- Due one interval after the last time, even if that's already past.
      v_after := v_anchor;
    end if;
  end if;

  v_date := public.recurrence_next_date(v_task.recurrence, v_anchor, v_after);
  while v_date is not null
        and exists (select 1 from public.task_occurrences o where o.task_id = p_task_id and o.due_date = v_date) loop
    v_date := public.recurrence_next_date(v_task.recurrence, v_anchor, v_date);
  end loop;
  if v_date is null then
    return null;
  end if;

  select coalesce(max(sequence), 0) + 1 into v_seq from public.task_occurrences where task_id = p_task_id;

  insert into public.task_occurrences (household_id, task_id, sequence, due_date, due_time, assignee_id, generated_from)
  values (v_task.household_id, v_task.id, v_seq, v_date, v_task.due_time, v_task.assignee_id, p_generated_from)
  returning id into v_id;
  return v_id;
end;
$$;

-- Same as before, plus: changing a job's last-done date reschedules it.
create or replace function public.tasks_after_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := public.household_today(new.household_id);
begin
  if new.archived_at is not null then
    return null;
  end if;

  if new.recurrence is distinct from old.recurrence
     or (new.recurrence is not null and new.due_date is distinct from old.due_date)
     or (new.recurrence is not null and new.last_done_on is distinct from old.last_done_on)
     or (old.archived_at is not null) then
    -- Schedule changed (or task restored): rebuild pending work. Completed and
    -- skipped occurrences are history and are never touched.
    delete from public.task_occurrences where task_id = new.id and status = 'open';
    if new.recurrence is not null then
      perform public.task_generate_next_occurrence(new.id, greatest(new.due_date, v_today) - 1, null);
    elsif new.status = 'active' then
      insert into public.task_occurrences (household_id, task_id, sequence, due_date, due_time, assignee_id)
      select new.household_id, new.id, coalesce(max(sequence), 0) + 1, new.due_date, new.due_time, new.assignee_id
      from public.task_occurrences where task_id = new.id;
    end if;
    return null;
  end if;

  if new.due_date is distinct from old.due_date
     or new.due_time is distinct from old.due_time
     or new.assignee_id is distinct from old.assignee_id then
    update public.task_occurrences
    set due_date = case when new.recurrence is null then new.due_date else due_date end,
        due_time = new.due_time,
        assignee_id = new.assignee_id
    where task_id = new.id and status = 'open';
  end if;
  return null;
end;
$$;
