import { AlertTriangle } from 'lucide-react'
import { Component, type ReactNode } from 'react'
import { Button } from './ui/button'

/** Last line of defence for render errors. Never shows raw data or stack traces. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }

  componentDidCatch(error: Error) {
    // Log only the message: component props/state may contain personal data.
    console.error('Life render error:', error.message)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="flex flex-col items-center gap-3 py-16 text-center">
        <AlertTriangle className="size-6 text-destructive" />
        <p className="font-medium">Something went wrong on this page.</p>
        <p className="max-w-sm text-sm text-muted-foreground">Your data is safe. Reloading usually fixes it.</p>
        <Button variant="outline" onClick={() => window.location.reload()}>Reload</Button>
      </div>
    )
  }
}
