-- =============================================================================
-- Holidays Todo tab: the bookings each trip's plan says to make (its "Book now"
-- list), one row each, ticked off when booked. Shared by both of you like trips.
-- Just what to book: no references, prices or booking details are stored.
-- =============================================================================

create table public.trip_bookings (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  trip_id uuid not null,
  title text not null check (char_length(trim(title)) between 1 and 200),
  done boolean not null default false,
  sort int not null default 0,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (trip_id, household_id) references public.trips (id, household_id) on delete cascade
);

create index trip_bookings_trip_idx on public.trip_bookings (trip_id, sort);
create index trip_bookings_household_idx on public.trip_bookings (household_id);

create trigger trip_bookings_updated_at before update on public.trip_bookings
  for each row execute function public.set_updated_at();

alter table public.trip_bookings enable row level security;

create policy "trip_bookings: members all" on public.trip_bookings
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

-- created_by is not client-writable (it defaults to the caller).
grant select, delete on public.trip_bookings to authenticated;
grant insert (household_id, trip_id, title, sort) on public.trip_bookings to authenticated;
grant update (title, done, sort) on public.trip_bookings to authenticated;

alter publication supabase_realtime add table public.trip_bookings;
