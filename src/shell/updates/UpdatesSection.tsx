import { useSettings } from '@/core/state'
import { checkForUpdates, useUpdates } from './updates'

const UI = {
  title: 'Updates',
  auto: 'Look for a new version when the app starts (and once a day)',
  hint: 'The app downloads one small file from GitHub to see if there is a new version. Nothing about you or your projects is sent. Updates only install when you click Update on the start screen.',
  now: 'Check now',
  checking: 'Checking…',
  current: (v: string) => `This is version ${v}.`,
  newest: 'This is the newest version.',
  found: (v: string) => `Version ${v} is out: the start screen shows it.`,
  skipped: (v: string) => `You skipped version ${v}.`,
  unskip: 'Show it again',
  failed: (e: string) => `Couldn’t check: ${e}`,
}

/** Settings → General → Updates (desktop app only). */
export function UpdatesSection() {
  const s = useSettings()
  const st = useUpdates()
  if (!st.available) return null
  const v = st.info?.version
  return (
    <section data-section="updates">
      <h3>{UI.title}</h3>
      <label className="settings-check">
        <input type="checkbox" checked={s.updateCheck} onChange={(e) => s.update({ updateCheck: e.target.checked })} />
        {UI.auto}
      </label>
      <p className="muted settings-hint">{UI.hint}</p>
      <p>
        <button className="btn" disabled={st.phase === 'checking'} onClick={() => { useUpdates.setState({ later: false }); void checkForUpdates() }}>
          {st.phase === 'checking' ? UI.checking : UI.now}
        </button>{' '}
        {st.info && <span className="muted">{UI.current(st.info.current)} {v ? UI.found(v) : UI.newest}</span>}
      </p>
      {st.phase === 'error' && <p className="muted">{UI.failed(st.error)}</p>}
      {s.updateSkip && (
        <p className="muted">
          {UI.skipped(s.updateSkip)}{' '}
          <button className="btn btn-ghost" onClick={() => s.update({ updateSkip: '' })}>{UI.unskip}</button>
        </p>
      )}
    </section>
  )
}
