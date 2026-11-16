import { describe, expect, it } from 'vitest'
import { VENUE_JOB as VENUE_JOB_TEST } from '../../../../supabase/functions/_shared/agents/work.ts'
import { venueSearchTitle, waitingAreas } from './venueSearch'

describe('venueSearchTitle', () => {
  it('puts the area in a title the routine sees as venue hunting', () => {
    const title = venueSearchTitle('  Surrey or  Sussex ')
    expect(title).toBe('Find wedding venues in Surrey or Sussex')
    expect(VENUE_JOB_TEST.test(title!)).toBe(true)
  })
  it('needs an area of sensible length', () => {
    expect(venueSearchTitle('  ')).toBeNull()
    expect(venueSearchTitle('x'.repeat(61))).toBeNull()
  })
})

describe('waitingAreas', () => {
  it('lists open searches without a result', () => {
    expect(
      waitingAreas([
        { title: 'Find wedding venues in Kent', done: false, ai_result: null },
        { title: 'Find wedding venues in Devon', done: false, ai_result: { summary: 'x' } },
        { title: 'Find wedding venues in Dorset', done: true, ai_result: null },
        { title: 'Book the venue', done: false, ai_result: null },
      ]),
    ).toEqual(['Kent'])
  })
})
