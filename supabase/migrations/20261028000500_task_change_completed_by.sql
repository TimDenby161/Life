-- Change who did a completed task. History stays append-only: the change is a
-- new "completed" event (same completion time, new person), and statistics
-- already take each occurrence's latest event.
create or replace function public.set_task_occurrence_completed_by(p_occurrence_id uuid, p_completed_by uuid)
returns public.task_occurrences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_occ public.task_occurrences;
  v_task public.tasks;
  v_name text;
begin
  v_occ := public._task_lock_occurrence(p_occurrence_id);
  if v_occ.status <> 'done' then
    raise exception 'This task is not completed' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.household_members m where m.household_id = v_occ.household_id and m.user_id = p_completed_by) then
    raise exception 'Completed-by must be a household member' using errcode = '22023';
  end if;
  if v_occ.completed_by = p_completed_by then
    return v_occ;
  end if;

  select * into v_task from public.tasks where id = v_occ.task_id for update;

  update public.task_occurrences set completed_by = p_completed_by where id = v_occ.id returning * into v_occ;
  if v_task.recurrence is null then
    update public.tasks set completed_by = p_completed_by where id = v_task.id;
  end if;

  perform public._task_record_event(v_occ, v_task, 'completed', p_completed_by, v_occ.completed_at, 'Changed who did it');

  select display_name into v_name from public.profiles where id = p_completed_by;
  update public.feed_events
  set actor_id = p_completed_by,
      summary = left(coalesce(v_name, 'Someone') || ' completed “' || v_task.title || '”', 300)
  where entity_id = v_task.id and event_type = 'task.completed'
    and metadata ->> 'occurrence_id' = v_occ.id::text;
  return v_occ;
end;
$$;

grant execute on function public.set_task_occurrence_completed_by(uuid, uuid) to authenticated;
