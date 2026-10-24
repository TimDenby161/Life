-- =============================================================================
-- Tasks.
--
--   tasks                   the definition (title, list, assignee, rule...)
--   task_occurrences        each instance of work. One-off tasks have exactly
--                           one; recurring tasks get one per due date.
--   task_completion_events  append-only history of completed / skipped /
--                           reopened. Snapshots task metadata so history
--                           survives edits and deletion. Statistics are
--                           computed from this table.
--
-- Clients create/edit tasks directly (RLS + column grants). Completing,
-- skipping and reopening only happen through the RPCs below, which keep the
-- three tables consistent and make the history unforgeable.
-- =============================================================================

create table public.task_lists (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  kind text not null check (kind in ('joint', 'personal')),
  owner_id uuid,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (household_id, owner_id) references public.household_members (household_id, user_id),
  check ((kind = 'personal') = (owner_id is not null))
);

create unique index task_lists_one_joint_per_household on public.task_lists (household_id) where kind = 'joint';
create unique index task_lists_one_personal_per_owner on public.task_lists (household_id, owner_id) where kind = 'personal';

alter table public.user_preferences
  add constraint user_preferences_default_task_list_fk
  foreign key (default_task_list_id) references public.task_lists (id) on delete set null;

create table public.task_categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  color text not null default 'slate',
  created_at timestamptz not null default now(),
  unique (id, household_id)
);

create unique index task_categories_name_uniq on public.task_categories (household_id, lower(name));

-- -----------------------------------------------------------------------------
-- Recurrence rules (mirrored in src/modules/tasks/lib/recurrence.ts; keep the
-- two in sync and update the shared test vectors in both test suites).
--
--   { "freq": "daily" | "weekly" | "monthly" | "yearly",
--     "interval": 1..365,             -- every N periods (default 1)
--     "weekdays": [1..7],             -- weekly only, ISO (1 = Monday)
--     "monthDay": 1..31,              -- monthly only (clamped to month end)
--     "until": "YYYY-MM-DD" }         -- optional last possible date
--
-- The task's due_date is the series anchor.
-- -----------------------------------------------------------------------------
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
    if v_key not in ('freq', 'interval', 'weekdays', 'monthDay', 'until') then
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
  return true;
end;
$$;

-- First date of the series strictly after p_after (and never before the anchor).
-- Returns null when the series has ended.
create or replace function public.recurrence_next_date(p_rule jsonb, p_anchor date, p_after date)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_freq text := p_rule ->> 'freq';
  v_interval integer := coalesce((p_rule ->> 'interval')::integer, 1);
  v_until date := (p_rule ->> 'until')::date;
  v_start date := greatest(p_after + 1, p_anchor);
  v_candidate date;
  v_weekdays integer[];
  v_dom integer;
  v_step integer;
  v_months integer;
  v_month_start date;
  v_i integer;
begin
  if p_rule is null or p_anchor is null then
    return null;
  end if;

  if v_freq = 'daily' then
    v_candidate := p_anchor + (ceil((v_start - p_anchor)::numeric / v_interval)::integer * v_interval);

  elsif v_freq = 'weekly' then
    select array_agg(value::integer) into v_weekdays
    from jsonb_array_elements_text(coalesce(p_rule -> 'weekdays', '[]'::jsonb));
    v_weekdays := coalesce(v_weekdays, array[extract(isodow from p_anchor)::integer]);
    for v_i in 0 .. (7 * v_interval + 6) loop
      v_candidate := v_start + v_i;
      exit when extract(isodow from v_candidate)::integer = any (v_weekdays)
        and ((date_trunc('week', v_candidate)::date - date_trunc('week', p_anchor)::date) / 7) % v_interval = 0;
      v_candidate := null;
    end loop;

  elsif v_freq in ('monthly', 'yearly') then
    if v_freq = 'monthly' then
      v_dom := coalesce((p_rule ->> 'monthDay')::integer, extract(day from p_anchor)::integer);
      v_step := v_interval;
    else
      v_dom := extract(day from p_anchor)::integer;
      v_step := 12 * v_interval;
    end if;
    v_months := (extract(year from v_start)::integer - extract(year from p_anchor)::integer) * 12
              + (extract(month from v_start)::integer - extract(month from p_anchor)::integer);
    v_months := (ceil(v_months::numeric / v_step)::integer) * v_step;
    loop
      v_month_start := (date_trunc('month', p_anchor) + make_interval(months => v_months))::date;
      v_candidate := v_month_start + (least(
        v_dom,
        extract(day from (v_month_start + interval '1 month' - interval '1 day'))::integer
      ) - 1);
      exit when v_candidate >= v_start;
      v_months := v_months + v_step;
    end loop;
  else
    return null;
  end if;

  if v_until is not null and v_candidate > v_until then
    return null;
  end if;
  return v_candidate;
end;
$$;

grant execute on function public.is_valid_recurrence(jsonb) to authenticated;
grant execute on function public.recurrence_next_date(jsonb, date, date) to authenticated;

create or replace function public.household_today(p_household_id uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone coalesce((select h.timezone from public.households h where h.id = p_household_id), 'Europe/London'))::date;
$$;

-- -----------------------------------------------------------------------------
-- tasks
-- -----------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  list_id uuid not null,
  title text not null check (char_length(trim(title)) between 1 and 200),
  description text check (char_length(description) <= 5000),
  assignee_id uuid,
  category_id uuid,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'active' check (status in ('active', 'completed')),
  due_date date,
  due_time time,
  recurrence jsonb check (public.is_valid_recurrence(recurrence)),
  created_by uuid not null default auth.uid(),
  completed_at timestamptz,
  completed_by uuid,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (list_id, household_id) references public.task_lists (id, household_id) on delete cascade,
  foreign key (household_id, assignee_id) references public.household_members (household_id, user_id),
  foreign key (household_id, created_by) references public.household_members (household_id, user_id),
  foreign key (household_id, completed_by) references public.household_members (household_id, user_id),
  foreign key (category_id, household_id) references public.task_categories (id, household_id) on delete set null (category_id),
  check (recurrence is null or due_date is not null),
  check (due_time is null or due_date is not null),
  check ((status = 'completed') = (completed_at is not null)),
  check (recurrence is null or status = 'active')
);

create index tasks_household_list_idx on public.tasks (household_id, list_id);
create index tasks_assignee_idx on public.tasks (assignee_id);

create trigger tasks_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();

create table public.task_occurrences (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  task_id uuid not null,
  sequence integer not null default 1,
  due_date date,
  due_time time,
  assignee_id uuid,
  status text not null default 'open' check (status in ('open', 'done', 'skipped')),
  completed_at timestamptz,
  completed_by uuid,
  generated_from uuid references public.task_occurrences (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  unique (task_id, due_date),
  foreign key (task_id, household_id) references public.tasks (id, household_id) on delete cascade,
  foreign key (household_id, assignee_id) references public.household_members (household_id, user_id),
  foreign key (household_id, completed_by) references public.household_members (household_id, user_id),
  check ((status = 'done') = (completed_at is not null and completed_by is not null)),
  check (due_time is null or due_date is not null)
);

create index task_occurrences_household_status_due_idx on public.task_occurrences (household_id, status, due_date);
create index task_occurrences_task_idx on public.task_occurrences (task_id, status);

create trigger task_occurrences_updated_at before update on public.task_occurrences
  for each row execute function public.set_updated_at();

create table public.task_completion_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  -- Deliberately no FKs: history must survive deletion of the task.
  occurrence_id uuid not null,
  task_id uuid not null,
  event_type text not null check (event_type in ('completed', 'skipped', 'reopened')),
  completed_by uuid references public.profiles (id) on delete set null,
  recorded_by uuid references public.profiles (id) on delete set null,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  -- Snapshot of the task at the time of the event.
  task_title text not null,
  list_id uuid,
  category_id uuid,
  category_name text,
  assignee_id uuid,
  due_date date,
  is_recurring boolean not null,
  occurrence_sequence integer,
  occurrence_created_at timestamptz,
  note text check (char_length(note) <= 1000),
  check (event_type <> 'completed' or completed_by is not null)
);

create index task_completion_events_household_time_idx on public.task_completion_events (household_id, occurred_at desc);
create index task_completion_events_occurrence_idx on public.task_completion_events (occurrence_id, recorded_at desc);
create index task_completion_events_task_idx on public.task_completion_events (task_id);

create table public.task_subtasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  task_id uuid not null,
  title text not null check (char_length(trim(title)) between 1 and 200),
  is_done boolean not null default false,
  done_by uuid references public.profiles (id) on delete set null,
  done_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  foreign key (task_id, household_id) references public.tasks (id, household_id) on delete cascade
);

create index task_subtasks_task_idx on public.task_subtasks (task_id, sort_order);

create or replace function public.task_subtasks_track_done()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_done and (tg_op = 'INSERT' or not old.is_done) then
    new.done_by := auth.uid();
    new.done_at := now();
  elsif not new.is_done then
    new.done_by := null;
    new.done_at := null;
  end if;
  return new;
end;
$$;

create trigger task_subtasks_done before insert or update on public.task_subtasks
  for each row execute function public.task_subtasks_track_done();

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  task_id uuid not null,
  author_id uuid not null default auth.uid(),
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (task_id, household_id) references public.tasks (id, household_id) on delete cascade,
  foreign key (household_id, author_id) references public.household_members (household_id, user_id)
);

create index task_comments_task_idx on public.task_comments (task_id, created_at);

create trigger task_comments_updated_at before update on public.task_comments
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Occurrence generation
-- -----------------------------------------------------------------------------

-- Creates the next open occurrence of a recurring task strictly after p_after,
-- skipping dates that already have an occurrence. Returns its id (or null when
-- the series has ended / an open occurrence already exists).
create or replace function public.task_generate_next_occurrence(p_task_id uuid, p_after date, p_generated_from uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
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

  v_date := public.recurrence_next_date(v_task.recurrence, v_task.due_date, p_after);
  while v_date is not null
        and exists (select 1 from public.task_occurrences o where o.task_id = p_task_id and o.due_date = v_date) loop
    v_date := public.recurrence_next_date(v_task.recurrence, v_task.due_date, v_date);
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

create or replace function public.tasks_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.title := trim(new.title);
  -- Turning a completed one-off task into a recurring one restarts it.
  if new.recurrence is not null and new.status = 'completed' then
    new.status := 'active';
    new.completed_at := null;
    new.completed_by := null;
  end if;
  return new;
end;
$$;

create trigger tasks_before_write before insert or update on public.tasks
  for each row execute function public.tasks_before_write();

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

create trigger tasks_after_insert after insert on public.tasks
  for each row execute function public.tasks_after_insert();

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

create trigger tasks_after_update after update on public.tasks
  for each row execute function public.tasks_after_update();

-- -----------------------------------------------------------------------------
-- RPCs: complete / skip / reopen
-- -----------------------------------------------------------------------------
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
    household_id, occurrence_id, task_id, event_type, completed_by, recorded_by, occurred_at,
    task_title, list_id, category_id, category_name, assignee_id, due_date, is_recurring,
    occurrence_sequence, occurrence_created_at, note
  )
  values (
    p_occ.household_id, p_occ.id, p_task.id, p_event_type, p_completed_by, auth.uid(), p_occurred_at,
    p_task.title, p_task.list_id, p_task.category_id,
    (select c.name from public.task_categories c where c.id = p_task.category_id),
    p_occ.assignee_id, p_occ.due_date, p_task.recurrence is not null,
    p_occ.sequence, p_occ.created_at, nullif(trim(p_note), '')
  );
$$;

create or replace function public._task_lock_occurrence(p_occurrence_id uuid)
returns public.task_occurrences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_occ public.task_occurrences;
begin
  select * into v_occ from public.task_occurrences where id = p_occurrence_id for update;
  if not found or not public.is_household_member(v_occ.household_id) then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;
  return v_occ;
end;
$$;

create or replace function public.complete_task_occurrence(
  p_occurrence_id uuid,
  p_completed_by uuid default null,
  p_completed_at timestamptz default null,
  p_note text default null
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
begin
  v_occ := public._task_lock_occurrence(p_occurrence_id);
  if v_occ.status <> 'open' then
    raise exception 'This task is already %', v_occ.status using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.household_members m where m.household_id = v_occ.household_id and m.user_id = v_by) then
    raise exception 'Completed-by must be a household member' using errcode = '22023';
  end if;
  if v_at > now() + interval '5 minutes' then
    raise exception 'Completion time cannot be in the future' using errcode = '22023';
  end if;

  select * into v_task from public.tasks where id = v_occ.task_id for update;

  update public.task_occurrences
  set status = 'done', completed_at = v_at, completed_by = v_by
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
  perform public.log_feed_event(
    v_task.household_id, v_by, 'task.completed', 'task', v_task.id,
    coalesce(v_name, 'Someone') || ' completed “' || v_task.title || '”',
    jsonb_build_object('occurrence_id', v_occ.id, 'list_id', v_task.list_id, 'recorded_by', auth.uid())
  );
  return v_occ;
end;
$$;

create or replace function public.skip_task_occurrence(p_occurrence_id uuid, p_note text default null)
returns public.task_occurrences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_occ public.task_occurrences;
  v_task public.tasks;
begin
  v_occ := public._task_lock_occurrence(p_occurrence_id);
  select * into v_task from public.tasks where id = v_occ.task_id for update;
  if v_task.recurrence is null then
    raise exception 'Only recurring tasks can be skipped' using errcode = '22023';
  end if;
  if v_occ.status <> 'open' then
    raise exception 'This task is already %', v_occ.status using errcode = 'P0001';
  end if;

  update public.task_occurrences set status = 'skipped' where id = v_occ.id returning * into v_occ;
  perform public._task_record_event(v_occ, v_task, 'skipped', null, now(), p_note);
  perform public.task_generate_next_occurrence(
    v_task.id, greatest(v_occ.due_date, public.household_today(v_task.household_id) - 1), v_occ.id);
  return v_occ;
end;
$$;

create or replace function public.reopen_task_occurrence(p_occurrence_id uuid, p_note text default null)
returns public.task_occurrences
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_occ public.task_occurrences;
  v_task public.tasks;
begin
  v_occ := public._task_lock_occurrence(p_occurrence_id);
  if v_occ.status = 'open' then
    raise exception 'This task is not completed' using errcode = 'P0001';
  end if;
  select * into v_task from public.tasks where id = v_occ.task_id for update;

  -- Undo the follow-up occurrence generated by the completion, if untouched.
  delete from public.task_occurrences where generated_from = v_occ.id and status = 'open';

  update public.task_occurrences
  set status = 'open', completed_at = null, completed_by = null
  where id = v_occ.id
  returning * into v_occ;

  perform public._task_record_event(v_occ, v_task, 'reopened', null, now(), p_note);

  if v_task.recurrence is null then
    update public.tasks set status = 'active', completed_at = null, completed_by = null where id = v_task.id;
  end if;

  delete from public.feed_events
  where entity_id = v_task.id and event_type = 'task.completed'
    and metadata ->> 'occurrence_id' = v_occ.id::text;
  return v_occ;
end;
$$;

grant execute on function public.complete_task_occurrence(uuid, uuid, timestamptz, text) to authenticated;
grant execute on function public.skip_task_occurrence(uuid, text) to authenticated;
grant execute on function public.reopen_task_occurrence(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- RLS + grants
-- -----------------------------------------------------------------------------
alter table public.task_lists enable row level security;
alter table public.task_categories enable row level security;
alter table public.tasks enable row level security;
alter table public.task_occurrences enable row level security;
alter table public.task_completion_events enable row level security;
alter table public.task_subtasks enable row level security;
alter table public.task_comments enable row level security;

create policy "task_lists: members read" on public.task_lists
  for select to authenticated using (public.is_household_member(household_id));
create policy "task_lists: members update" on public.task_lists
  for update to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

create policy "task_categories: members all" on public.task_categories
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

create policy "tasks: members read" on public.tasks
  for select to authenticated using (public.is_household_member(household_id));
create policy "tasks: members create as self" on public.tasks
  for insert to authenticated
  with check (public.is_household_member(household_id) and created_by = (select auth.uid()));
create policy "tasks: members update" on public.tasks
  for update to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "tasks: members delete" on public.tasks
  for delete to authenticated using (public.is_household_member(household_id));

create policy "task_occurrences: members read" on public.task_occurrences
  for select to authenticated using (public.is_household_member(household_id));
create policy "task_occurrences: reschedule open" on public.task_occurrences
  for update to authenticated
  using (public.is_household_member(household_id) and status = 'open')
  with check (public.is_household_member(household_id) and status = 'open');

create policy "task_completion_events: members read" on public.task_completion_events
  for select to authenticated using (public.is_household_member(household_id));

create policy "task_subtasks: members all" on public.task_subtasks
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

create policy "task_comments: members read" on public.task_comments
  for select to authenticated using (public.is_household_member(household_id));
create policy "task_comments: create as self" on public.task_comments
  for insert to authenticated
  with check (public.is_household_member(household_id) and author_id = (select auth.uid()));
create policy "task_comments: author edits" on public.task_comments
  for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy "task_comments: author deletes" on public.task_comments
  for delete to authenticated using (author_id = (select auth.uid()));

grant select on public.task_lists to authenticated;
grant update (name, sort_order) on public.task_lists to authenticated;
grant select, insert, update, delete on public.task_categories to authenticated;
grant select, delete on public.tasks to authenticated;
grant insert (id, household_id, list_id, title, description, assignee_id, category_id, priority, due_date, due_time, recurrence)
  on public.tasks to authenticated;
grant update (list_id, title, description, assignee_id, category_id, priority, due_date, due_time, recurrence, archived_at)
  on public.tasks to authenticated;
grant select on public.task_occurrences to authenticated;
grant update (due_date, due_time, assignee_id) on public.task_occurrences to authenticated;
grant select on public.task_completion_events to authenticated;
grant select, delete on public.task_subtasks to authenticated;
grant insert (id, household_id, task_id, title, is_done, sort_order) on public.task_subtasks to authenticated;
grant update (title, is_done, sort_order) on public.task_subtasks to authenticated;
grant select, delete on public.task_comments to authenticated;
grant insert (id, household_id, task_id, body) on public.task_comments to authenticated;
grant update (body) on public.task_comments to authenticated;
