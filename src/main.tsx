import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import 'maplibre-gl/dist/maplibre-gl.css'
import './styles.css'
import './theme.css'
import { syncBrowserTheme } from './util/theme'

syncBrowserTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
