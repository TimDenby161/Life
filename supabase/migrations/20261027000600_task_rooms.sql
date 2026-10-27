-- Rooms: where a task happens (Kitchen, Bathroom...). Separate from categories,
-- which say what kind of task it is. The Jobs page groups by room.

create table public.task_rooms (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 40),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (id, household_id)
);

create unique index task_rooms_name_uniq on public.task_rooms (household_id, lower(name));

alter table public.tasks
  add column room_id uuid,
  add foreign key (room_id, household_id) references public.task_rooms (id, household_id) on delete set null (room_id);

alter table public.task_rooms enable row level security;

create policy "task_rooms: members all" on public.task_rooms
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

grant select, delete on public.task_rooms to authenticated;
grant insert (id, household_id, name, sort_order), update (name, sort_order) on public.task_rooms to authenticated;
grant insert (room_id), update (room_id) on public.tasks to authenticated;

alter publication supabase_realtime add table public.task_rooms;

-- Starting rooms for existing households; they can be renamed or added to.
insert into public.task_rooms (household_id, name, sort_order)
select h.id, r.name, r.sort_order
from public.households h
cross join (values ('Kitchen', 1), ('Bathroom', 2), ('Bedroom', 3), ('Living room', 4), ('Hallway', 5)) as r (name, sort_order)
on conflict do nothing;
