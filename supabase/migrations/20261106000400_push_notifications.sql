-- =============================================================================
-- Morning briefing as a phone notification (Web Push).
--
--   user_preferences.briefing_push  per person, off by default.
--   push_subscriptions              one row per device a person has allowed
--                                   notifications on. Owner only.
--
-- The agents Edge Function sends the briefing headline (counts only) to the
-- person's devices after the scheduled Chief of Staff run. Endpoints must be a
-- browser push service, so the function can never be pointed at another URL.
-- =============================================================================

alter table public.user_preferences
  add column briefing_push boolean not null default false;
-- user_preferences already has table-level select/insert/update for the owner.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null default auth.uid(),
  endpoint text not null check (
    char_length(endpoint) <= 1000
    and endpoint ~ '^https://(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.notify\.windows\.com)/'
  ),
  -- The browser's keys for encrypting to it (base64url): P-256 public key and auth secret.
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{86,88}={0,2}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{22,24}={0,2}$'),
  created_at timestamptz not null default now(),
  unique (user_id, endpoint),
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade
);

create index push_subscriptions_household_idx on public.push_subscriptions (household_id);

alter table public.push_subscriptions enable row level security;

create policy "push_subscriptions: own" on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and public.is_household_member(household_id));

grant select, delete on public.push_subscriptions to authenticated;
grant insert (household_id, endpoint, p256dh, auth) on public.push_subscriptions to authenticated;

-- The push service says a device has gone (unsubscribed, app removed): forget it.
create or replace function public.push_subscriptions_gone(p_household_id uuid, p_ids uuid[])
returns void
language sql
set search_path = ''
as $$
  delete from public.push_subscriptions where household_id = p_household_id and id = any (p_ids);
$$;

revoke execute on function public.push_subscriptions_gone(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.push_subscriptions_gone(uuid, uuid[]) to service_role;
