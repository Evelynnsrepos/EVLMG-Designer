import { RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSettings } from '@/core/state'
import { comboOf, formatCombo, SHORTCUT_GROUPS } from '@/core/shortcuts'
import { DRAW_ACTIONS, useInputSettings } from '@/shared/sketch'
import './shortcutTable.css'

interface Row {
  id: string
  label: string
  defaults: readonly string[]
  /** The user's own keys, when changed. */
  custom?: string[]
  set(keys: string[] | undefined): void
}

/** Every shortcut in the app by group, Draw's included, with the user's changes (v0.15). */
function useShortcutRows(): { name: string; rows: Row[] }[] {
  const app = useSettings((s) => s.shortcuts)
  const draw = useInputSettings((s) => s.shortcuts)
  useEffect(() => {
    void useInputSettings.getState().load()
  }, [])
  const setApp = (id: string, keys: string[] | undefined) => {
    const next = { ...useSettings.getState().shortcuts }
    if (keys) next[id] = keys
    else delete next[id]
    useSettings.getState().update({ shortcuts: next })
  }
  const setDraw = (id: string, keys: string[] | undefined) => {
    const next: Record<string, string[]> = { ...useInputSettings.getState().shortcuts }
    if (keys) next[id] = keys
    else delete next[id]
    useInputSettings.getState().update({ shortcuts: next })
  }
  return [
    ...SHORTCUT_GROUPS.map((g) => ({ name: g.name, rows: g.items.map((i) => ({ id: i.id, label: i.label, defaults: i.keys, custom: app[i.id], set: (k: string[] | undefined) => setApp(i.id, k) })) })),
    { name: 'Draw', rows: DRAW_ACTIONS.map((a) => ({ id: a.id, label: a.label, defaults: a.keys, custom: (draw as Record<string, string[] | undefined>)[a.id], set: (k: string[] | undefined) => setDraw(a.id, k) })) },
  ]
}

const Keys = ({ keys }: { keys: readonly string[] }) => (keys.length ? <span className="shortcut-keys">{keys.map((k) => <kbd key={k}>{formatCombo(k)}</kbd>)}</span> : <span className="muted">no key</span>)

/**
 * The shortcut list: in Help as a cheatsheet (default and your key side by side), and in Settings
 * with a Change button that records the next key you press (v0.15).
 */
export function ShortcutTable({ editable }: { editable?: boolean }) {
  const groups = useShortcutRows()
  const [recording, setRecording] = useState<string | null>(null)
  return (
    <div className={`shortcut-table${editable ? ' editable' : ''}`}>
      {groups.map((g) => {
        const everywhere = groups[0].rows
        return (
          <section key={g.name}>
            <h4>{g.name}</h4>
            <div className="shortcut-grid">
              <span className="muted">Action</span>
              <span className="muted">Default</span>
              <span className="muted">Your key</span>
              {editable && <span />}
              {g.rows.map((r) => {
                const mine = r.custom ?? r.defaults
                // Keys used twice in this group (or by an everywhere shortcut) only run one of them.
                const clash = mine.flatMap((k) => [...g.rows, ...(g.rows === everywhere ? [] : everywhere)].filter((o) => o.id !== r.id && (o.custom ?? o.defaults).includes(k)).map((o) => o.label))
                return (
                  <div key={r.id} className="shortcut-line">
                    <span>
                      {r.label}
                      {clash.length > 0 && <em className="shortcut-clash"> also used by {[...new Set(clash)].join(', ')}</em>}
                    </span>
                    <Keys keys={r.defaults} />
                    {recording === r.id ? (
                      <input
                        className="input shortcut-record"
                        data-key-capture
                        autoFocus
                        readOnly
                        value="Press a key…"
                        onBlur={() => setRecording(null)}
                        onKeyDown={(e) => {
                          const combo = comboOf(e)
                          e.preventDefault()
                          e.stopPropagation()
                          if (!combo) return
                          r.set(combo === r.defaults[0] && r.defaults.length === 1 ? undefined : [combo])
                          setRecording(null)
                        }}
                      />
                    ) : r.custom ? (
                      <span className="shortcut-mine">
                        <Keys keys={r.custom} />
                      </span>
                    ) : (
                      <span className="muted">same</span>
                    )}
                    {editable && (
                      <span className="shortcut-actions">
                        <button className="btn btn-ghost" onClick={() => setRecording(r.id)}>
                          Change
                        </button>
                        <button className="btn btn-ghost" title="No key" onClick={() => r.set([])}>
                          None
                        </button>
                        <button className="icon-btn" title="Back to the default" disabled={!r.custom} onClick={() => r.set(undefined)}>
                          <RotateCcw size={13} />
                        </button>
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
