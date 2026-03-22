import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import SpendingApp from './SpendingApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SpendingApp />
  </StrictMode>,
)
