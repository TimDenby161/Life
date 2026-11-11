-- =============================================================================
-- Holidays (/holidays): every upcoming trip with what it costs, what's paid,
-- and a link to its plan (the trip page on claude.ai).
--
-- trips gains:
--   cost_minor   rough cost for both of you, from the plan (pence).
--   paid_minor   what's been paid so far.
--   plan_url     the trip page; only https links.
--   confirmed    going (true) or still an idea (false). Ideas show on
--                Holidays but the Travel agent leaves them alone, so two
--                alternatives for the same weeks don't both nag for bookings.
--
-- Also fills in the trips from Tim's seven trip pages (dates, cost, paid and
-- link as each page showed them on 11 Nov 2026), updating trips of the same
-- name and adding the rest; only in a household that already has the
-- Central America trip.
-- =============================================================================

alter table public.trips
  add column cost_minor bigint check (cost_minor is null or cost_minor between 0 and 100000000),
  add column paid_minor bigint not null default 0 check (paid_minor between 0 and 100000000),
  add column plan_url text check (plan_url is null or (char_length(plan_url) <= 300 and plan_url ~ '^https://')),
  add column confirmed boolean not null default true;

grant insert (cost_minor, paid_minor, plan_url, confirmed), update (cost_minor, paid_minor, plan_url, confirmed) on public.trips to authenticated;

do $$
declare
  v_hh uuid;
  v_by uuid;
  t record;
  v_id uuid;
begin
  for v_hh in select distinct household_id from public.trips where name ilike 'central america%' loop
    select user_id into v_by from public.household_members where household_id = v_hh order by (role = 'owner') desc, joined_at limit 1;
    for t in
      select * from (values
        ('Central America', 'central america%', date '2027-02-27', date '2027-03-14', 360750::bigint, 151300::bigint, 'https://claude.ai/artifact/7Tm8wQd2ZezWCcVMVMs3Ra', true),
        ('China', 'china%', date '2027-04-10', date '2027-04-30', 502200, 0, 'https://claude.ai/artifact/GWVmaAUmevUkTHXDNi3zbs', true),
        ('Patagonia + Antarctica', '%antarctica%', date '2029-01-20', date '2029-02-28', 2699500, 0, 'https://claude.ai/artifact/2touxA693sLJhcGX94qFvF', true),
        ('Japan in Spring', 'japan%', date '2027-03-27', date '2027-04-11', 573600, 0, 'https://claude.ai/artifact/B8gMxu5H2qypMaFg7Z83k6', false),
        ('Andalusia', 'andalusia%', date '2027-05-08', date '2027-05-15', 202800, 0, 'https://claude.ai/artifact/Ntn9WMmLdK6tJLh7DZUyhq', false),
        ('Lofoten Islands', 'lofoten%', date '2027-09-04', date '2027-09-11', 379600, 0, 'https://claude.ai/artifact/8eJramkhSR6mC3GchrKnwe', false),
        ('Athens + Crete', 'athens%', date '2027-09-11', date '2027-09-21', 410100, 0, 'https://claude.ai/artifact/LpeJjRiFAFfZz8iw3dHfNj', false)
      ) as v(name, pattern, starts_on, ends_on, cost, paid, url, confirmed)
    loop
      select id into v_id from public.trips where household_id = v_hh and name ilike t.pattern order by starts_on limit 1;
      if v_id is not null then
        -- An existing trip is one you're going on; its dates come from the plan.
        update public.trips
          set name = t.name, starts_on = t.starts_on, ends_on = t.ends_on, cost_minor = t.cost, paid_minor = t.paid, plan_url = t.url
          where id = v_id;
      else
        insert into public.trips (household_id, name, starts_on, ends_on, abroad, cost_minor, paid_minor, plan_url, confirmed, created_by)
        values (v_hh, t.name, t.starts_on, t.ends_on, true, t.cost, t.paid, t.url, t.confirmed, v_by);
      end if;
    end loop;
  end loop;
end;
$$;
