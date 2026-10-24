// Integration seam for future bank connections and file imports.
//
// Nothing implements this yet. The data model is ready for it:
//   * financial_accounts.external_provider / external_account_id link an
//     account to a provider account (unique per household).
//   * financial_transactions.source ('manual' | 'import' | 'bank'),
//     external_id (unique per account, for idempotent re-syncs) and
//     import_batch_id (to review or undo an import).
//
// A bank connection (e.g. an Open Banking aggregator) needs OAuth tokens and
// API secrets, so it must run server-side in a Supabase Edge Function that
// writes transactions with source = 'bank'. Tokens belong in a table with no
// client grants (or Supabase Vault), never in a table the browser can read.
// A CSV import can run entirely in the browser with source = 'import'.

export type ImportedTransaction = {
  externalId: string
  occurredOn: string
  amountMinor: number
  description: string
  counterparty?: string
  suggestedCategoryId?: string | null
}

export interface TransactionSource {
  readonly id: string
  readonly label: string
  /** 'browser' sources (CSV) run client-side; 'server' sources run in an Edge Function. */
  readonly runtime: 'browser' | 'server'
  fetchTransactions(accountId: string, since?: string): Promise<ImportedTransaction[]>
}
