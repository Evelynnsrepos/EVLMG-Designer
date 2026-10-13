import { BookOpen, Keyboard, Minus, Plus, Scaling } from 'lucide-react'
import { useState } from 'react'
import type { ComponentType } from '@/core/model'
import { getManifest } from '@/core/registry'
import { formatCombo, keysOf, SHORTCUT_GROUPS } from '@/core/shortcuts'
import { useSettings } from '@/core/state/settingsStore'
import { DRAW_ACTIONS, useInputSettings } from '@/shared/sketch'
import { Modal } from '@/shared/ui'
import { useHelp } from '../help/help'

/** Tools drawn on a board (CanvasEditor): they share the board keys. */
const BOARD_TOOLS = new Set<ComponentType>(['moodboard', 'design-language', 'brainstorm', 'map', 'story-writer', 'timeline', 'ui-flow'])
const OWN_GROUP: Partial<Record<ComponentType, string>> = { 'level-layout': 'Level Layout', 'pixel-art': 'Pixel Art' }

export interface KeyRow {
  label: string
  keys: readonly string[]
}

/** v0.18: the shortcuts that work in one tool (with the user's own keys), then the ones that work everywhere. */
export function toolShortcuts(type: ComponentType): { name: string; rows: KeyRow[] }[] {
  const tool = getManifest(type)?.name ?? type
  const group = (match: string, name: string) => {
    const g = SHORTCUT_GROUPS.find((x) => x.name.startsWith(match))
    return g && { name, rows: g.items.map((i): KeyRow => ({ label: i.label, keys: keysOf(i.id) })) }
  }
  const drawKeys = useInputSettings.getState().shortcuts as Record<string, string[] | undefined>
  const own =
    type === 'sketch'
      ? { name: tool, rows: DRAW_ACTIONS.map((a): KeyRow => ({ label: a.label, keys: drawKeys[a.id] ?? a.keys })) }
      : BOARD_TOOLS.has(type)
        ? group('Boards', tool)
        : OWN_GROUP[type] && group(OWN_GROUP[type], tool)
  return [own, group('Everywhere', 'Everywhere')].filter((g) => !!g)
}

/** How to link things with text and jump points: shown in every tool's shortcuts window and in the guide. */
export const LINK_HELP = [
  'Link with text: type [[ in any text (Writer, Wiki, Story Branch Writer, Timeline, Tasks…) and pick an article, item, character, town, enemy, tool or document from the list. Keep typing to search, Enter picks. The link follows renames; click it to go there.',
  'Jump points: the crossing-arrows button in the header links this tool to any other tool, document or entry, and lists what points back here. On boards, the jump tool (J) places one right on the board.',
  'Shift-click a tool in the sidebar to open it next to this one. Esc turns Layout Mode on and off, where you move and close panels.',
]

export function KeyList({ rows }: { rows: KeyRow[] }) {
  return (
    <table className="tool-keys">
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td>{r.label}</td>
            <td>
              {r.keys.map((k) => (
                <kbd key={k}>{formatCombo(k)}</kbd>
              ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** The keyboard button in every tool's header. */
export function ToolKeysButton({ type }: { type: ComponentType }) {
  const [open, setOpen] = useState(false)
  const name = getManifest(type)?.name ?? type
  return (
    <>
      <button className="panel-font" title="Shortcuts and how to link things in this tool" aria-label="Shortcuts" onClick={() => setOpen(true)}>
        <Keyboard size={12} />
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <div className="tool-keys-dialog">
            <h3>
              <Keyboard size={17} /> {name}: shortcuts
            </h3>
            {toolShortcuts(type).map((g) => (
              <section key={g.name}>
                <h4>{g.name}</h4>
                <KeyList rows={g.rows} />
              </section>
            ))}
            <h4>Linking things</h4>
            {LINK_HELP.map((p) => (
              <p key={p}>{p}</p>
            ))}
            <p className="muted">Change any key in Settings, under Keyboard shortcuts.</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => (setOpen(false), useHelp.getState().openGuide(type))}>
                <BookOpen size={14} /> {name} in the user guide
              </button>
              <span style={{ flex: 1 }} />
              <button className="btn btn-primary" onClick={() => setOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

const MIN = 75
const MAX = 200

/** This tool's size in percent (Settings, this computer). */
export const useToolScale = (type: ComponentType) => useSettings((s) => s.toolScale[type] ?? 100)

function setScale(type: ComponentType, pct: number) {
  const toolScale = { ...useSettings.getState().toolScale }
  if (pct === 100) delete toolScale[type]
  else toolScale[type] = Math.min(MAX, Math.max(MIN, pct))
  useSettings.getState().update({ toolScale })
}

/** v0.18: next to the keyboard button: makes this tool's buttons and text bigger, e.g. for a graphics tablet. */
export function ToolScaleButton({ type }: { type: ComponentType }) {
  const pct = useToolScale(type)
  const [open, setOpen] = useState<DOMRect | null>(null)
  return (
    <>
      <button className={`panel-font${pct !== 100 ? ' on' : ''}`} title={`Size of this tool: ${pct}% (bigger buttons for a pen or tablet)`} aria-label="Size of this tool" onClick={(e) => setOpen(open ? null : e.currentTarget.getBoundingClientRect())}>
        <Scaling size={12} />
      </button>
      {open && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(null)} />
          <div className="menu tool-scale" style={{ position: 'fixed', top: open.bottom + 4, left: Math.max(8, Math.min(open.left - 100, window.innerWidth - 248)) }}>
            <div className="jump-menu-head">Size of {getManifest(type)?.name ?? 'this tool'}</div>
            <div className="tool-scale-row">
              <button className="icon-btn" title="Smaller" onClick={() => setScale(type, pct - 10)}>
                <Minus size={14} />
              </button>
              <input type="range" min={MIN} max={MAX} step={5} value={pct} aria-label="Size in percent" onChange={(e) => setScale(type, +e.target.value)} />
              <button className="icon-btn" title="Bigger" onClick={() => setScale(type, pct + 10)}>
                <Plus size={14} />
              </button>
              <span>{pct}%</span>
            </div>
            <button className="btn btn-ghost" disabled={pct === 100} onClick={() => setScale(type, 100)}>
              Reset to 100%
            </button>
          </div>
        </>
      )}
    </>
  )
}
