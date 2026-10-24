import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginPage } from './LoginPage'

const signInWithPassword = vi.fn()
const resetPasswordForEmail = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signInWithPassword: (...a: unknown[]) => signInWithPassword(...a), resetPasswordForEmail: (...a: unknown[]) => resetPasswordForEmail(...a) } },
}))

describe('LoginPage', () => {
  beforeEach(() => {
    signInWithPassword.mockReset()
    resetPasswordForEmail.mockReset()
  })

  it('signs in with email and password', async () => {
    signInWithPassword.mockResolvedValue({ error: null })
    render(<LoginPage />)
    await userEvent.type(screen.getByLabelText('Email'), ' tim@example.com ')
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'tim@example.com', password: 'correct horse' })
  })

  it('shows a friendly message for wrong credentials', async () => {
    signInWithPassword.mockResolvedValue({ error: Object.assign(new Error('Invalid login credentials'), { code: 'invalid_credentials' }) })
    render(<LoginPage />)
    await userEvent.type(screen.getByLabelText('Email'), 'tim@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.')
  })

  it('offers a password reset without revealing whether an account exists', async () => {
    resetPasswordForEmail.mockResolvedValue({ error: null })
    render(<LoginPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Forgot your password?' }))
    await userEvent.type(screen.getByLabelText('Email'), 'someone@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByRole('status')).toHaveTextContent('If that address has an account')
  })

  it('does not offer self-registration', () => {
    render(<LoginPage />)
    expect(screen.queryByText(/sign up|create account|register/i)).toBeNull()
  })
})
