import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskCheck, WhoDidIt } from './TaskRow'

describe('TaskCheck', () => {
  it('is an accessible checkbox that toggles without bubbling to the row', async () => {
    const onToggle = vi.fn()
    const onRow = vi.fn()
    render(
      <div onClick={onRow}>
        <TaskCheck done={false} onToggle={onToggle} label="Complete Bins out" />
      </div>,
    )
    const box = screen.getByRole('checkbox', { name: 'Complete Bins out' })
    expect(box).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(box)
    expect(onToggle).toHaveBeenCalledOnce()
    expect(onRow).not.toHaveBeenCalled()
  })
})

vi.mock('@/modules/household/HouseholdProvider', () => {
  const tim = { id: 'tim', display_name: 'Tim' }
  const sophie = { id: 'sophie', display_name: 'Sophie' }
  return { useHousehold: () => ({ me: sophie, members: [tim, sophie] }) }
})

describe('WhoDidIt', () => {
  it('offers me first, then my partner, then both, without bubbling to the row', async () => {
    const onComplete = vi.fn()
    const onRow = vi.fn()
    render(
      <div onClick={onRow}>
        <WhoDidIt title="Bins out" onComplete={onComplete} />
      </div>,
    )
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['S', 'T', 'B'])
    await userEvent.click(screen.getByRole('button', { name: 'Tim did Bins out' }))
    expect(onComplete).toHaveBeenLastCalledWith('tim', null)
    await userEvent.click(screen.getByRole('button', { name: 'We both did Bins out' }))
    expect(onComplete).toHaveBeenLastCalledWith('sophie', 'tim')
    expect(onRow).not.toHaveBeenCalled()
  })
})
