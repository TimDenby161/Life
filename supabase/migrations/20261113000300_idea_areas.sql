-- =============================================================================
-- Daily ideas for everyone, in the areas each person wants: Sophie gets her own
-- too (Tim, 13 Nov 2026), whether or not AI picks is on, in every area but
-- table tennis and side hustles.
--
--   user_preferences.idea_areas  the areas a person gets a daily idea in; all
--                                ten by default, switched in Settings. Empty =
--                                no ideas. Owner-only like the rest of the row.
--
-- agent_save_ideas now also skips an area the person hasn't chosen.
-- =============================================================================

alter table public.user_preferences
  add column idea_areas text[] not null
    default array['finance', 'wedding', 'meals', 'holidays', 'shopping', 'health', 'table_tennis', 'side_hustles', 'people', 'languages']
    check (idea_areas <@ array['finance', 'wedding', 'meals', 'holidays', 'shopping', 'health', 'table_tennis', 'side_hustles', 'people', 'languages']);

update public.user_preferences
  set idea_areas = array['finance', 'wedding', 'meals', 'holidays', 'shopping', 'health', 'people', 'languages']
  where user_id in (select id from public.profiles where display_name = 'Sophie');

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
    -- Only the areas this person wants ideas in.
    continue when not exists (
      select 1 from public.user_preferences p where p.user_id = p_person and v_area = any (p.idea_areas)
    );

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

-- (Execute stays with the service role only, as granted in 20261113000200.)
