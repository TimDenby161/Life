import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskCheck } from './TaskRow'

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
