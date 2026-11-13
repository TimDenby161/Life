-- =============================================================================
-- Daily ideas: each morning the Claude routine adds one small task in each area
-- of life (finance, wedding, meals, holidays, shopping, health, table tennis,
-- side hustles, people, languages) for each person with AI picks on, straight
-- onto their own list for today. Tim asked for these to be added rather than
-- suggested (13 Nov 2026); they are ordinary tasks you tick off or delete.
--
--   tasks.ai_area  which area an idea is for (null for every other task). Not
--                  client-writable: only agent_save_ideas sets it.
--
-- agent_save_ideas (service role only) adds them: on the person's own list,
-- for them, due that day, under the area's category (the wedding's checklist
-- category for the wedding; otherwise one named for the area that isn't the
-- other person's, made if there's none; with none it can use, no category). An area gets no new idea while one of
-- theirs there is still open, so they never pile up. Personal-list tasks post
-- nothing to the feed.
-- =============================================================================

alter table public.tasks
  add column ai_area text check (ai_area is null or ai_area in (
    'finance', 'wedding', 'meals', 'holidays', 'shopping', 'health', 'table_tennis', 'side_hustles', 'people', 'languages'
  ));

create index tasks_ai_area_idx on public.tasks (household_id, assignee_id, ai_area) where ai_area is not null;

create or replace function public.agent_save_ideas(p_household_id uuid, p_person uuid, p_day date, p_items jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_item jsonb;
  v_area text;
  v_title text;
  v_minutes integer;
  v_list uuid;
  v_category uuid;
  v_label text;
  v_names text[];
  v_added integer := 0;
begin
  if not exists (select 1 from public.household_members where household_id = p_household_id and user_id = p_person) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  select id into v_list from public.task_lists
  where household_id = p_household_id and kind = 'personal' and owner_id = p_person
  order by sort_order, created_at limit 1;
  if v_list is null then
    return 0;
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) limit 10 loop
    v_area := v_item ->> 'area';
    v_title := left(trim(regexp_replace(coalesce(v_item ->> 'title', ''), '\s+', ' ', 'g')), 80);
    v_minutes := least(45, greatest(5, coalesce((v_item ->> 'minutes')::integer, 15)));
    continue when char_length(v_title) < 3;

    -- The area's label and the category names it goes under (as AREAS in _shared/agents/ideas.ts).
    select a.label, a.names into v_label, v_names from (values
      ('finance', 'Finance', array['finance', 'finances', 'money']),
      ('wedding', 'Wedding', array['wedding']),
      ('meals', 'Meals', array['meals', 'cooking']),
      ('holidays', 'Holidays', array['holidays', 'travel']),
      ('shopping', 'Shopping', array['shopping']),
      ('health', 'Health', array['health', 'fitness']),
      ('table_tennis', 'Table tennis', array['table tennis']),
      ('side_hustles', 'Side hustles', array['side hustles', 'side projects']),
      ('people', 'People', array['people', 'friends', 'social']),
      ('languages', 'Languages', array['languages'])
    ) as a(key, label, names) where a.key = v_area;
    continue when v_label is null;

    -- One open idea an area for each person.
    continue when exists (
      select 1 from public.tasks t
      where t.household_id = p_household_id and t.assignee_id = p_person and t.ai_area = v_area
        and t.status = 'active' and t.archived_at is null
    );

    v_category := null;
    if v_area = 'wedding' then
      select task_category_id into v_category from public.wedding_settings where household_id = p_household_id;
    end if;
    if v_category is null then
      select c.id into v_category from public.task_categories c
      where c.household_id = p_household_id and lower(trim(c.name)) = any (v_names)
        and (c.owner_id is null or c.owner_id = p_person)
      order by (c.owner_id = p_person) desc nulls last, c.created_at
      limit 1;
    end if;
    -- None yet: make one, unless the name is taken by the other person's own
    -- category (theirs would make it their task), when it goes without one.
    if v_category is null and not exists (
      select 1 from public.task_categories c where c.household_id = p_household_id and lower(trim(c.name)) = lower(v_label)
    ) then
      insert into public.task_categories (household_id, name) values (p_household_id, v_label) returning id into v_category;
    end if;

    insert into public.tasks (household_id, list_id, title, category_id, assignee_id, due_date, duration_minutes, created_by, ai_area)
    values (p_household_id, v_list, v_title, v_category, p_person, p_day, v_minutes, p_person, v_area);
    v_added := v_added + 1;
  end loop;

  return v_added;
end;
$$;

revoke execute on function public.agent_save_ideas(uuid, uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.agent_save_ideas(uuid, uuid, date, jsonb) to service_role;
