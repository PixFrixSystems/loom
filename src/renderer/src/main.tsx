import { createRoot } from 'react-dom/client'
import { App } from './App'
import { startWearingLook } from './lib/look'
import { startWearingThemes } from './lib/theme'
import { Popout } from './Popout'
import { POPOUT_TAB } from './store'
import '@fontsource-variable/schibsted-grotesk'
import './styles/base.css'
import './styles/shell.css'
import './styles/chat.css'
import './styles/panels.css'
import './styles/hljs.css'
import './styles/look.css'

startWearingThemes()
startWearingLook()

createRoot(document.getElementById('root')!).render(POPOUT_TAB ? <Popout /> : <App />)
