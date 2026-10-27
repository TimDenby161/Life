// Typical wedding costs as a starting budget. Rough figures for a wedding in
// the North of England in 2028 (about 70 day and 100 evening guests), in
// pounds. They're estimates, not quotes: every line says so in its notes.

export const STARTER_NOTE = 'Rough estimate – replace with your quote'

export const STARTER_BUDGET: { category: string; name: string; pounds: number }[] = [
  { category: 'Venue', name: 'Venue hire', pounds: 5000 },
  { category: 'Venue', name: 'Registrar and notice of marriage fees', pounds: 700 },
  { category: 'Food & drink', name: 'Wedding breakfast', pounds: 4900 },
  { category: 'Food & drink', name: 'Drinks (reception, wine and toast)', pounds: 1800 },
  { category: 'Food & drink', name: 'Evening food', pounds: 800 },
  { category: 'Food & drink', name: 'Cake', pounds: 400 },
  { category: 'Photography & video', name: 'Photographer', pounds: 1800 },
  { category: 'Photography & video', name: 'Videographer', pounds: 1500 },
  { category: 'Attire & beauty', name: 'Wedding outfits', pounds: 1900 },
  { category: 'Attire & beauty', name: 'Alterations', pounds: 250 },
  { category: 'Attire & beauty', name: 'Hair and make-up', pounds: 500 },
  { category: 'Attire & beauty', name: 'Shoes and accessories', pounds: 250 },
  { category: 'Flowers & decor', name: 'Flowers', pounds: 1000 },
  { category: 'Flowers & decor', name: 'Decor and styling', pounds: 500 },
  { category: 'Music & entertainment', name: 'Evening band or DJ', pounds: 1000 },
  { category: 'Music & entertainment', name: 'Ceremony music', pounds: 300 },
  { category: 'Stationery', name: 'Save the dates and invitations', pounds: 350 },
  { category: 'Stationery', name: 'On-the-day stationery', pounds: 150 },
  { category: 'Rings', name: 'Wedding rings', pounds: 1000 },
  { category: 'Transport', name: 'Wedding car', pounds: 400 },
  { category: 'Honeymoon', name: 'Honeymoon', pounds: 3000 },
  { category: 'Other', name: 'Favours', pounds: 150 },
  { category: 'Other', name: 'Gifts and thank-yous', pounds: 200 },
  { category: 'Other', name: 'Contingency', pounds: 1000 },
]

/** The starter lines not already in the budget (matched by name, ignoring case). */
export function missingStarterLines(existing: readonly { name: string }[]) {
  const have = new Set(existing.map((i) => i.name.trim().toLowerCase()))
  return STARTER_BUDGET.filter((l) => !have.has(l.name.toLowerCase()))
}
