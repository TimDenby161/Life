import { getErrorMessage } from './errors'

describe('getErrorMessage', () => {
  it('maps Postgres permission errors to a calm message', () => {
    expect(getErrorMessage({ code: '42501', message: 'new row violates row-level security policy' })).toBe("You don't have permission to do that.")
  })
  it('keeps our own explanatory messages', () => {
    expect(getErrorMessage({ code: '42501', message: 'Only the author can edit a post' })).toBe('Only the author can edit a post')
    expect(getErrorMessage({ code: 'P0001', message: 'This task is already done' })).toBe('This task is already done')
  })
  it('hides long internal messages', () => {
    expect(getErrorMessage({ message: 'x'.repeat(300) })).toBe('Something went wrong.')
  })
  it('explains offline failures', () => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    expect(getErrorMessage(new Error('fail'))).toMatch(/offline/)
    spy.mockRestore()
  })
})
