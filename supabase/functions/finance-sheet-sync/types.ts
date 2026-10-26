// Response shape of finance-sheet-sync, shared with the app (types only).
import type { SheetRow } from '../_shared/month-report.ts'

export type SyncRow = Omit<SheetRow, 'values'> & {
  accountId: string | null
  latest: { date: string; balanceMinor: number } | null
}

export type SheetSyncResult =
  | {
      status: 'ok'
      syncedAt: string
      dates: string[]
      rows: SyncRow[]
      sections: { label: string; matchesSheetTotal: boolean }[]
      suggestedSkip: string[]
      written: number
      removed: number
    }
  | { status: 'not_configured' | 'error'; message: string }
