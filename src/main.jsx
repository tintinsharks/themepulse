import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

// Auto-recover once when an open tab tries to load a stale lazy chunk after a new deploy
const CHUNK_RELOAD_KEY = 'tp_chunk_reload_at'
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  try {
    const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0)
    if (Date.now() - last > 15000) {
      sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()))
      window.location.reload()
    }
  } catch {
    window.location.reload()
  }
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
