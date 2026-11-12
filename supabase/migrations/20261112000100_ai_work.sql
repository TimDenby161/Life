-- =============================================================================
-- Claude does jobs. The morning Claude routine looks through the open one-off
-- jobs and, for the ones it can do or make much quicker by searching the web
-- and writing, either:
--
--   asks   adds a short question as a task of its own, due that day
--          (tasks.ai_asks_task_id points at the job it is for). Answering it
--          (answer_ai_question) saves the answer and ticks the question off;
--          the next morning's run reads the answer and does the job.
--   does   leaves what it found on the job (tasks.ai_result: a one-line
--          summary, the text, links and the day), and for wedding venue
--          hunting adds the venues to wedding_venues (created_by null = added
--          by Claude).
--
-- It never completes, edits, moves or deletes a job: ticking it off stays with
-- you. Everything here is written by the agents function (service role)
-- through agent_save_work, after it has checked each item against the jobs it
-- offered. None of the new columns are client-writable.
-- =============================================================================

alter table public.tasks
  add column ai_asks_task_id uuid,
  add column ai_answer text check (ai_answer is null or char_length(trim(ai_answer)) between 1 and 500),
  add column ai_result jsonb check (ai_result is null or jsonb_typeof(ai_result) = 'object'),
  add foreign key (ai_asks_task_id, household_id) references public.tasks (id, household_id) on delete cascade,
  add check (ai_answer is null or ai_asks_task_id is not null);

create index tasks_ai_asks_idx on public.tasks (ai_asks_task_id) where ai_asks_task_id is not null;

-- A question from Claude is not news: as before, but nothing in the feed for it.
create or replace function public.tasks_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_assignee_name text;
begin
  if new.recurrence is null then
    insert into public.task_occurrences (household_id, task_id, due_date, due_time, assignee_id)
    values (new.household_id, new.id, new.due_date, new.due_time, new.assignee_id);
  else
    perform public.task_generate_next_occurrence(new.id, new.due_date - 1, null);
  end if;

  if new.ai_asks_task_id is not null then
    return null;
  end if;

  -- Keep the feed calm: a personal to-do someone adds for themselves is not news.
  if (select l.kind from public.task_lists l where l.id = new.list_id) = 'personal'
     and coalesce(new.assignee_id, new.created_by) = new.created_by then
    return null;
  end if;

  select display_name into v_name from public.profiles where id = new.created_by;
  select display_name into v_assignee_name from public.profiles where id = new.assignee_id;
  perform public.log_feed_event(
    new.household_id, new.created_by, 'task.created', 'task', new.id,
    coalesce(v_name, 'Someone') || ' added “' || new.title || '”'
      || case when new.assignee_id is not null and new.assignee_id <> new.created_by
              then ' for ' || coalesce(v_assignee_name, 'someone') else '' end,
    jsonb_build_object('list_id', new.list_id, 'recurring', new.recurrence is not null)
  );
  return null;
end;
$$;

-- Venues Claude found have nobody in created_by, and don't post to the feed
-- one by one.
alter table public.wedding_venues alter column created_by drop not null;

create or replace function public.wedding_venue_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is not null then
    perform public.log_feed_event(new.household_id, new.created_by, 'wedding.venue_added', 'wedding_venue', new.id, 'Venue idea: ' || new.name, '{}'::jsonb);
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- The morning run saves its questions and results. p_items:
--   {"task_id", "kind": "ask",  "question"}
--   {"task_id", "kind": "done", "summary", "body", "links": [{title, url}],
--    "venues": [{name, url, note}]}
-- Only open one-off jobs in this household are touched; anything else is
-- skipped. Returns how many of each were saved.
-- -----------------------------------------------------------------------------
create or replace function public.agent_save_work(p_household_id uuid, p_day date, p_items jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_item jsonb;
  v_venue jsonb;
  v_job public.tasks;
  v_new uuid;
  v_wedding_category uuid;
  v_name text;
  v_url text;
  v_asked integer := 0;
  v_done integer := 0;
  v_venues integer := 0;
begin
  select task_category_id into v_wedding_category from public.wedding_settings where household_id = p_household_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) limit 10 loop
    select * into v_job from public.tasks
    where id = (v_item ->> 'task_id')::uuid and household_id = p_household_id
      and archived_at is null and status = 'active' and recurrence is null and ai_asks_task_id is null
    for update;
    continue when not found;

    if v_item ->> 'kind' = 'ask' then
      -- One open question a job, and none once the job has its result.
      continue when v_job.ai_result is not null
        or nullif(trim(v_item ->> 'question'), '') is null
        or exists (
          select 1 from public.tasks q
          where q.ai_asks_task_id = v_job.id and q.status = 'active' and q.archived_at is null and q.ai_answer is null
        );
      -- A task like any other, beside the job it is for: same list, category
      -- and person. created_by has to be a member, so it is the job's.
      insert into public.tasks (household_id, list_id, title, category_id, assignee_id, due_date, duration_minutes, created_by, ai_asks_task_id)
      values (p_household_id, v_job.list_id, left(trim(v_item ->> 'question'), 200), v_job.category_id, v_job.assignee_id, p_day, 5, v_job.created_by, v_job.id)
      returning id into v_new;
      -- One of you can answer, even when the job itself takes you both
      -- (wedding jobs start as needs_both).
      update public.tasks set needs_both = false where id = v_new and needs_both;
      v_asked := v_asked + 1;

    elsif v_item ->> 'kind' = 'done' then
      continue when nullif(trim(v_item ->> 'summary'), '') is null or nullif(trim(v_item ->> 'body'), '') is null;
      update public.tasks
      set ai_result = jsonb_build_object(
        'summary', left(trim(v_item ->> 'summary'), 80),
        'body', left(trim(v_item ->> 'body'), 3000),
        'links', case when jsonb_typeof(v_item -> 'links') = 'array' then v_item -> 'links' else '[]'::jsonb end,
        'day', p_day
      )
      where id = v_job.id;
      v_done := v_done + 1;

      -- Venues only from a job on the wedding checklist.
      if v_job.category_id is not null and v_job.category_id = v_wedding_category and jsonb_typeof(v_item -> 'venues') = 'array' then
        for v_venue in select value from jsonb_array_elements(v_item -> 'venues') limit 12 loop
          v_name := left(trim(v_venue ->> 'name'), 120);
          v_url := case when v_venue ->> 'url' ~* '^https?://' and char_length(v_venue ->> 'url') <= 500 then v_venue ->> 'url' end;
          continue when coalesce(v_name, '') = ''
            or exists (
              select 1 from public.wedding_venues w
              where w.household_id = p_household_id and (lower(w.name) = lower(v_name) or (v_url is not null and w.url = v_url))
            );
          insert into public.wedding_venues (household_id, name, url, note, created_by)
          values (p_household_id, v_name, v_url, nullif(left(trim(v_venue ->> 'note'), 300), ''), null);
          v_venues := v_venues + 1;
        end loop;
      end if;
    end if;
  end loop;

  return jsonb_build_object('asked', v_asked, 'done', v_done, 'venues', v_venues);
end;
$$;

revoke execute on function public.agent_save_work(uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.agent_save_work(uuid, date, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- Answering one of Claude's questions: the answer is kept on the question and
-- the question is ticked off as you, through complete_task_occurrence like any
-- other task. Either of you can answer. Answering again (after reopening it, or
-- to correct it) replaces the answer.
-- -----------------------------------------------------------------------------
create or replace function public.answer_ai_question(p_task_id uuid, p_answer text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_answer text := nullif(trim(p_answer), '');
  v_occurrence uuid;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found or not public.is_household_member(v_task.household_id) or v_task.ai_asks_task_id is null then
    raise exception 'Question not found' using errcode = 'P0002';
  end if;
  if v_answer is null or char_length(v_answer) > 500 then
    raise exception 'Answer in up to 500 characters' using errcode = '22023';
  end if;

  update public.tasks set ai_answer = v_answer where id = v_task.id;

  select id into v_occurrence from public.task_occurrences where task_id = v_task.id and status = 'open';
  if v_occurrence is not null then
    perform public.complete_task_occurrence(v_occurrence);
  end if;
end;
$$;

revoke execute on function public.answer_ai_question(uuid, text) from public, anon;
grant execute on function public.answer_ai_question(uuid, text) to authenticated;
