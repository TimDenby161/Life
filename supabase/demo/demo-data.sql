-- =============================================================================
-- LOCAL DEMO DATA. Fills the local seed household (tim@life.local /
-- sophie@life.local) with a year of plausible history so charts have
-- something to show. Run with:  npm run db:demo   (local stack only)
--
-- Never run against production. Re-running adds a second copy; use
-- `supabase db reset` to start clean.
-- =============================================================================
do $$
declare
  tim uuid := '11111111-1111-1111-1111-111111111111';
  sophie uuid := '22222222-2222-2222-2222-222222222222';
  hh uuid;
  joint_list uuid;
  tim_list uuid;
  sophie_list uuid;
  cat_bins uuid; cat_clean uuid; cat_admin uuid; cat_garden uuid; cat_cook uuid;
  fc record;
  a_joint uuid; a_save uuid; a_tim uuid; a_sophie uuid; a_isa uuid; a_card uuid; a_mortgage uuid;
  m integer;
  d date;
  start_month date := (date_trunc('month', current_date) - interval '11 months')::date;
  t record;
  occ_id uuid;
  v_task uuid;
  who uuid;
  i integer;
begin
  select household_id into hh from household_members where user_id = tim;
  select id into joint_list from task_lists where household_id = hh and kind = 'joint';
  select id into tim_list from task_lists where household_id = hh and owner_id = tim;
  select id into sophie_list from task_lists where household_id = hh and owner_id = sophie;
  select id into cat_bins from task_categories where household_id = hh and name = 'Bins & recycling';
  select id into cat_clean from task_categories where household_id = hh and name = 'Cleaning';
  select id into cat_admin from task_categories where household_id = hh and name = 'Admin & bills';
  select id into cat_garden from task_categories where household_id = hh and name = 'Garden';
  select id into cat_cook from task_categories where household_id = hh and name = 'Cooking';

  -- Finances ------------------------------------------------------------------
  insert into financial_accounts (household_id, name, institution, account_type, ownership, owner_id, opening_balance_minor, opening_date, created_by, sort_order)
  values (hh, 'Joint current', 'Monzo', 'current', 'joint', null, 240000, start_month, tim, 1) returning id into a_joint;
  insert into financial_accounts (household_id, name, institution, account_type, ownership, owner_id, opening_balance_minor, opening_date, created_by, sort_order)
  values (hh, 'Joint savings', 'Marcus', 'savings', 'joint', null, 650000, start_month, tim, 2) returning id into a_save;
  insert into financial_accounts (household_id, name, institution, account_type, ownership, owner_id, opening_balance_minor, opening_date, created_by, sort_order)
  values (hh, 'Tim current', 'Nationwide', 'current', 'personal', tim, 120000, start_month, tim, 3) returning id into a_tim;
  insert into financial_accounts (household_id, name, institution, account_type, ownership, owner_id, opening_balance_minor, opening_date, created_by, sort_order)
  values (hh, 'Sophie current', 'Starling', 'current', 'personal', sophie, 180000, start_month, sophie, 4) returning id into a_sophie;
  insert into financial_accounts (household_id, name, institution, account_type, ownership, owner_id, opening_balance_minor, opening_date, created_by, sort_order)
  values (hh, 'Sophie S&S ISA', 'Vanguard', 'investment', 'personal', sophie, 1450000, start_month, sophie, 5) returning id into a_isa;
  insert into financial_accounts (household_id, name, institution, account_type, ownership, owner_id, opening_balance_minor, opening_date, created_by, sort_order)
  values (hh, 'Tim credit card', 'Amex', 'credit_card', 'personal', tim, -32000, start_month, tim, 6) returning id into a_card;
  insert into financial_accounts (household_id, name, institution, account_type, ownership, owner_id, opening_balance_minor, opening_date, created_by, sort_order)
  values (hh, 'Mortgage', 'Halifax', 'mortgage', 'joint', null, -18450000, start_month, tim, 7) returning id into a_mortgage;

  for m in 0..11 loop
    d := (start_month + make_interval(months => m))::date;
    exit when d > current_date;
    -- Salaries into personal accounts, then contributions to the joint account.
    insert into financial_transactions (household_id, account_id, occurred_on, amount_minor, kind, category_id, description, created_by)
    select hh, a_tim, least(d + 24, current_date), 285000, 'income', id, 'Salary', tim from finance_categories where household_id = hh and name = 'Salary';
    insert into financial_transactions (household_id, account_id, occurred_on, amount_minor, kind, category_id, description, created_by)
    select hh, a_sophie, least(d + 27, current_date), 262000, 'income', id, 'Salary', sophie from finance_categories where household_id = hh and name = 'Salary';
    if d + 25 <= current_date then
      perform set_config('request.jwt.claims', json_build_object('sub', tim)::text, true);
      perform create_transfer(a_tim, a_joint, 140000, d + 25, 'Joint contribution');
      perform create_transfer(a_joint, a_mortgage, 96500, d + 1 + 27, 'Mortgage payment');
      perform create_transfer(a_joint, a_save, 30000, d + 26, 'Monthly saving');
    end if;
    if d + 28 <= current_date then
      perform set_config('request.jwt.claims', json_build_object('sub', sophie)::text, true);
      perform create_transfer(a_sophie, a_joint, 140000, d + 28, 'Joint contribution');
      perform create_transfer(a_sophie, a_isa, 25000, d + 28, 'ISA contribution');
    end if;

    -- Joint spending.
    for fc in select id, name from finance_categories where household_id = hh and kind = 'expense' loop
      if fc.name = 'Groceries' then
        for i in 0..3 loop
          if d + 3 + i * 7 <= current_date then
            insert into financial_transactions (household_id, account_id, occurred_on, amount_minor, kind, category_id, description, created_by)
            values (hh, a_joint, d + 3 + i * 7, -(7200 + abs(hashtext(d::text || i)) % 3800), 'expense', fc.id,
                    (array['Sainsbury''s', 'Tesco', 'Aldi', 'Co-op'])[1 + i], case when i % 2 = 0 then tim else sophie end);
          end if;
        end loop;
      elsif fc.name = 'Utilities' and d + 5 <= current_date then
        insert into financial_transactions (household_id, account_id, occurred_on, amount_minor, kind, category_id, description, created_by)
        values (hh, a_joint, d + 5, -(14500 + (case when extract(month from d) in (11, 12, 1, 2) then 6000 else 0 end)), 'expense', fc.id, 'Octopus Energy', tim),
               (hh, a_joint, d + 6, -3850, 'expense', fc.id, 'Water', tim),
               (hh, a_joint, d + 7, -16200, 'expense', fc.id, 'Council tax', tim);
      elsif fc.name = 'Eating out' and d + 12 <= current_date then
        insert into financial_transactions (household_id, account_id, occurred_on, amount_minor, kind, category_id, description, created_by)
        values (hh, a_joint, d + 12, -(4500 + abs(hashtext(d::text)) % 6000), 'expense', fc.id, 'Dinner out', sophie);
        insert into financial_transactions (household_id, account_id, occurred_on, amount_minor, kind, category_id, description, created_by)
        values (hh, a_card, d + 19, -(2800 + abs(hashtext(d::text || 'x')) % 3000), 'expense', fc.id, 'Lunch', tim);
      elsif fc.name = 'Subscriptions' and d + 2 <= current_date then
        insert into financial_transactions (household_id, account_id, occurred_on, amount_minor, kind, category_id, description, created_by)
        values (hh, a_joint, d + 2, -1799, 'expense', fc.id, 'Netflix', tim), (hh, a_card, d + 9, -1199, 'expense', fc.id, 'Spotify', tim);
      elsif fc.name = 'Transport' and d + 15 <= current_date then
        insert into financial_transactions (household_id, account_id, occurred_on, amount_minor, kind, category_id, description, created_by)
        values (hh, a_tim, d + 15, -(6000 + abs(hashtext(d::text || 't')) % 2500), 'expense', fc.id, 'Fuel', tim),
               (hh, a_sophie, d + 16, -(4200 + abs(hashtext(d::text || 's')) % 1500), 'expense', fc.id, 'Train', sophie);
      elsif fc.name = 'Entertainment' and d + 20 <= current_date then
        insert into financial_transactions (household_id, account_id, occurred_on, amount_minor, kind, category_id, description, created_by)
        values (hh, a_joint, d + 20, -(2400 + abs(hashtext(d::text || 'e')) % 4000), 'expense', fc.id, 'Cinema / gigs', sophie);
      elsif fc.name = 'Shopping' and d + 10 <= current_date then
        insert into financial_transactions (household_id, account_id, occurred_on, amount_minor, kind, category_id, description, created_by)
        values (hh, a_sophie, d + 10, -(3500 + abs(hashtext(d::text || 'sh')) % 9000), 'expense', fc.id, 'Clothes', sophie);
      end if;
    end loop;
    -- Tim pays the card off from his current account.
    if d + 22 <= current_date then
      perform set_config('request.jwt.claims', json_build_object('sub', tim)::text, true);
      perform create_transfer(a_tim, a_card, 9000, d + 22, 'Card payment');
    end if;
    -- Quarterly ISA valuations (recorded data).
    if m % 3 = 2 then
      insert into account_balance_history (household_id, account_id, as_of, balance_minor, note, created_by)
      values (hh, a_isa, least((d + interval '1 month' - interval '1 day')::date, current_date), 1450000 + (m + 1) * 25000 + (m + 1) * 9000, 'Vanguard valuation', sophie);
    end if;
  end loop;

  insert into budgets (household_id, category_id, amount_minor, starts_month, created_by)
  select hh, id, case name when 'Groceries' then 40000 when 'Eating out' then 15000 when 'Entertainment' then 6000 else 5000 end, start_month, tim
  from finance_categories where household_id = hh and name in ('Groceries', 'Eating out', 'Entertainment', 'Shopping');

  insert into savings_goals (household_id, name, target_minor, target_date, account_id, ownership, created_by)
  values (hh, 'Italy holiday', 1200000, (current_date + interval '8 months')::date, a_save, 'joint', sophie);
  insert into savings_goals (household_id, name, target_minor, manual_saved_minor, ownership, owner_id, created_by)
  values (hh, 'New bike', 120000, 45000, 'personal', tim, tim);

  -- Tasks with history -------------------------------------------------------
  -- Recurring tasks and their past occurrences (inserted directly: the RPCs
  -- only ever complete current work).
  for t in
    select * from (values
      ('Bins out', joint_list, tim, cat_bins, '{"freq":"weekly","weekdays":[2]}'::jsonb, 7, 0.7),
      ('Hoover downstairs', joint_list, sophie, cat_clean, '{"freq":"weekly","weekdays":[6]}'::jsonb, 7, 0.4),
      ('Water the plants', joint_list, null::uuid, cat_garden, '{"freq":"weekly","weekdays":[1,4]}'::jsonb, 3, 0.5),
      ('Meal plan for the week', sophie_list, sophie, cat_cook, '{"freq":"weekly","weekdays":[7]}'::jsonb, 7, 0.15),
      ('Check bills & budget', tim_list, tim, cat_admin, '{"freq":"monthly","monthDay":1}'::jsonb, 30, 0.9)
    ) as x (title, list_id, assignee, cat, rule, step, tim_share)
  loop
    insert into tasks (household_id, list_id, title, assignee_id, category_id, due_date, recurrence, created_by, created_at)
    values (hh, t.list_id, t.title, t.assignee, t.cat, current_date - 84, t.rule, coalesce(t.assignee, tim), now() - interval '85 days')
    returning id into v_task;
    -- Replace the generated first occurrence with a backfilled history.
    delete from task_occurrences where task_occurrences.task_id = v_task;
    i := 0;
    d := recurrence_next_date(t.rule, current_date - 84, current_date - 85);
    while d is not null and d < current_date loop
      i := i + 1;
      who := case when (abs(hashtext(t.title || d::text)) % 100) < t.tim_share * 100 then tim else sophie end;
      if abs(hashtext(d::text || t.title)) % 11 = 0 then
        insert into task_occurrences (household_id, task_id, sequence, due_date, assignee_id, status, created_at)
        values (hh, v_task, i, d, t.assignee, 'skipped', d - 7) returning id into occ_id;
        insert into task_completion_events (household_id, occurrence_id, task_id, event_type, occurred_at, recorded_by, task_title, list_id, category_id, category_name, assignee_id, due_date, is_recurring, occurrence_sequence)
        values (hh, occ_id, v_task, 'skipped', d + time '20:00', who, t.title, t.list_id, t.cat, (select name from task_categories where id = t.cat), t.assignee, d, true, i);
      else
        insert into task_occurrences (household_id, task_id, sequence, due_date, assignee_id, status, completed_at, completed_by, created_at)
        values (hh, v_task, i, d, t.assignee, 'done', d + (abs(hashtext(d::text)) % 2) + time '19:30', who, d - 7) returning id into occ_id;
        insert into task_completion_events (household_id, occurrence_id, task_id, event_type, completed_by, recorded_by, occurred_at, task_title, list_id, category_id, category_name, assignee_id, due_date, is_recurring, occurrence_sequence, occurrence_created_at)
        values (hh, occ_id, v_task, 'completed', who, who, d + (abs(hashtext(d::text)) % 2) + time '19:30', t.title, t.list_id, t.cat, (select name from task_categories where id = t.cat), t.assignee, d, true, i, d - 7);
      end if;
      d := recurrence_next_date(t.rule, current_date - 84, d);
    end loop;
    insert into task_occurrences (household_id, task_id, sequence, due_date, assignee_id)
    values (hh, v_task, i + 1, coalesce(d, current_date), t.assignee);
  end loop;

  -- One-off tasks: some open, some done.
  perform set_config('request.jwt.claims', json_build_object('sub', sophie)::text, true);
  insert into tasks (household_id, list_id, title, assignee_id, category_id, due_date, priority, created_by)
  values (hh, joint_list, 'Book boiler service', tim, cat_admin, current_date - 2, 'high', sophie),
         (hh, joint_list, 'Buy birthday present for Mum', sophie, null, current_date + 5, 'normal', sophie),
         (hh, sophie_list, 'Renew passport', sophie, cat_admin, current_date + 20, 'normal', sophie),
         (hh, tim_list, 'Fix the shed door', tim, null, null, 'low', sophie),
         (hh, joint_list, 'Order new duvet', null, null, current_date, 'normal', sophie);
  insert into feed_posts (household_id, author_id, body, created_at)
  values (hh, sophie, 'Don''t forget we''re at Jess''s on Saturday — I said we''d bring dessert 🍰', now() - interval '3 hours'),
         (hh, tim, 'Boiler engineer can come Thursday morning. I''ll work from home.', now() - interval '1 day');
end;
$$;

-- Health ---------------------------------------------------------------------
do $$
declare
  tim uuid := '11111111-1111-1111-1111-111111111111';
  sophie uuid := '22222222-2222-2222-2222-222222222222';
  hh uuid;
  d date;
  i integer := 0;
  metric record;
begin
  select household_id into hh from household_members where user_id = tim;
  -- Everything is shared by default; no category settings needed.
  insert into health_periods (household_id, user_id, started_on, ended_on)
  select hh, sophie, current_date - 100 + n * 29 + (n % 2), current_date - 96 + n * 29 + (n % 2)
  from generate_series(0, 3) as n;

  for d in select generate_series(current_date - 90, current_date - 1, interval '1 day')::date loop
    i := i + 1;
    for metric in select id, key from health_metric_definitions where owner_id is null and key = 'weight' loop
      if metric.key = 'weight' and i % 3 = 0 then
        insert into health_measurements (household_id, user_id, metric_id, measured_at, value)
        values (hh, tim, metric.id, d + time '07:10', round((84.5 - i * 0.03 + (abs(hashtext(d::text)) % 10) / 20.0)::numeric, 1));
      end if;
    end loop;
    if i % 4 = 1 then
      insert into health_exercise_sessions (household_id, user_id, description, started_at, duration_minutes)
      values (hh, tim, 'Run around the park', d + time '18:30', 28 + abs(hashtext(d::text)) % 20);
    elsif i % 5 = 2 then
      insert into health_exercise_sessions (household_id, user_id, description, started_at, duration_minutes)
      values (hh, sophie, 'Pilates class', d + time '19:00', 45);
    end if;
  end loop;
end;
$$;
