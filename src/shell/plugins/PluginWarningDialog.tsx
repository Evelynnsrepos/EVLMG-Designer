import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Modal } from '@/shared/ui'
import type { PluginInfo } from './plugins'
import './plugins.css'

const UI = {
  title: (name: string) => `Install "${name}"?`,
  lead: 'Only install plugins from people you trust. A plugin is a program, not a file.',
  risks: [
    'It runs inside Eve.Lopment Games Designer with the same rights as the app: it can read, change and delete any file on this computer, including your projects.',
    'Nobody checks plugins. Evelopment Games cannot see what this one does.',
    'In projects you work on with others (peer to peer), a plugin can change shared data in ways your teammates do not expect, and teammates who do not have the plugin cannot open its tool or may break its data by accident.',
    'A broken plugin can make the app slow or crash it. You can remove it in Settings.',
  ],
  source: 'Source',
  version: 'Version',
  understand: 'I understand the risks and I trust this plugin',
  cancel: 'Cancel',
  install: 'Install anyway',
}

/** The heavy warning before any plugin is installed (v0.4). Cancel has focus; installing needs the checkbox. */
export function PluginWarningDialog({ info, note, onDone }: { info: PluginInfo; note?: string; onDone: (install: boolean) => void }) {
  const [sure, setSure] = useState(false)
  return (
    <Modal onClose={() => onDone(false)}>
      <div className="plugin-warning">
        <h3>
          <TriangleAlert size={20} /> {UI.title(info.name)}
        </h3>
        <p className="plugin-warning-lead">{UI.lead}</p>
        {note && <p>{note}</p>}
        <ul>
          {UI.risks.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <dl className="plugin-warning-facts">
          <dt>{UI.source}</dt>
          <dd>{info.source}</dd>
          <dt>{UI.version}</dt>
          <dd>{info.version}</dd>
        </dl>
        <label className="plugin-warning-check">
          <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
          {UI.understand}
        </label>
        <div className="modal-actions">
          <button className="btn" autoFocus onClick={() => onDone(false)}>
            {UI.cancel}
          </button>
          <button className="btn btn-danger" disabled={!sure} onClick={() => onDone(true)}>
            {UI.install}
          </button>
        </div>
      </div>
    </Modal>
  )
}
