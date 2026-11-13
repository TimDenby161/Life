-- =============================================================================
-- Goals (/goals) and goal-led daily tasks (Tim, 13 Nov 2026).
--
--   life_goals  what each of you (owner_id) or both of you together (owner_id
--               null) is aiming for in an area of life. Both of you can read
--               and edit every row. The morning routine plans each area's
--               tasks from these.
--
-- The daily ideas change from "one a day in every area" to "what each area
-- needs today": Claude decides, area by area, the tasks for Tim, for Sophie
-- and for both of you together. An area can have none on a quiet day, or
-- several when something is urgent. agent_save_ideas takes them all in one
-- call and keeps hard caps so the list never floods:
--   at most 3 new in one area for one of you (or Together) a day,
--   at most 6 new a day for each of you and for Together,
--   none for anyone who already has 15 of these still open.
-- Together tasks go on the Joint list, need both of you, and belong to nobody.
-- =============================================================================

create table public.life_goals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- Null = together.
  owner_id uuid,
  area text not null check (area in ('finance', 'wedding', 'meals', 'holidays', 'shopping', 'health', 'table_tennis', 'side_hustles', 'people', 'languages')),
  goal text not null check (char_length(trim(goal)) between 1 and 200),
  sort_order integer not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (household_id, owner_id) references public.household_members (household_id, user_id) on delete cascade
);

create index life_goals_household_idx on public.life_goals (household_id, area, sort_order);

create trigger life_goals_updated_at before update on public.life_goals
  for each row execute function public.set_updated_at();

alter table public.life_goals enable row level security;

create policy "life_goals: members all" on public.life_goals
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

grant select, delete on public.life_goals to authenticated;
grant insert (household_id, owner_id, area, goal, sort_order) on public.life_goals to authenticated;
grant update (owner_id, area, goal, sort_order) on public.life_goals to authenticated;

alter publication supabase_realtime add table public.life_goals;

-- The goals agreed with Tim on 13 Nov 2026, in a household with a Tim and a Sophie.
do $$
declare
  v_hh uuid;
  v_tim uuid;
  v_sophie uuid;
begin
  for v_hh, v_tim, v_sophie in
    select t.household_id, t.user_id, s.user_id
    from public.household_members t
    join public.profiles tp on tp.id = t.user_id and tp.display_name = 'Tim'
    join public.household_members s on s.household_id = t.household_id
    join public.profiles sp on sp.id = s.user_id and sp.display_name = 'Sophie'
  loop
    continue when exists (select 1 from public.life_goals where household_id = v_hh);
    insert into public.life_goals (household_id, owner_id, area, goal, sort_order, created_by)
    select v_hh, case who when 'tim' then v_tim when 'sophie' then v_sophie end, area, goal, ord, v_tim
    from (values
      ('tim', 'finance', '£350 a month into the wedding pot', 1),
      ('tim', 'finance', 'About £435 a month towards the honeymoon from 2027', 2),
      ('sophie', 'finance', '£350 a month into the wedding pot', 1),
      ('sophie', 'finance', 'About £435 a month towards the honeymoon from 2027', 2),
      ('together', 'finance', 'Wedding pot about £20k by July 2028', 1),
      ('together', 'finance', 'Honeymoon about £20k by October 2028', 2),
      ('tim', 'wedding', 'Plan the wedding', 1),
      ('sophie', 'wedding', 'Plan the wedding well', 1),
      ('together', 'wedding', 'Wedding around September 2028, budget about £20k', 1),
      ('tim', 'meals', 'Plan the week''s meals on Sundays', 1),
      ('tim', 'meals', 'No takeaways on my own', 2),
      ('sophie', 'meals', 'Plan meals', 1),
      ('together', 'meals', 'At most one takeaway a week together', 1),
      ('tim', 'holidays', 'Tim is the main holiday planner: research, bookings and admin are mostly his', 1),
      ('tim', 'holidays', 'Draft emails to cruise companies asking for discounts at the right time', 2),
      ('sophie', 'holidays', 'Only her own holiday admin (her passport, packing); Tim plans the holidays', 1),
      ('together', 'holidays', 'Central America (Guatemala) Feb/Mar 2027, China 2028, Antarctica honeymoon early 2029', 1),
      ('together', 'shopping', 'Buy the things on the shopping list before their deadlines', 1),
      ('tim', 'health', 'Under 87 kg by about mid-January (0.5 kg a week)', 1),
      ('tim', 'health', 'Padel 1-2 times a week plus a weekly run', 2),
      ('tim', 'health', '8 hours'' sleep, asleep by 23:30', 3),
      ('sophie', 'health', 'Fit and healthy: yoga 1-2 times a week plus a weekly run', 1),
      ('tim', 'table_tennis', 'Top 200 in the England ranking', 1),
      ('tim', 'table_tennis', 'At most 2 sessions a week', 2),
      ('tim', 'table_tennis', 'Tournaments: Graham Spicer 1* 15 Nov, County Championships 2-3 Jan, SBL 16 Jan', 3),
      ('tim', 'table_tennis', 'Find team sponsors', 4),
      ('tim', 'side_hustles', 'CornerFC: 10 paid users as soon as possible, then 50 within 12 months', 1),
      ('tim', 'people', 'Remember birthdays and keep up with friends', 1),
      ('sophie', 'people', 'Organise meet-ups and remember birthdays', 1),
      ('together', 'people', 'See joint friends', 1),
      ('tim', 'languages', 'Basic Spanish by Feb 2027 (Guatemala)', 1),
      ('tim', 'languages', 'Conversational Mandarin by 2028 (China)', 2),
      ('tim', 'languages', '15-30 minutes a day', 3),
      ('sophie', 'languages', 'Basic Spanish by Feb 2027 (Guatemala)', 1)
    ) as g(who, area, goal, ord);
  end loop;
end;
$$;

-- Claude's daily tasks aren't news either (Together ones are on the Joint list).
create or replace function public.tasks_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_assignee_name text;
begin
  if new.recurrence is null then
    insert into public.task_occurrences (household_id, task_id, due_date, due_time, assignee_id)
    values (new.household_id, new.id, new.due_date, new.due_time, new.assignee_id);
  else
    perform public.task_generate_next_occurrence(new.id, new.due_date - 1, null);
  end if;

  if new.ai_asks_task_id is not null or new.ai_area is not null then
    return null;
  end if;

  -- Keep the feed calm: a personal to-do someone adds for themselves is not news.
  if (select l.kind from public.task_lists l where l.id = new.list_id) = 'personal'
     and coalesce(new.assignee_id, new.created_by) = new.created_by then
    return null;
  end if;

  select display_name into v_name from public.profiles where id = new.created_by;
  select display_name into v_assignee_name from public.profiles where id = new.assignee_id;
  perform public.log_feed_event(
    new.household_id, new.created_by, 'task.created', 'task', new.id,
    coalesce(v_name, 'Someone') || ' added “' || new.title || '”'
      || case when new.assignee_id is not null and new.assignee_id <> new.created_by
              then ' for ' || coalesce(v_assignee_name, 'someone') else '' end,
    jsonb_build_object('list_id', new.list_id, 'recurring', new.recurrence is not null)
  );
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- The day's tasks for each area. p_items: [{"area", "for": <member id> |
-- "together", "title", "minutes"}]. Returns how many were added.
-- -----------------------------------------------------------------------------
drop function if exists public.agent_save_ideas(uuid, uuid, date, jsonb);

create or replace function public.agent_save_ideas(p_household_id uuid, p_day date, p_items jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_item jsonb;
  v_area text;
  v_for text;
  v_person uuid;
  v_title text;
  v_minutes integer;
  v_list uuid;
  v_category uuid;
  v_label text;
  v_names text[];
  v_by uuid;
  v_added integer := 0;
begin
  -- Together tasks need a member in created_by: the household's owner.
  select user_id into v_by from public.household_members
  where household_id = p_household_id order by (role = 'owner') desc, joined_at limit 1;
  if v_by is null then
    return 0;
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) limit 40 loop
    v_area := v_item ->> 'area';
    v_for := v_item ->> 'for';
    v_title := left(trim(regexp_replace(coalesce(v_item ->> 'title', ''), '\s+', ' ', 'g')), 80);
    v_minutes := least(45, greatest(5, coalesce((v_item ->> 'minutes')::integer, 15)));
    continue when char_length(v_title) < 3;

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

    if v_for = 'together' then
      v_person := null;
      -- An area either of you has chosen.
      continue when not exists (
        select 1 from public.user_preferences p join public.household_members m on m.user_id = p.user_id
        where m.household_id = p_household_id and v_area = any (p.idea_areas)
      );
      select id into v_list from public.task_lists where household_id = p_household_id and kind = 'joint' order by sort_order, created_at limit 1;
    else
      begin
        v_person := v_for::uuid;
      exception when others then
        continue;
      end;
      continue when not exists (select 1 from public.household_members where household_id = p_household_id and user_id = v_person);
      continue when not exists (select 1 from public.user_preferences p where p.user_id = v_person and v_area = any (p.idea_areas));
      select id into v_list from public.task_lists
      where household_id = p_household_id and kind = 'personal' and owner_id = v_person order by sort_order, created_at limit 1;
    end if;
    continue when v_list is null;

    -- Caps, per person (or Together): 3 in an area a day, 6 a day, none past 15 open.
    continue when (
      select count(*) from public.tasks t
      where t.household_id = p_household_id and t.ai_area is not null
        and t.assignee_id is not distinct from v_person and t.needs_both = (v_person is null)
        and (t.created_at at time zone 'Europe/London')::date = p_day and t.ai_area = v_area
    ) >= 3;
    continue when (
      select count(*) from public.tasks t
      where t.household_id = p_household_id and t.ai_area is not null
        and t.assignee_id is not distinct from v_person and t.needs_both = (v_person is null)
        and (t.created_at at time zone 'Europe/London')::date = p_day
    ) >= 6;
    continue when (
      select count(*) from public.tasks t
      where t.household_id = p_household_id and t.ai_area is not null
        and t.assignee_id is not distinct from v_person and t.needs_both = (v_person is null)
        and t.status = 'active' and t.archived_at is null
    ) >= 15;
    -- Never the same task twice while it's open.
    continue when exists (
      select 1 from public.tasks t
      where t.household_id = p_household_id and t.ai_area = v_area and t.status = 'active' and t.archived_at is null
        and t.assignee_id is not distinct from v_person and lower(t.title) = lower(v_title)
    );

    v_category := null;
    if v_area = 'wedding' then
      select task_category_id into v_category from public.wedding_settings where household_id = p_household_id;
    end if;
    if v_category is null then
      -- Someone's own category would make it theirs: Together only uses shared ones.
      select c.id into v_category from public.task_categories c
      where c.household_id = p_household_id and lower(trim(c.name)) = any (v_names)
        and (c.owner_id is null or (v_person is not null and c.owner_id = v_person))
      order by (c.owner_id is not distinct from v_person) desc, c.created_at
      limit 1;
    end if;
    if v_category is null and not exists (
      select 1 from public.task_categories c where c.household_id = p_household_id and lower(trim(c.name)) = lower(v_label)
    ) then
      insert into public.task_categories (household_id, name) values (p_household_id, v_label) returning id into v_category;
    end if;

    insert into public.tasks (household_id, list_id, title, category_id, assignee_id, needs_both, due_date, duration_minutes, created_by, ai_area)
    values (p_household_id, v_list, v_title, v_category, v_person, v_person is null, p_day, v_minutes, coalesce(v_person, v_by), v_area);
    v_added := v_added + 1;
  end loop;

  return v_added;
end;
$$;

revoke execute on function public.agent_save_ideas(uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.agent_save_ideas(uuid, date, jsonb) to service_role;
