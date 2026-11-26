-- Functions are closed unless granted: anon (signed out) runs none, PUBLIC holds no EXECUTE,
-- internal helpers can't be called over /rest/v1/rpc by a signed-in user, and the RPCs the app
-- uses still work. A function made later starts closed too, and every function fixes its search_path.
-- Run with: npm run test:db   (requires the local stack: supabase start)
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

create temporary view own_functions as
  select p.oid, p.oid::regprocedure::text as sig, p.proname, p.proacl
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind in ('f', 'p')
    and not exists (
      select 1 from pg_depend d
      where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
    );

select is_empty(
  $$ select sig from own_functions where has_function_privilege('anon', oid, 'execute') $$,
  'anon can execute no function in public');

select is_empty(
  $$ select sig from own_functions where proacl is null or exists (
       select 1 from aclexplode(proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') $$,
  'PUBLIC holds EXECUTE on no function in public');

select is_empty(
  $$ select sig from own_functions
     where proname in ('_task_record_event', '_task_lock_occurrence', 'log_feed_event',
                       'task_generate_next_occurrence', 'refresh_savings_goals',
                       'sync_wedding_pot_target', 'household_today', 'task_last_done_on')
       and has_function_privilege('authenticated', oid, 'execute') $$,
  'signed-in users can''t call the internal helpers directly');

select is_empty(
  $$ select sig from own_functions
     where proname in ('tasks_after_insert', 'tasks_after_update', 'finance_after_change',
                       'handle_new_auth_user', 'check_transfer_pair', 'wedding_venue_added')
       and has_function_privilege('authenticated', oid, 'execute') $$,
  'signed-in users can''t call trigger functions over rpc');

select ok(
  (select bool_and(has_function_privilege('authenticated', oid, 'execute')) from own_functions
   where proname in ('complete_task_occurrence', 'skip_task_occurrence', 'reopen_task_occurrence',
                     'respond_agent_suggestion', 'answer_ai_question', 'create_transfer',
                     'replace_sheet_links', 'exercise_goals', 'is_household_member',
                     'shares_household_with', 'task_category_owner')),
  'the app''s RPCs and the RLS helpers stay callable when signed in');

select ok(
  (select bool_and(has_function_privilege('service_role', oid, 'execute')) from own_functions
   where proname in ('agent_claim_run', 'agent_finish_run', 'apply_sheet_balances', 'agent_save_work')),
  'the Edge Functions'' service role keeps its RPCs');

create function public.zz_grants_probe() returns int language sql as $$ select 1 $$;
select ok(
  not has_function_privilege('anon', 'public.zz_grants_probe()', 'execute')
  and not has_function_privilege('authenticated', 'public.zz_grants_probe()', 'execute'),
  'a new function starts closed to anon and signed-in users');

select ok(
  (select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.exercise_plan_touch()'::regprocedure),
  'exercise_plan_touch runs on an empty search_path');

select is_empty(
  $$ select sig from own_functions f where f.proname <> 'zz_grants_probe' and not exists (
       select 1 from pg_proc p, unnest(coalesce(p.proconfig, '{}')) c
       where p.oid = f.oid and c like 'search_path=%') $$,
  'every function in public fixes its search_path (the advisor''s other finding)');

select * from finish();
rollback;
