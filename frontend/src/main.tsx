import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import KeepApp from './KeepApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <KeepApp />
  </StrictMode>,
)
