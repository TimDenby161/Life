-- =============================================================================
-- Languages: daily vocabulary with spaced repetition (Mandarin, HSK lists).
--
-- The word lists are fixed public data and ship with the app
-- (src/modules/languages/data, built by scripts/build-hsk.mjs); only each
-- person's settings and progress live here, keyed by the item's text.
--
-- * language_study: one row per person and language: how many new words and
--   characters a day, the HSK level to start from, and which jobs finishing
--   each part ticks off.
-- * language_progress: one row per item a person has learned. due_on and
--   interval_days are the review schedule (worked out in
--   src/modules/languages/lib/srs.ts).
--
-- Like health: both members can see everything, only the owner writes.
-- =============================================================================

create table public.language_study (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null default auth.uid(),
  language text not null check (language in ('zh')),
  words_per_day smallint not null default 3 check (words_per_day between 0 and 50),
  characters_per_day smallint not null default 2 check (characters_per_day between 0 and 50),
  start_level smallint not null default 1 check (start_level between 1 and 6),
  words_task_id uuid,
  characters_task_id uuid,
  review_task_id uuid,
  updated_at timestamptz not null default now(),
  primary key (user_id, language),
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade,
  foreign key (words_task_id, household_id) references public.tasks (id, household_id) on delete set null (words_task_id),
  foreign key (characters_task_id, household_id) references public.tasks (id, household_id) on delete set null (characters_task_id),
  foreign key (review_task_id, household_id) references public.tasks (id, household_id) on delete set null (review_task_id)
);

create trigger language_study_updated_at before update on public.language_study
  for each row execute function public.set_updated_at();

create table public.language_progress (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null default auth.uid(),
  language text not null check (language in ('zh')),
  kind text not null check (kind in ('word', 'character')),
  item text not null check (char_length(item) between 1 and 20),
  learned_on date not null,
  due_on date not null,
  interval_days smallint not null default 1 check (interval_days between 1 and 365),
  reviews integer not null default 0 check (reviews >= 0),
  lapses integer not null default 0 check (lapses >= 0),
  last_reviewed_on date,
  created_at timestamptz not null default now(),
  foreign key (household_id, user_id) references public.household_members (household_id, user_id) on delete cascade,
  unique (user_id, language, kind, item)
);

create index language_progress_due_idx on public.language_progress (user_id, language, due_on);

alter table public.language_study enable row level security;
alter table public.language_progress enable row level security;

create policy "language_study: household read" on public.language_study
  for select to authenticated using (public.is_household_member(household_id));
create policy "language_study: owner insert" on public.language_study
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_household_member(household_id));
create policy "language_study: owner update" on public.language_study
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "language_progress: household read" on public.language_progress
  for select to authenticated using (public.is_household_member(household_id));
create policy "language_progress: owner insert" on public.language_progress
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_household_member(household_id));
create policy "language_progress: owner update" on public.language_progress
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "language_progress: owner delete" on public.language_progress
  for delete to authenticated using (user_id = (select auth.uid()));

grant select on public.language_study to authenticated;
grant insert (household_id, language, words_per_day, characters_per_day, start_level, words_task_id, characters_task_id, review_task_id)
  on public.language_study to authenticated;
grant update (words_per_day, characters_per_day, start_level, words_task_id, characters_task_id, review_task_id)
  on public.language_study to authenticated;

grant select, delete on public.language_progress to authenticated;
grant insert (id, household_id, language, kind, item, learned_on, due_on, interval_days)
  on public.language_progress to authenticated;
grant update (due_on, interval_days, reviews, lapses, last_reviewed_on) on public.language_progress to authenticated;

alter publication supabase_realtime add table public.language_study;
alter publication supabase_realtime add table public.language_progress;
