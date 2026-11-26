import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { framedByAnotherSite } from './lib/framed'
import './index.css'

const root = document.getElementById('root')!
if (framedByAnotherSite()) {
  // Shown inside another site: nothing to click but a way out (L-010)
  const link = Object.assign(document.createElement('a'), { href: window.location.href, target: '_top', rel: 'noopener', textContent: 'Open Life' })
  link.className = 'm-6 inline-block underline'
  root.replaceChildren(link)
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
