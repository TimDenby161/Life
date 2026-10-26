-- =============================================================================
-- Short display names for sheet rows.
--
-- A combined account lists the sheet rows behind it ("Santander · Sophos",
-- "Coinbase · Bitcoin"). label lets the household call a row something
-- shorter ("Santander", "Bitcoin"); the sync writes it into each balance's
-- breakdown. Null keeps the sheet's own "Institution · Name".
-- =============================================================================

alter table public.finance_sheet_links
  add column label text check (label is null or char_length(trim(label)) between 1 and 60);

grant insert (label), update (label) on public.finance_sheet_links to authenticated;

-- Saving the link dialog must keep each row's label, so links are updated in
-- place rather than deleted and re-created.
create or replace function public.replace_sheet_links(p_household_id uuid, p_links jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.finance_sheet_links l
  using jsonb_to_recordset(p_links) x(row_key text, account_id uuid)
  where l.household_id = p_household_id and l.row_key = x.row_key and x.account_id is null;

  insert into public.finance_sheet_links (household_id, account_id, row_key)
  select p_household_id, x.account_id, x.row_key
  from jsonb_to_recordset(p_links) x(row_key text, account_id uuid)
  where x.account_id is not null
  on conflict (household_id, row_key) do update set account_id = excluded.account_id
    where public.finance_sheet_links.account_id is distinct from excluded.account_id;
end;
$$;

grant update (account_id) on public.finance_sheet_links to authenticated;
