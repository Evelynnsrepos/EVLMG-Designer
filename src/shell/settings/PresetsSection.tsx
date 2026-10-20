import { Plus, Trash2 } from 'lucide-react'
import { newId } from '@/core/model'
import { allManifests } from '@/core/registry'
import { useSettings, type ProjectPreset } from '@/core/state'
import { confirmDialog } from '@/shared/dialogs'
import { shownTool } from '../editor/optionalTools'

const T = {
  title: 'Project presets',
  hint: 'Your own presets show up next to the built-in ones when you make a new project. You can also make one there with "Save as preset".',
  none: 'No presets yet.',
  add: 'New preset',
  newName: 'My preset',
  name: 'Name',
  description: 'Description',
  tools: (n: number) => `Tools (${n})`,
  tasks: 'First tasks on the task board, one per line',
  remove: 'Delete preset',
  removeAsk: (name: string) => `Delete the preset "${name}"? Projects made with it stay as they are.`,
}

/** v0.20: Settings, Project presets: the user's own presets for the new project wizard. */
export function PresetsSection() {
  const presets = useSettings((s) => s.projectPresets)
  const manifests = allManifests().filter((m) => shownTool(m.type))
  const save = (next: ProjectPreset[]) => useSettings.getState().update({ projectPresets: next })
  const change = (id: string, patch: Partial<ProjectPreset>) => save(presets.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  const remove = async (p: ProjectPreset) => {
    if (await confirmDialog({ title: T.remove, message: T.removeAsk(p.name), confirmLabel: 'Delete', danger: true })) save(presets.filter((x) => x.id !== p.id))
  }

  return (
    <section data-section="presets">
      <h3>{T.title}</h3>
      <p className="muted settings-hint">{T.hint}</p>
      {presets.length === 0 && <p className="muted">{T.none}</p>}
      {presets.map((p) => (
        <details key={p.id} className="settings-card">
          <summary>
            <strong>{p.name || T.newName}</strong> <span className="muted">· {T.tools(p.components.length)}</span>
          </summary>
          <label className="settings-field">
            <span>{T.name}</span>
            <input className="input" value={p.name} onChange={(e) => change(p.id, { name: e.target.value })} />
          </label>
          <label className="settings-field">
            <span>{T.description}</span>
            <input className="input" value={p.description} onChange={(e) => change(p.id, { description: e.target.value })} />
          </label>
          <h4>{T.tools(p.components.length)}</h4>
          <div className="settings-tools">
            {manifests.map((m) => (
              <label key={m.type} className="settings-check" title={m.description}>
                <input
                  type="checkbox"
                  checked={p.components.includes(m.type)}
                  onChange={(e) => change(p.id, { components: e.target.checked ? [...p.components, m.type] : p.components.filter((c) => c !== m.type) })}
                />
                <m.icon size={14} />
                {m.name}
              </label>
            ))}
          </div>
          <label className="settings-field">
            <span>{T.tasks}</span>
            <textarea className="input" rows={3} value={p.tasks.join('\n')} onChange={(e) => change(p.id, { tasks: e.target.value.split('\n') })} onBlur={() => change(p.id, { tasks: p.tasks.map((t) => t.trim()).filter(Boolean) })} />
          </label>
          <button className="btn" onClick={() => void remove(p)}>
            <Trash2 size={14} /> {T.remove}
          </button>
        </details>
      ))}
      <div>
        <button className="btn" onClick={() => save([...presets, { id: newId(), name: T.newName, description: '', components: [], tasks: [] }])}>
          <Plus size={14} /> {T.add}
        </button>
      </div>
    </section>
  )
}
