// Suggestions for turning MonthReport sheet rows into accounts. Only defaults:
// the link dialog shows them and every account stays editable afterwards.
import type { SyncRow } from '../../../../supabase/functions/finance-sheet-sync/types.ts'

export type AccountSuggestion = {
  name: string
  institution: string | null
  account_type: 'current' | 'savings' | 'credit_card' | 'mortgage' | 'investment' | 'pension' | 'other'
  ownership: 'joint' | 'personal'
  owner_id: string | null
}

type Member = { id: string; display_name: string }

const TYPE_RULES: [RegExp, AccountSuggestion['account_type']][] = [
  [/mortgage/i, 'mortgage'],
  [/pension/i, 'pension'],
  [/\b(lisa|isa|stocks|shares|bitcoin|crypto|trading ?212|coinbase|freetrade|vanguard)\b/i, 'investment'],
  [/sav(er|ing)|reserve|holiday|service|pot\b/i, 'savings'],
  [/house|property|car\b/i, 'other'],
  [/current|main|personal|joint|everyday/i, 'current'],
]

export function suggestAccount(row: Pick<SyncRow, 'institution' | 'name' | 'owner' | 'sectionKind'>, members: readonly Member[]): AccountSuggestion {
  const text = `${row.institution} ${row.name}`
  const account_type = row.sectionKind === 'negative' ? 'credit_card' : (TYPE_RULES.find(([re]) => re.test(text))?.[1] ?? 'other')
  // Owner: the section's person ("Tim Positive"), else a member named in the
  // row ("Sophie Pension"), else joint ("Joint", "Long Term" mortgage, House).
  const byName = (s: string | null) => members.find((m) => s && new RegExp(`\\b${m.display_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(s))
  const owner = byName(row.owner) ?? (row.owner ? undefined : byName(text))
  return {
    name: row.institution ? `${row.institution} ${row.name}` : row.name,
    institution: row.institution || null,
    account_type,
    ownership: owner ? 'personal' : 'joint',
    owner_id: owner?.id ?? null,
  }
}

/**
 * Rows to skip unless chosen: the sheet's own totals (summary rows other than
 * property) and rows the sheet's arithmetic shows aren't counted.
 */
export function skipByDefault(row: Pick<SyncRow, 'key' | 'name' | 'sectionKind'>, suggestedSkip: readonly string[]): boolean {
  if (row.sectionKind === 'summary') return !/house|property/i.test(row.name)
  return suggestedSkip.includes(row.key)
}

/**
 * A row's choice in the link dialog: skip it, make a new account from it, add
 * it to a new account another row is making (`new:<that row's key>`), or link
 * it to an existing account (its id).
 */
export type RowChoice = 'skip' | 'create' | `new:${string}` | (string & {})

export type LinkPlan = {
  /** Rows that each make a new account (the account's first row). */
  creates: string[]
  /** Every row's target: an existing account id, the key of the row making its new account, or null. */
  targets: Map<string, { accountId: string } | { newFrom: string } | null>
  /** Accounts that were linked and no longer have any rows: archive, or their last balance double counts. */
  orphaned: string[]
}

export function planLinks(rows: readonly Pick<SyncRow, 'key' | 'accountId'>[], choices: Readonly<Record<string, RowChoice>>): LinkPlan {
  const creates = rows.filter((r) => choices[r.key] === 'create').map((r) => r.key)
  const targets: LinkPlan['targets'] = new Map()
  for (const r of rows) {
    const c = choices[r.key] ?? 'skip'
    if (c === 'skip') targets.set(r.key, null)
    else if (c === 'create') targets.set(r.key, { newFrom: r.key })
    else if (c.startsWith('new:')) {
      const from = c.slice(4)
      // The other row stopped making an account: this row makes its own.
      if (creates.includes(from)) targets.set(r.key, { newFrom: from })
      else {
        creates.push(r.key)
        targets.set(r.key, { newFrom: r.key })
      }
    } else targets.set(r.key, { accountId: c })
  }
  const stillLinked = new Set([...targets.values()].flatMap((t) => (t && 'accountId' in t ? [t.accountId] : [])))
  const orphaned = [...new Set(rows.flatMap((r) => (r.accountId && !stillLinked.has(r.accountId) ? [r.accountId] : [])))]
  return { creates, targets, orphaned }
}
