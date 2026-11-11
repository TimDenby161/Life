-- =============================================================================
-- Side hustles (/hustles): CornerFC, The Corner TT, travel planning, the Life
-- app. Money stays in Tim's "The Corner" Google Sheet (CashFlow tab: outgoings
-- in A-D, income in F-I, each Date / Project / Desc / Amount); the side-hustles
-- function reads it and adds rows to it. The app keeps only:
--
--   hustle_settings   which spreadsheet and tab (one per person).
--   hustles           side hustles beyond the sheet's own Project names, and
--                     the task category whose open tasks show as its upcoming
--                     jobs. name matches the sheet's Project column.
--   hustle_charges    regular charges (or income), each with a monthly task;
--                     adding it from the app writes the row to the sheet and
--                     ticks the task off.
--
-- Owned by one person: both members read, the owner writes.
-- =============================================================================

create table public.hustle_settings (
  user_id uuid primary key default auth.uid(),
  household_id uuid not null,
  spreadsheet_id text not null check (spreadsheet_id ~ '^[A-Za-z0-9_-]{20,100}$'),
  sheet_name text not null default 'CashFlow' check (char_length(trim(sheet_name)) between 1 and 100),
  updated_at timestamptz not null default now(),
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade
);

create trigger hustle_settings_updated_at before update on public.hustle_settings
  for each row execute function public.set_updated_at();

create table public.hustles (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  user_id uuid not null default auth.uid(),
  name text not null check (char_length(trim(name)) between 1 and 60),
  category_id uuid,
  created_at timestamptz not null default now(),
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade,
  foreign key (category_id, household_id) references public.task_categories (id, household_id) on delete set null (category_id),
  unique (id, household_id),
  unique (user_id, name)
);

create table public.hustle_charges (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  user_id uuid not null default auth.uid(),
  hustle_id uuid not null,
  kind text not null default 'out' check (kind in ('out', 'in')),
  description text not null check (char_length(trim(description)) between 1 and 80),
  usual_minor bigint not null check (usual_minor between 0 and 100000000),
  task_id uuid,
  created_at timestamptz not null default now(),
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade,
  foreign key (hustle_id, household_id) references public.hustles (id, household_id) on delete cascade,
  foreign key (task_id, household_id) references public.tasks (id, household_id) on delete set null (task_id)
);

alter table public.hustle_settings enable row level security;
alter table public.hustles enable row level security;
alter table public.hustle_charges enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['hustle_settings', 'hustles', 'hustle_charges'] loop
    execute format('create policy "%1$s: household read" on public.%1$I for select to authenticated using (public.is_household_member(household_id))', t);
    execute format('create policy "%1$s: owner insert" on public.%1$I for insert to authenticated with check (user_id = (select auth.uid()) and public.is_household_member(household_id))', t);
    execute format('create policy "%1$s: owner update" on public.%1$I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('create policy "%1$s: owner delete" on public.%1$I for delete to authenticated using (user_id = (select auth.uid()))', t);
  end loop;
end;
$$;

grant select, delete on public.hustle_settings to authenticated;
grant insert (household_id, spreadsheet_id, sheet_name) on public.hustle_settings to authenticated;
grant update (spreadsheet_id, sheet_name) on public.hustle_settings to authenticated;

grant select, delete on public.hustles to authenticated;
grant insert (household_id, name, category_id) on public.hustles to authenticated;
grant update (name, category_id) on public.hustles to authenticated;

grant select, delete on public.hustle_charges to authenticated;
grant insert (household_id, hustle_id, kind, description, usual_minor, task_id) on public.hustle_charges to authenticated;
grant update (kind, description, usual_minor, task_id) on public.hustle_charges to authenticated;

alter publication supabase_realtime add table public.hustle_settings;
alter publication supabase_realtime add table public.hustles;
alter publication supabase_realtime add table public.hustle_charges;
