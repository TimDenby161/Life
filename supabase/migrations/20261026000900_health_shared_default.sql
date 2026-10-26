-- =============================================================================
-- Health is shared with your partner by default. A category with no setting
-- now counts as shared, and existing category settings are switched to shared.
-- Marking a category or a single record private still hides it.
-- =============================================================================
-- Shared by default: an unset category now counts as shared.
create or replace function public.health_is_visible(p_owner uuid, p_household_id uuid, p_category text, p_visibility text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_owner = (select auth.uid())
    or (
      public.is_household_member(p_household_id)
      and public.shares_household_with(p_owner)
      and case p_visibility
            when 'shared' then true
            when 'private' then false
            else coalesce((select v.shared from public.health_category_visibility v
                           where v.user_id = p_owner and v.category = p_category), true)
          end
    );
$$;

alter table public.health_category_visibility alter column shared set default true;
update public.health_category_visibility set shared = true where not shared;
