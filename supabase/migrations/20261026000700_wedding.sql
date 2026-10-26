-- =============================================================================
-- Wedding planning: budget, guests, checklist and suppliers.
--
-- wedding_settings.pot_goal_id names the savings pot item that pays for the
-- wedding. Whenever the budget has items, that item's target is kept equal to
-- the budget total (trigger below); with no budget it keeps whatever target
-- it had (a placeholder). Not in the realtime publication: the pot target it
-- changes (savings_goals) already syncs.
-- =============================================================================

create table public.wedding_settings (
  household_id uuid primary key references public.households (id) on delete cascade,
  wedding_date date,
  pot_goal_id uuid,
  updated_at timestamptz not null default now(),
  foreign key (pot_goal_id) references public.savings_goals (id) on delete set null
);

create table public.wedding_suppliers (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  role text not null check (char_length(trim(role)) between 1 and 60),
  name text not null check (char_length(trim(name)) between 1 and 120),
  contact_name text check (char_length(contact_name) <= 120),
  phone text check (char_length(phone) <= 40),
  email text check (char_length(email) <= 200),
  website text check (char_length(website) <= 300),
  notes text check (char_length(notes) <= 2000),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id)
);

create table public.wedding_budget_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  category text not null check (char_length(trim(category)) between 1 and 60),
  name text not null check (char_length(trim(name)) between 1 and 120),
  budget_minor bigint not null default 0 check (budget_minor >= 0),
  paid_minor bigint not null default 0 check (paid_minor >= 0),
  due_date date,
  supplier_id uuid,
  notes text check (char_length(notes) <= 2000),
  sort_order integer not null default 0,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (supplier_id, household_id) references public.wedding_suppliers (id, household_id) on delete set null (supplier_id)
);

create table public.wedding_guests (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  party text check (char_length(party) <= 60), -- e.g. "Tim's family", "Uni friends"
  invite text not null default 'day' check (invite in ('day', 'evening')),
  rsvp text not null default 'pending' check (rsvp in ('pending', 'yes', 'no')),
  plus_one boolean not null default false,
  dietary text check (char_length(dietary) <= 200),
  table_name text check (char_length(table_name) <= 60),
  notes text check (char_length(notes) <= 2000),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.wedding_tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 200),
  due_date date,
  assignee_id uuid,
  done_at timestamptz,
  notes text check (char_length(notes) <= 2000),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (household_id, assignee_id) references public.household_members (household_id, user_id)
);

create trigger wedding_settings_updated_at before update on public.wedding_settings for each row execute function public.set_updated_at();
create trigger wedding_suppliers_updated_at before update on public.wedding_suppliers for each row execute function public.set_updated_at();
create trigger wedding_budget_items_updated_at before update on public.wedding_budget_items for each row execute function public.set_updated_at();
create trigger wedding_guests_updated_at before update on public.wedding_guests for each row execute function public.set_updated_at();
create trigger wedding_tasks_updated_at before update on public.wedding_tasks for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Budget total -> wedding pot item target.
-- -----------------------------------------------------------------------------
create or replace function public.sync_wedding_pot_target(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_goal uuid;
  v_total bigint;
begin
  select pot_goal_id into v_goal from public.wedding_settings where household_id = p_household_id;
  if v_goal is null then
    return;
  end if;
  select coalesce(sum(budget_minor), 0) into v_total from public.wedding_budget_items where household_id = p_household_id;
  -- No budget yet (or all £0): the item keeps its placeholder target.
  if v_total > 0 then
    update public.savings_goals set target_minor = v_total
    where id = v_goal and household_id = p_household_id and target_minor <> v_total;
  end if;
end;
$$;

create or replace function public.wedding_budget_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.sync_wedding_pot_target(coalesce(new.household_id, old.household_id));
  return null;
end;
$$;

create trigger wedding_budget_items_sync_pot after insert or update of budget_minor or delete on public.wedding_budget_items
  for each row execute function public.wedding_budget_changed();
create trigger wedding_settings_sync_pot after insert or update of pot_goal_id on public.wedding_settings
  for each row execute function public.wedding_budget_changed();

-- The linked item must be in this household.
create or replace function public.check_wedding_pot_goal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.pot_goal_id is not null and not exists (
    select 1 from public.savings_goals g where g.id = new.pot_goal_id and g.household_id = new.household_id
  ) then
    raise exception 'The wedding pot item must belong to this household' using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger wedding_settings_check_goal before insert or update of pot_goal_id on public.wedding_settings
  for each row execute function public.check_wedding_pot_goal();

-- -----------------------------------------------------------------------------
-- RLS + grants.
-- -----------------------------------------------------------------------------
alter table public.wedding_settings enable row level security;
alter table public.wedding_suppliers enable row level security;
alter table public.wedding_budget_items enable row level security;
alter table public.wedding_guests enable row level security;
alter table public.wedding_tasks enable row level security;

create policy "wedding_settings: members all" on public.wedding_settings for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "wedding_suppliers: members all" on public.wedding_suppliers for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "wedding_budget_items: members all" on public.wedding_budget_items for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "wedding_guests: members all" on public.wedding_guests for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "wedding_tasks: members all" on public.wedding_tasks for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

grant select on public.wedding_settings to authenticated;
grant insert (household_id, wedding_date, pot_goal_id), update (wedding_date, pot_goal_id) on public.wedding_settings to authenticated;

grant select, delete on public.wedding_suppliers to authenticated;
grant insert (id, household_id, role, name, contact_name, phone, email, website, notes),
      update (role, name, contact_name, phone, email, website, notes) on public.wedding_suppliers to authenticated;

grant select, delete on public.wedding_budget_items to authenticated;
grant insert (id, household_id, category, name, budget_minor, paid_minor, due_date, supplier_id, notes, sort_order),
      update (category, name, budget_minor, paid_minor, due_date, supplier_id, notes, sort_order) on public.wedding_budget_items to authenticated;

grant select, delete on public.wedding_guests to authenticated;
grant insert (id, household_id, name, party, invite, rsvp, plus_one, dietary, table_name, notes),
      update (name, party, invite, rsvp, plus_one, dietary, table_name, notes) on public.wedding_guests to authenticated;

grant select, delete on public.wedding_tasks to authenticated;
grant insert (id, household_id, title, due_date, assignee_id, done_at, notes),
      update (title, due_date, assignee_id, done_at, notes) on public.wedding_tasks to authenticated;
