import { Download, RotateCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSettings } from '@/core/state'
import { installUpdate, offeredVersion, restartApp, startAutoCheck, useUpdates } from './updates'
import './updates.css'

const UI = {
  ready: (v: string) => `Version ${v} is ready`,
  out: (v: string) => `Version ${v} is out`,
  whatsNew: "What's new",
  hide: 'Hide',
  update: 'Update',
  later: 'Later',
  skip: 'Skip this version',
  downloading: 'Downloading…',
  installed: 'Installed. Restart now to use it.',
  restart: 'Restart now',
  flatpak: 'Open your Software app (GNOME Software or Discover) and update it there, or run: flatpak update',
  system: 'Download it from the release page, or update it with your system’s package manager.',
  releasePage: 'Open the release page',
  failed: 'The update didn’t work. Nothing was changed.',
}

const RELEASES = 'https://github.com/Evelynnsrepos/EVLMG-Designer/releases/latest'

/** The start screen's "new version" card. Only on Home, so it never interrupts work in a tool. */
export function UpdateCard() {
  const st = useUpdates()
  const skip = useSettings((s) => s.updateSkip)
  const [notes, setNotes] = useState(false)
  useEffect(() => startAutoCheck(), [])
  const version = offeredVersion(st, skip)
  if (!version || !st.info) return null
  const self = st.info.kind === 'self'
  const open = () => void import('@tauri-apps/plugin-opener').then((o) => o.openUrl(RELEASES))
  return (
    <div className="update-card" role="status">
      <div className="update-card-head">
        <Download size={16} />
        <strong>{self ? UI.ready(version) : UI.out(version)}</strong>
        {st.info.notes && (
          <button className="btn btn-ghost" onClick={() => setNotes(!notes)}>
            {notes ? UI.hide : UI.whatsNew}
          </button>
        )}
        <span className="update-card-grow" />
        {st.phase !== 'downloading' && st.phase !== 'ready' && (
          <button className="icon-btn" title={UI.later} aria-label={UI.later} onClick={() => useUpdates.setState({ later: true })}>
            <X size={16} />
          </button>
        )}
      </div>
      {notes && <div className="update-card-notes">{st.info.notes}</div>}
      {!self && <p className="muted update-card-line">{st.info.kind === 'flatpak' ? UI.flatpak : UI.system}</p>}
      {st.phase === 'downloading' && (
        <div className="update-card-line">
          {UI.downloading}
          <progress value={st.progress < 0 ? undefined : st.progress} max={1} />
        </div>
      )}
      {st.phase === 'error' && <p className="update-card-error">{UI.failed} {st.error}</p>}
      <div className="update-card-actions">
        {st.phase === 'ready' ? (
          <>
            <span>{UI.installed}</span>
            <button className="btn btn-primary" onClick={() => void restartApp()}>
              <RotateCw size={16} /> {UI.restart}
            </button>
          </>
        ) : (
          st.phase !== 'downloading' && (
            <>
              {self ? (
                <button className="btn btn-primary" onClick={() => void installUpdate()}>
                  <Download size={16} /> {UI.update}
                </button>
              ) : (
                <button className="btn btn-primary" onClick={open}>
                  {UI.releasePage}
                </button>
              )}
              <button className="btn" onClick={() => useUpdates.setState({ later: true })}>
                {UI.later}
              </button>
              <button className="btn btn-ghost muted" onClick={() => useSettings.getState().update({ updateSkip: version })}>
                {UI.skip}
              </button>
            </>
          )
        )}
      </div>
    </div>
  )
}
