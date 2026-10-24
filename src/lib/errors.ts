// Maps Postgres / PostgREST / network errors to calm, human messages.
// Never include record contents in messages (they may hold health/financial data).

type MaybePgError = { code?: string; message?: string; status?: number; name?: string }

export function getErrorMessage(error: unknown): string {
  if (!error) return 'Something went wrong.'
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return "You're offline. Changes can't be saved until you reconnect."
  }
  const e = error as MaybePgError
  switch (e.code) {
    case '42501':
      return e.message?.startsWith('Only') ? e.message : "You don't have permission to do that."
    case '23505':
      return 'That already exists.'
    case '23503':
      return 'That refers to something that no longer exists.'
    case '23514':
      return e.message?.startsWith('A transfer') ? e.message : 'Some of the values are not allowed.'
    case 'P0001':
    case 'P0002':
    case '22023':
      return e.message ?? 'That action is not possible.'
    case 'PGRST116':
      return 'Not found.'
  }
  if (e.name === 'TypeError' && /fetch/i.test(e.message ?? '')) {
    return "Couldn't reach the server. Check your connection."
  }
  if (e.name === 'AuthApiError' || e.name === 'AuthError') return e.message ?? 'Authentication failed.'
  return e.message && e.message.length < 160 ? e.message : 'Something went wrong.'
}
