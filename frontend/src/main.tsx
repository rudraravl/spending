import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import SpendingApp from './SpendingApp'
import MuiThemeProvider from './MuiThemeProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MuiThemeProvider>
      <SpendingApp />
    </MuiThemeProvider>
  </StrictMode>,
)
