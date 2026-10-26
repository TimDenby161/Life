-- =============================================================================
-- Physical assets and estimated values.
--
-- * Account types 'property' and 'vehicle' for the home and cars, counted in
--   net worth like any other asset.
-- * account_balance_history.source = 'estimate' marks a value that is a
--   judgement (an index-based house price, a car's market value), not a
--   statement, so the app always labels it as estimated.
-- =============================================================================

alter table public.financial_accounts drop constraint financial_accounts_account_type_check;
alter table public.financial_accounts add constraint financial_accounts_account_type_check
  check (account_type in ('current', 'savings', 'credit_card', 'loan', 'mortgage', 'investment', 'pension',
                          'cash', 'property', 'vehicle', 'other'));

alter table public.account_balance_history drop constraint account_balance_history_source_check;
alter table public.account_balance_history add constraint account_balance_history_source_check
  check (source in ('manual', 'sheet', 'estimate'));

-- People choose between a recorded and an estimated value. 'sheet' rows are
-- only written by apply_sheet_balances.
grant insert (source), update (source) on public.account_balance_history to authenticated;

create policy "account_balance_history: sheet rows only via sync" on public.account_balance_history
  as restrictive for insert to authenticated
  with check (source <> 'sheet');
-- Editing a sheet balance by hand turns it into a recorded or estimated one.
create policy "account_balance_history: sheet label only via sync" on public.account_balance_history
  as restrictive for update to authenticated
  using (true) with check (source <> 'sheet');
