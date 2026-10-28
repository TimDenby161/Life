-- Languages: who learns what. A person learns the languages they have an
-- active language_study row for (Tim: Mandarin and Spanish; Sophie: Spanish).
-- Stopping keeps the row (settings and linked jobs) and all progress.
--
-- Existing people get rows from what they already do: a language job assigned
-- to them, or progress in it. Their jobs are linked the way the page links
-- them by name.

alter table public.language_study add column active boolean not null default true;

grant insert (active), update (active) on public.language_study to authenticated;

with langs (language, pattern, words_per_day, characters_per_day) as (
  values ('zh', 'mandarin|chinese', 3, 2), ('es', 'spanish|español', 2, 0)
),
jobs as (
  select t.id, t.household_id, t.assignee_id, t.title, t.title || ' ' || coalesce(c.name, '') as label
  from public.tasks t
  left join public.task_categories c on c.id = t.category_id
  where t.archived_at is null and t.recurrence ? 'afterDone'
)
insert into public.language_study
  (household_id, user_id, language, words_per_day, characters_per_day, words_task_id, characters_task_id, review_task_id)
select m.household_id, m.user_id, l.language, l.words_per_day, l.characters_per_day,
  (select j.id from jobs j where j.household_id = m.household_id and (j.assignee_id = m.user_id or j.assignee_id is null)
     and j.label ~* l.pattern and j.title ~* 'new .*words?' order by j.assignee_id nulls last, j.title limit 1),
  case when l.language = 'zh' then
    (select j.id from jobs j where j.household_id = m.household_id and (j.assignee_id = m.user_id or j.assignee_id is null)
       and j.label ~* l.pattern and j.title ~* 'characters?' order by j.assignee_id nulls last, j.title limit 1)
  end,
  (select j.id from jobs j where j.household_id = m.household_id and (j.assignee_id = m.user_id or j.assignee_id is null)
     and j.label ~* l.pattern and j.title ~* 'review' order by j.assignee_id nulls last, j.title limit 1)
from public.household_members m
cross join langs l
where exists (select 1 from jobs j where j.household_id = m.household_id and j.assignee_id = m.user_id and j.label ~* l.pattern)
   or exists (select 1 from public.language_progress p where p.user_id = m.user_id and p.language = l.language)
on conflict (user_id, language) do nothing;
