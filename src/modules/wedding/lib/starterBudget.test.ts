import { BUDGET_CATEGORIES } from '../components/BudgetTab'
import { missingStarterLines, STARTER_BUDGET } from './starterBudget'

describe('starter budget', () => {
  it('uses the budget categories and whole pounds', () => {
    for (const l of STARTER_BUDGET) {
      expect(BUDGET_CATEGORIES).toContain(l.category)
      expect(Number.isInteger(l.pounds) && l.pounds > 0).toBe(true)
    }
    expect(STARTER_BUDGET.reduce((a, l) => a + l.pounds, 0)).toBe(28_850)
  })

  it('skips lines already in the budget', () => {
    const missing = missingStarterLines([{ name: 'venue hire ' }, { name: 'Photographer' }])
    expect(missing).toHaveLength(STARTER_BUDGET.length - 2)
    expect(missing.some((l) => l.name === 'Venue hire')).toBe(false)
  })
})
