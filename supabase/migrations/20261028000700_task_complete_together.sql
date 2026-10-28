-- "We both did it" straight from the tick-off: complete_task_occurrence takes
-- the second person, so it is one "completed" event rather than a completion
-- followed by a "Changed who did it" correction.

drop function public.complete_task_occurrence(uuid, uuid, timestamptz, text);

create function public.complete_task_occurrence(
  p_occurrence_id uuid,
  p_completed_by uuid default null,
  p_completed_at timestamptz default null,
  p_note text default null,
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
  v_by uuid := coalesce(p_completed_by, auth.uid());
  v_at timestamptz := coalesce(p_completed_at, now());
  v_name text;
  v_also_name text;
begin
  v_occ := public._task_lock_occurrence(p_occurrence_id);
  if v_occ.status <> 'open' then
    raise exception 'This task is already %', v_occ.status using errcode = 'P0001';
  end if;
  if exists (
    select 1 from unnest(array[v_by, p_also_completed_by]) as p (id)
    where p.id is not null
      and not exists (select 1 from public.household_members m where m.household_id = v_occ.household_id and m.user_id = p.id)
  ) or v_by is null then
    raise exception 'Completed-by must be a household member' using errcode = '22023';
  end if;
  if p_also_completed_by = v_by then
    raise exception 'Pick two different people' using errcode = '22023';
  end if;
  if v_at > now() + interval '5 minutes' then
    raise exception 'Completion time cannot be in the future' using errcode = '22023';
  end if;

  select * into v_task from public.tasks where id = v_occ.task_id for update;

  update public.task_occurrences
  set status = 'done', completed_at = v_at, completed_by = v_by, also_completed_by = p_also_completed_by
  where id = v_occ.id
  returning * into v_occ;

  perform public._task_record_event(v_occ, v_task, 'completed', v_by, v_at, p_note);

  if v_task.recurrence is not null then
    perform public.task_generate_next_occurrence(
      v_task.id, greatest(v_occ.due_date, public.household_today(v_task.household_id) - 1), v_occ.id);
    update public.task_subtasks set is_done = false where task_id = v_task.id and is_done;
  else
    update public.tasks set status = 'completed', completed_at = v_at, completed_by = v_by where id = v_task.id;
  end if;

  select display_name into v_name from public.profiles where id = v_by;
  select display_name into v_also_name from public.profiles where id = p_also_completed_by;
  perform public.log_feed_event(
    v_task.household_id, v_by, 'task.completed', 'task', v_task.id,
    left(
      coalesce(v_name, 'Someone')
        || case when p_also_completed_by is not null then ' and ' || coalesce(v_also_name, 'someone') else '' end
        || ' completed “' || v_task.title || '”',
      300),
    jsonb_build_object('occurrence_id', v_occ.id, 'list_id', v_task.list_id, 'recorded_by', auth.uid())
  );
  return v_occ;
end;
$$;

grant execute on function public.complete_task_occurrence(uuid, uuid, timestamptz, text, uuid) to authenticated;
