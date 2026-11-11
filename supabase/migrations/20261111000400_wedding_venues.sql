-- =============================================================================
-- The Wedding page's first view (Plan): the jobs to do and the venues you are
-- looking at.
--
--   wedding_venues   possible venues either of you adds, with a link and a
--                    note, ticked once visited. Shared; adding one posts
--                    "Venue idea: <name>" to the household feed so the other
--                    person sees it.
--
-- Also puts the first two jobs Tim asked for on the wedding checklist (ordinary
-- joint tasks with the Wedding category) where they aren't there already.
-- =============================================================================

create table public.wedding_venues (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  -- Only web links, so a stored link can never run script when opened.
  url text check (url is null or (char_length(url) <= 500 and url ~* '^https?://')),
  note text check (note is null or char_length(note) <= 300),
  visited boolean not null default false,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index wedding_venues_household_idx on public.wedding_venues (household_id, created_at);

create trigger wedding_venues_updated_at before update on public.wedding_venues
  for each row execute function public.set_updated_at();

alter table public.wedding_venues enable row level security;

create policy "wedding_venues: members all" on public.wedding_venues
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

-- created_by is not client-writable (it defaults to the caller).
grant select, delete on public.wedding_venues to authenticated;
grant insert (household_id, name, url, note) on public.wedding_venues to authenticated;
grant update (name, url, note, visited) on public.wedding_venues to authenticated;

create or replace function public.wedding_venue_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.log_feed_event(new.household_id, new.created_by, 'wedding.venue_added', 'wedding_venue', new.id, 'Venue idea: ' || new.name, '{}'::jsonb);
  return new;
end;
$$;

create trigger wedding_venues_feed after insert on public.wedding_venues
  for each row execute function public.wedding_venue_added();

alter publication supabase_realtime add table public.wedding_venues;

-- The first jobs ------------------------------------------------------------------------
do $$
declare
  v_hh uuid;
  v_cat uuid;
  v_list uuid;
  v_by uuid;
  v_title text;
begin
  for v_hh in select h.id from public.households h where exists (select 1 from public.wedding_settings w where w.household_id = h.id) loop
    select task_category_id into v_cat from public.wedding_settings where household_id = v_hh;
    if v_cat is null then
      select id into v_cat from public.task_categories where household_id = v_hh and name = 'Wedding' limit 1;
      if v_cat is null then
        insert into public.task_categories (household_id, name, color) values (v_hh, 'Wedding', 'rose') returning id into v_cat;
      end if;
      update public.wedding_settings set task_category_id = v_cat where household_id = v_hh;
    end if;
    select id into v_list from public.task_lists where household_id = v_hh and kind = 'joint';
    select user_id into v_by from public.household_members where household_id = v_hh order by (role = 'owner') desc, joined_at limit 1;
    continue when v_list is null or v_by is null;

    foreach v_title in array array['Find venues and visit them', 'Engagement ring: pay the second instalment'] loop
      if not exists (select 1 from public.tasks t where t.household_id = v_hh and lower(t.title) = lower(v_title) and t.archived_at is null) then
        insert into public.tasks (household_id, list_id, title, category_id, created_by)
        values (v_hh, v_list, v_title, v_cat, v_by);
      end if;
    end loop;
  end loop;
end;
$$;
