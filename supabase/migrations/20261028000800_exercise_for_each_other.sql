-- =============================================================================
-- Exercise can be logged for each other ("Sophie did 60 min of yoga", or one
-- session each when we did it together). Only exercise: weight and periods stay
-- owner-only writes.
--
-- logged_by records who entered a session (always the caller, not client-
-- writable). A session can be deleted by its person or by whoever logged it;
-- editing stays with the person it belongs to.
-- =============================================================================

alter table public.health_exercise_sessions
  add column logged_by uuid default auth.uid() references public.profiles (id) on delete set null;

create or replace function public.health_exercise_sessions_logged_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.logged_by := auth.uid();
  return new;
end;
$$;

create trigger health_exercise_sessions_logged_by before insert on public.health_exercise_sessions
  for each row execute function public.health_exercise_sessions_logged_by();

drop policy "health_exercise_sessions: owner insert" on public.health_exercise_sessions;
drop policy "health_exercise_sessions: owner delete" on public.health_exercise_sessions;

-- The (household_id, user_id) foreign key keeps user_id to a member of that household.
create policy "health_exercise_sessions: household insert" on public.health_exercise_sessions
  for insert to authenticated
  with check (public.is_household_member(household_id));
create policy "health_exercise_sessions: owner or logger delete" on public.health_exercise_sessions
  for delete to authenticated
  using (user_id = (select auth.uid()) or logged_by = (select auth.uid()));

grant insert (user_id) on public.health_exercise_sessions to authenticated;
