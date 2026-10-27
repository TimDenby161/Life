-- Category owners: a category can belong to one person, and then every task in
-- it is assigned to them. Enforced here rather than in the form, so moving a
-- task into the category, editing an occurrence or handing the category over
-- all end up with the owner as assignee. Categories without an owner are joint
-- and behave as before.

alter table public.task_categories
  add column owner_id uuid,
  add foreign key (household_id, owner_id) references public.household_members (household_id, user_id)
    on delete set null (owner_id);

-- task_categories already has table-level insert/update for members, which
-- covers the new column.

create or replace function public.task_category_owner(p_category_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select owner_id from public.task_categories where id = p_category_id
$$;

-- Tasks: an owned category decides the assignee.
create or replace function public.tasks_category_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_owner uuid := public.task_category_owner(new.category_id);
begin
  if v_owner is not null then
    new.assignee_id := v_owner;
  end if;
  return new;
end;
$$;

create trigger tasks_category_owner before insert or update of category_id, assignee_id on public.tasks
  for each row execute function public.tasks_category_owner();

-- Open occurrences can be reassigned on their own; keep them with the owner too.
create or replace function public.task_occurrences_category_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_owner uuid := public.task_category_owner((select t.category_id from public.tasks t where t.id = new.task_id));
begin
  if v_owner is not null and new.status = 'open' then
    new.assignee_id := v_owner;
  end if;
  return new;
end;
$$;

create trigger task_occurrences_category_owner before insert or update of assignee_id on public.task_occurrences
  for each row execute function public.task_occurrences_category_owner();

-- Giving a category an owner hands its live tasks over (tasks_after_update
-- then moves their open occurrences). Clearing the owner leaves assignees alone.
create or replace function public.task_categories_after_owner_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is not null then
    update public.tasks
    set assignee_id = new.owner_id
    where category_id = new.id and archived_at is null and assignee_id is distinct from new.owner_id;
  end if;
  return null;
end;
$$;

create trigger task_categories_after_owner_change after update of owner_id on public.task_categories
  for each row when (new.owner_id is distinct from old.owner_id)
  execute function public.task_categories_after_owner_change();
