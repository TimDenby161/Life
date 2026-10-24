-- =============================================================================
-- Realtime + household bootstrap.
-- =============================================================================

-- Realtime postgres_changes honours RLS for each subscriber, so private
-- health rows are only broadcast to those allowed to read them.
do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach v_table in array array[
    'tasks', 'task_occurrences', 'task_completion_events', 'task_comments', 'task_subtasks', 'task_categories',
    'financial_accounts', 'financial_transactions', 'account_balance_history', 'budgets', 'savings_goals',
    'finance_categories',
    'feed_posts', 'feed_comments', 'feed_reads', 'feed_events', 'feed_sources',
    'health_measurements', 'health_exercise_sessions', 'health_notes', 'health_category_visibility',
    'calendar_integrations', 'profiles'
  ] loop
    execute format('alter publication supabase_realtime add table public.%I', v_table);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Admin-only: create a household for existing auth users and seed defaults.
-- Run from the SQL editor (as postgres) after inviting both users:
--
--   select public.bootstrap_household('Tim & Sophie', '[
--     {"email": "tim@example.com",    "display_name": "Tim",    "avatar_color": "indigo"},
--     {"email": "sophie@example.com", "display_name": "Sophie", "avatar_color": "rose"}
--   ]'::jsonb);
-- -----------------------------------------------------------------------------
create or replace function public.bootstrap_household(p_name text, p_members jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_id uuid;
  v_member jsonb;
  v_user_id uuid;
  v_first boolean := true;
  v_order integer := 1;
begin
  if jsonb_typeof(p_members) <> 'array' or jsonb_array_length(p_members) = 0 then
    raise exception 'p_members must be a non-empty array';
  end if;

  insert into public.households (name) values (p_name) returning id into v_household_id;

  insert into public.task_lists (household_id, name, kind, sort_order)
  values (v_household_id, 'Joint', 'joint', 0);

  for v_member in select * from jsonb_array_elements(p_members) loop
    select u.id into v_user_id from auth.users u where lower(u.email) = lower(v_member ->> 'email');
    if v_user_id is null then
      raise exception 'No auth user with email % — invite them first', v_member ->> 'email';
    end if;

    update public.profiles
    set display_name = coalesce(nullif(v_member ->> 'display_name', ''), display_name),
        avatar_color = coalesce(nullif(v_member ->> 'avatar_color', ''), avatar_color)
    where id = v_user_id;

    insert into public.household_members (household_id, user_id, role)
    values (v_household_id, v_user_id, case when v_first then 'owner' else 'member' end);

    insert into public.task_lists (household_id, name, kind, owner_id, sort_order)
    select v_household_id, p.display_name, 'personal', v_user_id, v_order
    from public.profiles p where p.id = v_user_id;

    v_first := false;
    v_order := v_order + 1;
  end loop;

  insert into public.task_categories (household_id, name, color)
  select v_household_id, c.name, c.color
  from (values
    ('Cleaning', 'sky'), ('Cooking', 'orange'), ('Shopping', 'emerald'), ('Bins & recycling', 'teal'),
    ('Laundry', 'violet'), ('Garden', 'emerald'), ('Admin & bills', 'amber'), ('Maintenance', 'slate'),
    ('Social', 'rose'), ('Other', 'slate')
  ) as c (name, color);

  insert into public.finance_categories (household_id, name, kind, color)
  select v_household_id, c.name, c.kind, c.color
  from (values
    ('Salary', 'income', 'emerald'), ('Interest', 'income', 'teal'), ('Gifts received', 'income', 'rose'),
    ('Other income', 'income', 'slate'),
    ('Housing', 'expense', 'indigo'), ('Utilities', 'expense', 'sky'), ('Groceries', 'expense', 'emerald'),
    ('Eating out', 'expense', 'orange'), ('Transport', 'expense', 'amber'), ('Subscriptions', 'expense', 'violet'),
    ('Shopping', 'expense', 'rose'), ('Health & fitness', 'expense', 'teal'), ('Entertainment', 'expense', 'violet'),
    ('Holidays', 'expense', 'sky'), ('Gifts', 'expense', 'rose'), ('Insurance', 'expense', 'slate'),
    ('Other', 'expense', 'slate')
  ) as c (name, kind, color);

  return v_household_id;
end;
$$;

revoke all on function public.bootstrap_household(text, jsonb) from public, anon, authenticated;
