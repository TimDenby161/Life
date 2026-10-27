-- =============================================================================
-- The wedding checklist is made of ordinary tasks, so everything on it is
-- also on the Tasks page. Checklist items are tasks in the household's Joint
-- list with the wedding's task category (wedding_settings.task_category_id,
-- a category named "Wedding"). Completion goes through the usual
-- complete/reopen RPCs, so it lands in task history and statistics.
--
-- Existing wedding_tasks rows are moved across (done ones completed by whoever
-- added them, at their done time), then the table is dropped.
-- =============================================================================

alter table public.wedding_settings
  add column task_category_id uuid,
  add foreign key (task_category_id, household_id) references public.task_categories (id, household_id)
    on delete set null (task_category_id);

grant insert (task_category_id), update (task_category_id) on public.wedding_settings to authenticated;

do $$
declare
  v_hh uuid;
  v_cat uuid;
  v_list uuid;
  v_task uuid;
  v_occ uuid;
  t public.wedding_tasks;
begin
  for v_hh in select distinct household_id from public.wedding_tasks loop
    select id into v_cat from public.task_categories where household_id = v_hh and name = 'Wedding' limit 1;
    if v_cat is null then
      insert into public.task_categories (household_id, name, color) values (v_hh, 'Wedding', 'rose') returning id into v_cat;
    end if;
    insert into public.wedding_settings (household_id, task_category_id) values (v_hh, v_cat)
      on conflict (household_id) do update set task_category_id = excluded.task_category_id;
  end loop;

  for t in select * from public.wedding_tasks order by created_at, id loop
    select task_category_id into v_cat from public.wedding_settings where household_id = t.household_id;
    select id into v_list from public.task_lists where household_id = t.household_id and kind = 'joint';
    insert into public.tasks (household_id, list_id, title, description, assignee_id, category_id, due_date, created_by)
    values (t.household_id, v_list, t.title, t.notes, t.assignee_id, v_cat, t.due_date, t.created_by)
    returning id into v_task;

    if t.done_at is not null then
      select id into v_occ from public.task_occurrences where task_id = v_task and status = 'open';
      -- The RPC checks membership against the caller, so act as the person who added it.
      perform set_config('request.jwt.claims', json_build_object('sub', t.created_by, 'role', 'authenticated')::text, true);
      perform public.complete_task_occurrence(v_occ, t.created_by, least(t.done_at, now()), null);
      perform set_config('request.jwt.claims', '', true);
    end if;
  end loop;
end;
$$;

drop table public.wedding_tasks;
