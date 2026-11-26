/**
 * Whether this page is shown inside another site's frame. GitHub Pages can't send the headers that
 * forbid framing (frame-ancestors, X-Frame-Options), so the app checks for itself: framed by
 * anything but itself, it doesn't start (a framed sign-in or task list could be clickjacked).
 * A cross-origin parent can't be read, which is itself the answer.
 */
export function framedByAnotherSite(win: Window = window): boolean {
  if (win.top === win.self) return false
  try {
    return win.top!.location.origin !== win.location.origin
  } catch {
    return true
  }
}
