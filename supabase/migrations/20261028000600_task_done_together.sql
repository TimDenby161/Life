-- "We both did it": a completion can credit a second person, and statistics
-- give each of them a point. History stays append-only; the change is a new
-- "completed" event carrying both people.

alter table public.task_occurrences
  add column also_completed_by uuid,
  add foreign key (household_id, also_completed_by) references public.household_members (household_id, user_id),
  add check (also_completed_by is null or (status = 'done' and also_completed_by <> completed_by));

alter table public.task_completion_events
  add column also_completed_by uuid references public.profiles (id) on delete set null,
  add check (also_completed_by is null or (event_type = 'completed' and also_completed_by <> completed_by));

-- Reopening (or skipping) clears the second person along with the first.
create or replace function public.task_occurrences_clear_also_completed_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'done' then
    new.also_completed_by := null;
  end if;
  return new;
end;
$$;

create trigger task_occurrences_clear_also_completed_by before update of status on public.task_occurrences
  for each row execute function public.task_occurrences_clear_also_completed_by();

-- Same as before, plus the second person on completed events.
create or replace function public._task_record_event(
  p_occ public.task_occurrences,
  p_task public.tasks,
  p_event_type text,
  p_completed_by uuid,
  p_occurred_at timestamptz,
  p_note text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.task_completion_events (
    household_id, occurrence_id, task_id, event_type, completed_by, also_completed_by, recorded_by, occurred_at,
    task_title, list_id, category_id, category_name, assignee_id, due_date, is_recurring,
    occurrence_sequence, occurrence_created_at, note
  )
  values (
    p_occ.household_id, p_occ.id, p_task.id, p_event_type, p_completed_by,
    case when p_event_type = 'completed' then p_occ.also_completed_by end,
    auth.uid(), p_occurred_at,
    p_task.title, p_task.list_id, p_task.category_id,
    (select c.name from public.task_categories c where c.id = p_task.category_id),
    p_occ.assignee_id, p_occ.due_date, p_task.recurrence is not null,
    p_occ.sequence, p_occ.created_at, nullif(trim(p_note), '')
  );
$$;

-- Who did it: one person, or two with p_also_completed_by.
drop function public.set_task_occurrence_completed_by(uuid, uuid);

create function public.set_task_occurrence_completed_by(
  p_occurrence_id uuid,
  p_completed_by uuid,
  p_also_completed_by uuid default null
)
returns public.task_occurrences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_occ public.task_occurrences;
  v_task public.tasks;
  v_name text;
  v_also_name text;
begin
  v_occ := public._task_lock_occurrence(p_occurrence_id);
  if v_occ.status <> 'done' then
    raise exception 'This task is not completed' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from unnest(array[p_completed_by, p_also_completed_by]) as p (id)
    where p.id is not null
      and not exists (select 1 from public.household_members m where m.household_id = v_occ.household_id and m.user_id = p.id)
  ) or p_completed_by is null then
    raise exception 'Completed-by must be a household member' using errcode = '22023';
  end if;
  if p_also_completed_by = p_completed_by then
    raise exception 'Pick two different people' using errcode = '22023';
  end if;
  if v_occ.completed_by = p_completed_by and v_occ.also_completed_by is not distinct from p_also_completed_by then
    return v_occ;
  end if;

  select * into v_task from public.tasks where id = v_occ.task_id for update;

  update public.task_occurrences
  set completed_by = p_completed_by, also_completed_by = p_also_completed_by
  where id = v_occ.id
  returning * into v_occ;
  if v_task.recurrence is null then
    update public.tasks set completed_by = p_completed_by where id = v_task.id;
  end if;

  perform public._task_record_event(v_occ, v_task, 'completed', p_completed_by, v_occ.completed_at, 'Changed who did it');

  select display_name into v_name from public.profiles where id = p_completed_by;
  select display_name into v_also_name from public.profiles where id = p_also_completed_by;
  update public.feed_events
  set actor_id = p_completed_by,
      summary = left(
        coalesce(v_name, 'Someone')
          || case when p_also_completed_by is not null then ' and ' || coalesce(v_also_name, 'someone') else '' end
          || ' completed “' || v_task.title || '”',
        300)
  where entity_id = v_task.id and event_type = 'task.completed'
    and metadata ->> 'occurrence_id' = v_occ.id::text;
  return v_occ;
end;
$$;

grant execute on function public.set_task_occurrence_completed_by(uuid, uuid, uuid) to authenticated;
