import { createRoot } from 'react-dom/client'
import type { ThemeName } from '@shared/types'
import { App } from './App'
import { Popout } from './Popout'
import { POPOUT_TAB, useStore } from './store'
import '@fontsource-variable/schibsted-grotesk'
import './styles/base.css'
import './styles/shell.css'
import './styles/chat.css'
import './styles/panels.css'
import './styles/hljs.css'

// tokens.css swaps the colours by data-theme on <html>. The main process names the saved theme in
// the page's address, so it is worn before the saved state loads; after that it follows the setting.
const wear = (theme: ThemeName | undefined): void => {
  document.documentElement.dataset.theme = theme ?? 'loom'
}
wear((new URLSearchParams(location.search).get('theme') as ThemeName | null) ?? undefined)
useStore.subscribe((now, before) => {
  if (now.settings.theme !== before.settings.theme) wear(now.settings.theme)
})

createRoot(document.getElementById('root')!).render(POPOUT_TAB ? <Popout /> : <App />)
