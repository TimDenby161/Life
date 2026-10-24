-- =============================================================================
-- Feed (messages between members + external source configuration) and
-- calendar integration configuration.
-- =============================================================================

create table public.feed_posts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  author_id uuid not null default auth.uid(),
  body text not null check (char_length(trim(body)) between 1 and 5000),
  pinned_at timestamptz,
  pinned_by uuid references public.profiles (id) on delete set null,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, household_id),
  foreign key (household_id, author_id) references public.household_members (household_id, user_id)
);

create index feed_posts_household_created_idx on public.feed_posts (household_id, created_at desc);

create trigger feed_posts_updated_at before update on public.feed_posts
  for each row execute function public.set_updated_at();

-- Anyone in the household may pin; only the author may edit the text.
create or replace function public.feed_posts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.body is distinct from old.body then
    if old.author_id <> auth.uid() then
      raise exception 'Only the author can edit a post' using errcode = '42501';
    end if;
    new.edited_at := now();
  end if;
  if new.pinned_at is distinct from old.pinned_at then
    new.pinned_by := case when new.pinned_at is null then null else auth.uid() end;
  end if;
  return new;
end;
$$;

create trigger feed_posts_guard before update on public.feed_posts
  for each row execute function public.feed_posts_guard();

create table public.feed_comments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  post_id uuid not null,
  author_id uuid not null default auth.uid(),
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (post_id, household_id) references public.feed_posts (id, household_id) on delete cascade,
  foreign key (household_id, author_id) references public.household_members (household_id, user_id)
);

create index feed_comments_post_idx on public.feed_comments (post_id, created_at);

create trigger feed_comments_updated_at before update on public.feed_comments
  for each row execute function public.set_updated_at();

create table public.feed_reads (
  household_id uuid not null references public.households (id) on delete cascade,
  post_id uuid not null,
  user_id uuid not null default auth.uid(),
  read_at timestamptz not null default now(),
  primary key (post_id, user_id),
  foreign key (post_id, household_id) references public.feed_posts (id, household_id) on delete cascade,
  foreign key (household_id, user_id) references public.household_members (household_id, user_id)
);

-- External information sources. Credentials never live here: providers that
-- need API keys read them from Edge Function secrets.
create table public.feed_sources (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  provider text not null check (provider in ('rss', 'football', 'mock')),
  name text not null check (char_length(trim(name)) between 1 and 80),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger feed_sources_updated_at before update on public.feed_sources
  for each row execute function public.set_updated_at();

-- Calendar integrations. Google credentials (service account key) are Edge
-- Function secrets, never stored in the database.
create table public.calendar_integrations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  provider text not null default 'google' check (provider in ('google')),
  mode text not null default 'service_account' check (mode in ('service_account', 'embed')),
  name text not null check (char_length(trim(name)) between 1 and 80),
  google_calendar_id text check (char_length(google_calendar_id) <= 300),
  embed_url text check (embed_url is null or embed_url ~ '^https://calendar\.google\.com/calendar/embed\?'),
  color text not null default 'sky',
  enabled boolean not null default true,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (mode <> 'service_account' or google_calendar_id is not null),
  check (mode <> 'embed' or embed_url is not null)
);

create trigger calendar_integrations_updated_at before update on public.calendar_integrations
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS + grants
-- -----------------------------------------------------------------------------
alter table public.feed_posts enable row level security;
alter table public.feed_comments enable row level security;
alter table public.feed_reads enable row level security;
alter table public.feed_sources enable row level security;
alter table public.calendar_integrations enable row level security;

create policy "feed_posts: members read" on public.feed_posts
  for select to authenticated using (public.is_household_member(household_id));
create policy "feed_posts: create as self" on public.feed_posts
  for insert to authenticated
  with check (public.is_household_member(household_id) and author_id = (select auth.uid()));
create policy "feed_posts: members update" on public.feed_posts
  for update to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));
create policy "feed_posts: author deletes" on public.feed_posts
  for delete to authenticated using (author_id = (select auth.uid()));

create policy "feed_comments: members read" on public.feed_comments
  for select to authenticated using (public.is_household_member(household_id));
create policy "feed_comments: create as self" on public.feed_comments
  for insert to authenticated
  with check (public.is_household_member(household_id) and author_id = (select auth.uid()));
create policy "feed_comments: author edits" on public.feed_comments
  for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy "feed_comments: author deletes" on public.feed_comments
  for delete to authenticated using (author_id = (select auth.uid()));

create policy "feed_reads: members read" on public.feed_reads
  for select to authenticated using (public.is_household_member(household_id));
create policy "feed_reads: own insert" on public.feed_reads
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_household_member(household_id));
create policy "feed_reads: own update" on public.feed_reads
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "feed_reads: own delete" on public.feed_reads
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "feed_sources: members all" on public.feed_sources
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

create policy "calendar_integrations: members all" on public.calendar_integrations
  for all to authenticated
  using (public.is_household_member(household_id)) with check (public.is_household_member(household_id));

grant select, delete on public.feed_posts to authenticated;
grant insert (id, household_id, body) on public.feed_posts to authenticated;
grant update (body, pinned_at) on public.feed_posts to authenticated;
grant select, delete on public.feed_comments to authenticated;
grant insert (id, household_id, post_id, body) on public.feed_comments to authenticated;
grant update (body) on public.feed_comments to authenticated;
grant select, delete on public.feed_reads to authenticated;
grant insert (household_id, post_id, read_at) on public.feed_reads to authenticated;
grant update (read_at) on public.feed_reads to authenticated;
grant select, delete on public.feed_sources to authenticated;
grant insert (id, household_id, provider, name, config, enabled, sort_order) on public.feed_sources to authenticated;
grant update (name, config, enabled, sort_order) on public.feed_sources to authenticated;
grant select, delete on public.calendar_integrations to authenticated;
grant insert (id, household_id, provider, mode, name, google_calendar_id, embed_url, color, enabled)
  on public.calendar_integrations to authenticated;
grant update (mode, name, google_calendar_id, embed_url, color, enabled) on public.calendar_integrations to authenticated;
