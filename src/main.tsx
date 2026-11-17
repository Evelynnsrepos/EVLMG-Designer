import { invoke, isTauri } from '@tauri-apps/api/core'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { flushOn } from './core/state'
import { glAllowed } from './shared/sketch/gl'
import { applyTheme } from './shell/theme'
import { getLang } from './shared/i18n'

applyTheme()
document.documentElement.lang = getLang()

// Waiting saves are written when the window loses focus or is hidden (minimised, another desktop).
flushOn(window, ['blur', 'pagehide'])
flushOn(document, ['visibilitychange'])

// "No graphics card" mode (Linux): Draw paints in Canvas 2D too. WebKitGTK hides which GL driver runs, so the page can't tell by itself.
if (isTauri())
  void invoke<string>('graphics_mode_get')
    .then((m) => {
      if (m === 'software') glAllowed.value = false
    })
    .catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
