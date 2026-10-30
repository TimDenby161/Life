-- =============================================================================
-- Wedding tasks on the Joint list take both of us: they start marked needs_both
-- when added to the wedding's category, or moved into it. Nothing here runs when
-- needs_both itself is changed, so unticking one by hand sticks.
-- =============================================================================

create or replace function public.tasks_wedding_needs_both()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or new.category_id is distinct from old.category_id)
     and exists (
       select 1 from public.wedding_settings s
       where s.household_id = new.household_id and s.task_category_id = new.category_id
     )
     and (select l.kind from public.task_lists l where l.id = new.list_id) = 'joint' then
    new.needs_both := true;
  end if;
  return new;
end;
$$;

revoke execute on function public.tasks_wedding_needs_both() from public;

create trigger tasks_wedding_needs_both before insert or update of category_id on public.tasks
  for each row execute function public.tasks_wedding_needs_both();

update public.tasks t set needs_both = true
from public.wedding_settings s, public.task_lists l
where s.household_id = t.household_id and s.task_category_id = t.category_id
  and l.id = t.list_id and l.kind = 'joint'
  and t.archived_at is null;
