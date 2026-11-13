-- =============================================================================
-- Coach week: calendar names you've taught it, and the coach's plan worked out
-- live instead of saved.
--
--   exercise_names  what a calendar title means: "GS1" is a table tennis match,
--                   "Graham Spicer" a tournament. A title containing the phrase
--                   gets that activity; activity null = not exercise, so it is
--                   never shown. owner_id is whose calendar it applies to (null
--                   = anyone's).
--
-- exercise_plan keeps only the boxes you set by hand (owner_id null = both of
-- you); the coach's suggestions are worked out each time in the app, around the
-- calendar, what you set and what you logged, so its old saved drafts go.
-- =============================================================================

create table public.exercise_names (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  owner_id uuid,
  phrase text not null check (char_length(trim(phrase)) between 1 and 60),
  activity text check (activity is null or char_length(trim(activity)) between 1 and 40),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (household_id, owner_id) references public.household_members (household_id, user_id) on delete cascade
);

create unique index exercise_names_phrase_idx on public.exercise_names
  (household_id, coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(trim(phrase)));

alter table public.exercise_names enable row level security;

create policy "exercise_names: members all" on public.exercise_names
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

grant select, delete on public.exercise_names to authenticated;
grant insert (household_id, owner_id, phrase, activity) on public.exercise_names to authenticated;
grant update (phrase, activity) on public.exercise_names to authenticated;

alter publication supabase_realtime add table public.exercise_names;

-- Tim's table tennis: league matches are written as the other team's name, and
-- tournaments by their name and star rating.
insert into public.exercise_names (household_id, owner_id, phrase, activity, created_by)
select m.household_id, m.user_id, v.phrase, v.activity, m.user_id
from public.household_members m
join public.profiles p on p.id = m.user_id and p.display_name = 'Tim'
cross join (values ('GS1', 'TT match'), ('Crusaders', 'TT match'), ('Teddington', 'TT match'), ('Graham Spicer', 'TT tournament')) as v (phrase, activity)
on conflict do nothing;

-- The coach's plan is no longer saved.
delete from public.exercise_plan where by_coach;
drop trigger exercise_plan_touch on public.exercise_plan;
drop function public.exercise_plan_touch();
alter table public.exercise_plan drop column by_coach;

create function public.exercise_plan_touch() returns trigger language plpgsql as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

create trigger exercise_plan_touch before insert or update on public.exercise_plan
  for each row execute function public.exercise_plan_touch();

grant insert (household_id, day, owner_id, activity) on public.exercise_plan to authenticated;
