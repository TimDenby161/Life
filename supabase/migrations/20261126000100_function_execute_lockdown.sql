-- =============================================================================
-- Functions: nobody runs one unless granted it.
--
-- Postgres gives EXECUTE on every new function to PUBLIC (so to anon too).
-- The foundation's `alter default privileges in schema public revoke ... from
-- public` didn't stop that: a per-schema default can only add to the global
-- defaults, never take away. Functions whose migration revoked by hand were
-- safe; 32 SECURITY DEFINER ones (internal helpers such as _task_record_event
-- and log_feed_event, and every trigger function) stayed callable by anyone
-- through /rest/v1/rpc (Supabase security advisor, 2026-11-26).
--
-- 1. Change the global default, so functions made from now on start closed.
-- 2. Take PUBLIC and anon off every function in public (extensions' own
--    functions excepted). Explicit grants to authenticated and service_role
--    are kept: those are the RPCs the app and the Edge Functions call, and the
--    helpers RLS policies use (is_household_member, shares_household_with).
-- 3. Grant back what signed-in users had only through PUBLIC and still need:
--    task_category_owner, called inside the task triggers as the caller.
--    Trigger functions themselves need no EXECUTE to fire.
-- =============================================================================

alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public, anon;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
  end loop;
end $$;

grant execute on function public.task_category_owner(uuid) to authenticated;

-- The one function the advisor found without a fixed search_path (L-003).
alter function public.exercise_plan_touch() set search_path = '';
