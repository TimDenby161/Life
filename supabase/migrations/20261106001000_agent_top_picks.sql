-- Today's AI top-job picks, saved onto a person's briefing for that day. Used
-- by the agents function when the morning Claude routine sends its picks (the
-- function has already checked each pick is one of that person's open jobs).
-- Service role only. Returns false if there's no briefing for that day yet.
create or replace function public.agent_set_top_picks(p_household_id uuid, p_user_id uuid, p_date date, p_top jsonb)
returns boolean
language sql
set search_path = ''
as $$
  with target as (
    select id
    from public.agent_briefings
    where household_id = p_household_id
      and recipient_id = p_user_id
      and content ->> 'date' = p_date::text
    order by updated_at desc
    limit 1
  ), updated as (
    update public.agent_briefings b
    set content = b.content || jsonb_build_object('top', p_top), updated_at = now()
    from target
    where b.id = target.id
      and jsonb_typeof(p_top) = 'array'
      and jsonb_array_length(p_top) <= 5
    returning true
  )
  select exists (select 1 from updated);
$$;

revoke execute on function public.agent_set_top_picks(uuid, uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.agent_set_top_picks(uuid, uuid, date, jsonb) to service_role;
