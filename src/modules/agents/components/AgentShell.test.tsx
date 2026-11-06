import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { PAGE_AGENTS } from '../pageAgents'
import { AgentShell } from './AgentShell'

vi.mock('./AgentView', () => ({ default: () => <p>agent suggestions</p> }))

function Page() {
  const { search } = useLocation()
  return <p>finance page{search}</p>
}

const at = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/finances/*" element={<AgentShell scope={PAGE_AGENTS.finances} base="/finances" title="Finances" page={Page} />} />
      </Routes>
    </MemoryRouter>,
  )

describe('AgentShell', () => {
  it('opens on the agent view with the page title', async () => {
    at('/finances')
    expect(await screen.findByText('agent suggestions')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Finances' })).toBeInTheDocument()
    expect(screen.queryByText(/finance page/)).not.toBeInTheDocument()
  })

  it('switches to the page itself under Details, and back', async () => {
    at('/finances')
    await userEvent.click(screen.getByRole('radio', { name: 'Details' }))
    expect(screen.getByText('finance page?view=details')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: /Finance/ }))
    expect(await screen.findByText('agent suggestions')).toBeInTheDocument()
  })

  it('keeps Home bare: no visible title or description', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<AgentShell scope={PAGE_AGENTS.home} base="/" title="Home" page={Page} />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('agent suggestions')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Home' })).toHaveClass('sr-only')
    expect(screen.queryByText(PAGE_AGENTS.home.description)).not.toBeInTheDocument()
  })

  it('goes straight to the page for a link into it', () => {
    at('/finances?account=abc')
    expect(screen.getByText('finance page?account=abc')).toBeInTheDocument()
  })
})
