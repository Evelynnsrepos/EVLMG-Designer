import { invoke } from '@tauri-apps/api/core'
import { TriangleAlert, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { isTauri } from '@/core/fs'
import { gpuInfo } from '@/shared/gpu'
import { REPO_URL } from '../help/HelpHost'

const UI = {
  title: 'The graphics card is not being used',
  body: 'Drawing on big pictures will be slow. Please tell us on GitHub so we can make it work on your computer. The report below is filled in for you; you read it and decide whether to send it.',
  linux: 'On Linux you can also try Settings > Drawing speed > Graphics card (Linux) > "Older screen handover", then restart the app.',
  report: 'Report on GitHub',
  hide: "Don't show again",
}
const KEY = 'egd-gpu-warning-hidden'
const isLinux = /Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent)

/** Diagnostic text for the issue: only what the web engine says about the graphics card, nothing about projects. */
export function gpuIssueUrl(renderer: string, webgl2: boolean, version: string, mode: string): string {
  const report = [`App version: ${version}`, `System: ${navigator.userAgent}`, `Graphics: ${renderer}${webgl2 ? '' : ', no WebGL2'}`, `Graphics mode: ${mode}`].join('\n')
  const body = `Which graphics card and driver do you have (if you know)?\n\n\n\`\`\`\n${report}\n\`\`\``
  return `${REPO_URL}/issues/new?title=${encodeURIComponent('Graphics card not used')}&body=${encodeURIComponent(body)}`
}

/** Home screen card when the app draws without the graphics card although nobody chose that (Settings "No graphics card"). */
export function GpuCard() {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    try {
      if (localStorage.getItem(KEY)) return
    } catch {
      // no storage: show it
    }
    const g = gpuInfo()
    if (!g.software && g.webgl2) return
    void (async () => {
      const mode = isTauri() && isLinux ? await invoke<string>('graphics_mode_get').catch(() => 'auto') : 'default'
      if (mode === 'software') return
      const version = isTauri() ? await import('@tauri-apps/api/app').then((m) => m.getVersion()).catch(() => 'unknown') : 'browser'
      setUrl(gpuIssueUrl(g.renderer, g.webgl2, version, mode))
    })()
  }, [])
  if (!url) return null
  const hide = () => {
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      // ignore
    }
    setUrl(null)
  }
  return (
    <div className="update-card" role="status">
      <div className="update-card-head">
        <TriangleAlert size={16} />
        <strong>{UI.title}</strong>
        <span className="update-card-grow" />
        <button className="icon-btn" title={UI.hide} aria-label={UI.hide} onClick={hide}>
          <X size={16} />
        </button>
      </div>
      <p className="muted update-card-line">{UI.body}</p>
      {isLinux && <p className="muted update-card-line">{UI.linux}</p>}
      <div className="update-card-actions">
        <button className="btn btn-primary" onClick={() => void import('@tauri-apps/plugin-opener').then((o) => o.openUrl(url)).catch(() => window.open(url))}>
          {UI.report}
        </button>
        <button className="btn btn-ghost" onClick={hide}>
          {UI.hide}
        </button>
      </div>
    </div>
  )
}
