import '@fontsource-variable/schibsted-grotesk'
import '@renderer/styles/tokens.css'
import '@renderer/styles/hljs.css'
import './remote.css'
import { createRoot } from 'react-dom/client'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
