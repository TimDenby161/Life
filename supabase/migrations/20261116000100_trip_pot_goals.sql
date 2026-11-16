-- =============================================================================
-- Holidays and the wedding drive their savings pot items.
--
-- trips.pot_goal_id names the pot item (savings_goals) a holiday is saved in,
-- the same way wedding_settings.pot_goal_id does for the wedding. A linked
-- item's amount and date always come from what it's for, so "Saving a month"
-- on Finance moves when the plan does:
--   holiday  amount = cost - paid so far (what's still to pay, never below 0),
--            due    = the day before it starts.
--   wedding  amount = the budget total (unchanged: payments don't change it),
--            due    = the day before the wedding (the 1st of the month when
--                     only the month is known), once a date is set.
-- The trips/wedding triggers push changes onto the item, and a guard on
-- savings_goals puts them back if the item itself is edited, so the two can't
-- drift apart. A fully paid holiday's item is £0 (funded), so targets may now
-- be 0.
-- =============================================================================

alter table public.trips
  add column pot_goal_id uuid references public.savings_goals (id) on delete set null;

create unique index trips_pot_goal_idx on public.trips (pot_goal_id) where pot_goal_id is not null;

grant insert (pot_goal_id), update (pot_goal_id) on public.trips to authenticated;

alter table public.savings_goals drop constraint savings_goals_target_minor_check;
alter table public.savings_goals add constraint savings_goals_target_minor_check check (target_minor >= 0);

-- The linked item must be in the trip's household.
create or replace function public.check_trip_pot_goal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.pot_goal_id is not null and not exists (
    select 1 from public.savings_goals g where g.id = new.pot_goal_id and g.household_id = new.household_id
  ) then
    raise exception 'The holiday''s pot item must belong to this household' using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger trips_check_goal before insert or update of pot_goal_id, household_id on public.trips
  for each row execute function public.check_trip_pot_goal();

-- -----------------------------------------------------------------------------
-- What a linked item's amount and date should be; nulls when it isn't linked
-- (or the wedding has no budget yet, when it keeps its placeholder).
-- -----------------------------------------------------------------------------
create or replace function public.linked_goal_target(p_goal uuid, out target bigint, out due date)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  select greatest(t.cost_minor - t.paid_minor, 0), t.starts_on - 1 into target, due
  from public.trips t
  where t.pot_goal_id = p_goal and t.cost_minor is not null;
  if found then
    return;
  end if;

  select sum(b.budget_minor), s.wedding_date - 1 into target, due
  from public.wedding_settings s
  join public.wedding_budget_items b on b.household_id = s.household_id
  where s.pot_goal_id = p_goal
  group by s.household_id, s.wedding_date
  having sum(b.budget_minor) > 0;
  if not found then
    -- No budget yet: a wedding date alone still sets the due date.
    select null, s.wedding_date - 1 into target, due from public.wedding_settings s where s.pot_goal_id = p_goal;
  end if;
end;
$$;

revoke all on function public.linked_goal_target(uuid) from public, anon, authenticated;

-- Writes the linked values onto the item (the guard below does the work).
create or replace function public.sync_linked_goal(p_goal uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if p_goal is null then
    return;
  end if;
  select * into r from public.linked_goal_target(p_goal);
  update public.savings_goals
    set target_minor = coalesce(r.target, target_minor), target_date = coalesce(r.due, target_date)
    where id = p_goal
      and (target_minor, target_date) is distinct from (coalesce(r.target, target_minor), coalesce(r.due, target_date));
end;
$$;

revoke all on function public.sync_linked_goal(uuid) from public, anon, authenticated;

-- A linked item can't be edited away from what it's for.
create or replace function public.keep_linked_goal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  select * into r from public.linked_goal_target(new.id);
  new.target_minor := coalesce(r.target, new.target_minor);
  new.target_date := coalesce(r.due, new.target_date);
  return new;
end;
$$;

create trigger savings_goals_keep_linked before update of target_minor, target_date on public.savings_goals
  for each row execute function public.keep_linked_goal();

-- Holidays ----------------------------------------------------------------------------------
create or replace function public.trip_goal_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.sync_linked_goal(new.pot_goal_id);
  return null;
end;
$$;

create trigger trips_sync_goal after insert or update of cost_minor, paid_minor, starts_on, pot_goal_id on public.trips
  for each row execute function public.trip_goal_changed();

-- Wedding: the old target-only sync becomes the shared one, and the date counts too.
create or replace function public.sync_wedding_pot_target(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.sync_linked_goal((select pot_goal_id from public.wedding_settings where household_id = p_household_id));
end;
$$;

drop trigger wedding_settings_sync_pot on public.wedding_settings;
create trigger wedding_settings_sync_pot after insert or update of pot_goal_id, wedding_date on public.wedding_settings
  for each row execute function public.wedding_budget_changed();

-- -----------------------------------------------------------------------------
-- Link the holidays already saved for: a pot item with the trip's name, and the
-- honeymoon (Patagonia + Antarctica) to the Honeymoon item. Then bring the
-- wedding's date into line.
-- -----------------------------------------------------------------------------
update public.trips t
  set pot_goal_id = g.id
  from public.savings_goals g
  where t.pot_goal_id is null
    and g.household_id = t.household_id
    and g.pot_id is not null
    and g.archived_at is null
    and (lower(trim(g.name)) = lower(trim(t.name)) or (t.name ilike 'patagonia%' and g.name ilike 'honeymoon'))
    and not exists (select 1 from public.trips o where o.pot_goal_id = g.id);

select public.sync_wedding_pot_target(household_id) from public.wedding_settings where pot_goal_id is not null;
