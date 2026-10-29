import { useEffect, useRef, useState } from 'react'
import { newId } from '@/core/model'
import { Modal } from '../ui'
import { ACTIONS, actionLabel, comboOf, conflicts, formatCombo, keysFor, QUICK_SLOTS, type ActionId } from './actions'
import { CurveEditor } from './CurveEditor'
import { useInputSettings } from './inputSettings'
import { applyCurve, LINEAR, PEN_BITS, tiltToAngles, withNativePen, type CurvePoint } from './pen'
import './input.css'

const SECTIONS = ['Pressure', 'Smoothing', 'Test your pen', 'Shortcuts', 'Pen buttons', 'Hotwheel', 'Touch'] as const
type Section = (typeof SECTIONS)[number]

const UI = {
  title: 'Pen and keys',
  done: 'Done',
  pressureIntro: 'How hard you press and how strong the brush gets. Works for every brush.',
  presets: { Even: LINEAR, Soft: [{ x: 0, y: 0 }, { x: 0.35, y: 0.65 }, { x: 1, y: 1 }], Firm: [{ x: 0, y: 0 }, { x: 0.6, y: 0.3 }, { x: 1, y: 1 }] } as Record<string, CurvePoint[]>,
  pressHere: 'Press with your pen anywhere in this window to see where you are on the curve.',
  stabilization: 'Stabilization',
  stabilizationHelp: 'Smooths every stroke a little more. Good for long, calm lines.',
  motionFilter: 'Motion filtering',
  motionFilterHelp: 'Takes out shaky jitter while you draw slowly; fast strokes stay sharp.',
  streamlineNote: 'Each brush also has its own Smoothing (StreamLine), next to its size.',
  testIntro: 'Draw, hover and press the buttons on your pen. This shows what the tablet sends.',
  clear: 'Clear',
  device: 'Device',
  none: 'Nothing yet',
  pressure: 'Pressure',
  afterCurve: 'After your curve',
  tilt: 'Tilt',
  angle: 'Angle',
  twist: 'Twist',
  buttons: 'Buttons',
  hovering: 'hovering',
  bits: { tip: 'Tip', barrel: 'Lower button', middle: 'Upper button', eraser: 'Eraser end' } as Record<keyof typeof PEN_BITS, string>,
  noPressure: 'No pressure yet: a mouse or a pen without pressure always draws at full strength.',
  shortcutsIntro: 'Click a key to change it. Esc cancels.',
  pressKey: 'Press a key…',
  noKey: 'No key',
  removeKey: 'Remove key',
  reset: 'Reset',
  resetAll: 'Reset all keys',
  alsoUsed: (names: string) => `Taken from: ${names}`,
  holdKeys: 'Always: hold Space to pan, hold Alt for the eyedropper, hold Shift for perfect shapes.',
  penButtonsIntro: 'Choose what the buttons on the side of your pen do. Tools are used while you hold the button.',
  lower: 'Lower button',
  upper: 'Upper button',
  nothing: 'Nothing',
  eraserNote: 'Turning the pen around to the eraser end always erases.',
  quickIntro: 'Draw\'s outer ring of the Hotwheel (hold Q, or a pen button): up to ten actions, clockwise from the top. Make several profiles, like Sketching and Inking, and switch with the Next Hotwheel profile action.',
  menu: 'Menu',
  newMenu: 'New menu',
  renameMenu: 'Name',
  deleteMenu: 'Delete menu',
  slot: (n: number) => `Slot ${n}`,
  empty: 'Empty',
  touchIntro: 'For touch screens and tablets with touch.',
  gestures: 'Two fingers pinch to zoom and turn; tap with two fingers to undo, three to redo',
  fingerDraws: 'One finger draws (off: one finger moves the canvas)',
}

/** Pen, keys, QuickMenu and touch settings, with a tablet test screen (Sketch Pro). */
export function InputSettingsDialog({ onClose, initial = 'Pressure' }: { onClose: () => void; initial?: Section }) {
  const s = useInputSettings()
  const [section, setSection] = useState<Section>(initial)
  const [marker, setMarker] = useState<number | null>(null)
  useEffect(() => {
    void useInputSettings.getState().load()
  }, [])

  return (
    <Modal onClose={onClose}>
      <div
        className="studio input-settings"
        onPointerMove={(e) => e.pointerType === 'pen' && e.pressure > 0 && setMarker(e.pressure)}
        onPointerUp={() => setMarker(null)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="studio-head">
          <h3>{UI.title}</h3>
        </div>
        <div className="studio-body">
          <nav className="studio-nav">
            {SECTIONS.map((x) => (
              <button key={x} className={`studio-tab${x === section ? ' is-active' : ''}`} onClick={() => setSection(x)}>
                {x}
              </button>
            ))}
          </nav>
          <div className="studio-settings">
            {section === 'Pressure' && (
              <>
                <p className="input-help">{UI.pressureIntro}</p>
                <div className="input-curve-row">
                  <CurveEditor points={s.pressureCurve} onChange={(pressureCurve) => s.update({ pressureCurve })} marker={marker} />
                  <div className="input-presets">
                    {Object.entries(UI.presets).map(([name, pts]) => (
                      <button key={name} className="btn" onClick={() => s.update({ pressureCurve: pts })}>
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="input-help">{UI.pressHere}</p>
              </>
            )}
            {section === 'Smoothing' && (
              <>
                <Range label={UI.stabilization} help={UI.stabilizationHelp} value={s.stabilization} onChange={(stabilization) => s.update({ stabilization })} />
                <Range label={UI.motionFilter} help={UI.motionFilterHelp} value={s.motionFilter} onChange={(motionFilter) => s.update({ motionFilter })} />
                <p className="input-help">{UI.streamlineNote}</p>
              </>
            )}
            {section === 'Test your pen' && <TabletTest curve={s.pressureCurve} />}
            {section === 'Shortcuts' && <ShortcutEditor />}
            {section === 'Pen buttons' && (
              <>
                <p className="input-help">{UI.penButtonsIntro}</p>
                {(['barrel', 'middle'] as const).map((b) => (
                  <label key={b} className="studio-row input-row">
                    <span>{b === 'barrel' ? UI.lower : UI.upper}</span>
                    <ActionSelect value={s.penButtons[b]} none={UI.nothing} onChange={(v) => s.update({ penButtons: { ...s.penButtons, [b]: v ?? 'none' } })} />
                  </label>
                ))}
                <p className="input-help">{UI.eraserNote}</p>
              </>
            )}
            {section === 'Hotwheel' && <QuickMenuEditor />}
            {section === 'Touch' && (
              <>
                <p className="input-help">{UI.touchIntro}</p>
                <label className="sketch-check">
                  <input type="checkbox" checked={s.touchGestures} onChange={(e) => s.update({ touchGestures: e.target.checked })} />
                  {UI.gestures}
                </label>
                <label className="sketch-check">
                  <input type="checkbox" checked={s.fingerDraws} onChange={(e) => s.update({ fingerDraws: e.target.checked })} />
                  {UI.fingerDraws}
                </label>
              </>
            )}
          </div>
        </div>
        <div className="studio-foot">
          <button className="btn btn-primary" onClick={onClose}>
            {UI.done}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function Range({ label, help, value, onChange }: { label: string; help: string; value: number; onChange(v: number): void }) {
  return (
    <div>
      <label className="studio-row">
        <span>{label}</span>
        <input type="range" min={0} max={1} step={0.05} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <span>{value ? `${Math.round(value * 100)}%` : 'Off'}</span>
      </label>
      <p className="input-help">{help}</p>
    </div>
  )
}

/** A select of every action; `none` adds an empty choice. */
export function ActionSelect({ value, onChange, none }: { value: ActionId | 'none' | null; onChange(v: ActionId | null): void; none: string }) {
  return (
    <select className="input" value={value ?? 'none'} onChange={(e) => onChange(e.target.value === 'none' ? null : (e.target.value as ActionId))}>
      <option value="none">{none}</option>
      {ACTIONS.map((a) => (
        <option key={a.id} value={a.id}>
          {a.label}
        </option>
      ))}
    </select>
  )
}

// ---- Tablet test ------------------------------------------------------------------

interface Reading {
  type: string
  pressure: number
  tiltX: number
  tiltY: number
  altitude: number
  azimuth: number
  twist: number
  buttons: number
  hovering: boolean
}

function TabletTest({ curve }: { curve: CurvePoint[] }) {
  const pad = useRef<HTMLCanvasElement>(null)
  const [r, setR] = useState<Reading | null>(null)
  const [pressureSeen, setPressureSeen] = useState(false)

  const read = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const n = ev.nativeEvent
    const native = withNativePen(n)
    // On Linux the pen comes from GTK (withNativePen); the event itself then only says "mouse".
    const e = { ...ev, ...native, tiltX: native.tiltX ?? 0, tiltY: native.tiltY ?? 0, clientX: ev.clientX, clientY: ev.clientY, twist: ev.twist }
    const angles = native === n && typeof n.altitudeAngle === 'number' ? { altitude: n.altitudeAngle, azimuth: n.azimuthAngle } : tiltToAngles(e.tiltX, e.tiltY)
    const reading = { type: e.pointerType, pressure: e.pressure, tiltX: e.tiltX, tiltY: e.tiltY, ...angles, twist: e.twist, buttons: e.buttons, hovering: e.buttons === 0 }
    setR(reading)
    if (e.pointerType === 'pen' && e.pressure > 0 && e.pressure !== 0.5 && e.pressure !== 1) setPressureSeen(true)
    if (!e.buttons) return
    const c = pad.current!
    const rect = c.getBoundingClientRect()
    const ctx = c.getContext('2d')!
    const p = e.pointerType === 'pen' ? applyCurve(curve, e.pressure) : 1
    ctx.fillStyle = e.buttons & PEN_BITS.eraser ? '#e5484d' : '#3e8ef7'
    ctx.globalAlpha = 0.8
    ctx.beginPath()
    ctx.arc(((e.clientX - rect.left) * c.width) / rect.width, ((e.clientY - rect.top) * c.height) / rect.height, 1 + p * 10, 0, Math.PI * 2)
    ctx.fill()
  }

  const deg = (rad: number) => `${Math.round((rad * 180) / Math.PI)}°`
  const lean = r ? Math.cos(r.altitude) : 0

  return (
    <div className="tablet-test">
      <p className="input-help">{UI.testIntro}</p>
      <div className="tablet-test-body">
        <canvas
          ref={pad}
          width={420}
          height={260}
          className="tablet-pad"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            read(e)
          }}
          onPointerMove={read}
          onPointerUp={read}
          onContextMenu={(e) => e.preventDefault()}
        />
        <dl className="tablet-readout">
          <dt>{UI.device}</dt>
          <dd>{r ? `${r.type}${r.hovering ? ` (${UI.hovering})` : ''}` : UI.none}</dd>
          <dt>{UI.pressure}</dt>
          <dd>
            <Bar value={r?.pressure ?? 0} /> {r ? r.pressure.toFixed(2) : '–'}
          </dd>
          <dt>{UI.afterCurve}</dt>
          <dd>
            <Bar value={r && r.type === 'pen' ? applyCurve(curve, r.pressure) : 0} />
          </dd>
          <dt>{UI.tilt}</dt>
          <dd>
            <svg width={44} height={44} viewBox="-22 -22 44 44" className="tablet-tilt">
              <circle r={20} />
              {r && <line x1={0} y1={0} x2={Math.cos(r.azimuth) * 20 * lean} y2={Math.sin(r.azimuth) * 20 * lean} />}
            </svg>
            {r ? `X ${r.tiltX}° · Y ${r.tiltY}°` : '–'}
          </dd>
          <dt>{UI.angle}</dt>
          <dd>{r ? `${deg(r.altitude)} up, toward ${deg(r.azimuth)}` : '–'}</dd>
          <dt>{UI.twist}</dt>
          <dd>{r ? `${r.twist}°` : '–'}</dd>
          <dt>{UI.buttons}</dt>
          <dd className="tablet-buttons">
            {(Object.keys(PEN_BITS) as (keyof typeof PEN_BITS)[]).map((k) => (
              <span key={k} className={`tablet-chip${r && r.buttons & PEN_BITS[k] ? ' is-on' : ''}`}>
                {UI.bits[k]}
              </span>
            ))}
          </dd>
        </dl>
      </div>
      {!pressureSeen && <p className="input-help">{UI.noPressure}</p>}
      <button className="btn" onClick={() => pad.current?.getContext('2d')!.clearRect(0, 0, 420, 260)}>
        {UI.clear}
      </button>
    </div>
  )
}

function Bar({ value }: { value: number }) {
  return (
    <span className="tablet-bar">
      <span style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }} />
    </span>
  )
}

// ---- Shortcuts --------------------------------------------------------------------

function ShortcutEditor() {
  const s = useInputSettings()
  const [listening, setListening] = useState<ActionId | null>(null)
  const [note, setNote] = useState<{ id: ActionId; text: string } | null>(null)

  useEffect(() => {
    if (!listening) return
    const down = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') return setListening(null)
      const combo = comboOf(e)
      if (!combo) return
      const shortcuts = { ...s.shortcuts }
      const taken = conflicts(combo, listening, shortcuts)
      for (const other of taken) shortcuts[other] = keysFor(other, shortcuts).filter((k) => k !== combo)
      shortcuts[listening] = [combo]
      s.update({ shortcuts })
      setNote(taken.length ? { id: listening, text: UI.alsoUsed(taken.map(actionLabel).join(', ')) } : null)
      setListening(null)
    }
    // Capture, so the editor and the dialog don't act on the key.
    window.addEventListener('keydown', down, true)
    return () => window.removeEventListener('keydown', down, true)
  }, [listening, s])

  const setKeys = (id: ActionId, keys: string[] | undefined) => {
    const shortcuts = { ...s.shortcuts }
    if (keys) shortcuts[id] = keys
    else delete shortcuts[id]
    s.update({ shortcuts })
  }

  return (
    <div className="shortcut-editor">
      <p className="input-help">{UI.shortcutsIntro}</p>
      <div className="shortcut-list">
        {ACTIONS.map((a) => {
          const keys = keysFor(a.id, s.shortcuts)
          return (
            <div key={a.id} className="shortcut-row">
              <span>{a.label}</span>
              <button className={`btn shortcut-key${listening === a.id ? ' is-listening' : ''}`} onClick={() => setListening(listening === a.id ? null : a.id)}>
                {listening === a.id ? UI.pressKey : keys.length ? keys.map(formatCombo).join(' or ') : UI.noKey}
              </button>
              <button className="btn btn-ghost sketch-small" title={UI.removeKey} disabled={!keys.length} onClick={() => setKeys(a.id, [])}>
                ×
              </button>
              <button className="btn btn-ghost sketch-small" disabled={!s.shortcuts[a.id]} onClick={() => setKeys(a.id, undefined)}>
                {UI.reset}
              </button>
              {note?.id === a.id && <span className="shortcut-note">{note.text}</span>}
            </div>
          )
        })}
      </div>
      <p className="input-help">{UI.holdKeys}</p>
      <button className="btn" onClick={() => s.update({ shortcuts: {} })}>
        {UI.resetAll}
      </button>
    </div>
  )
}

// ---- QuickMenu --------------------------------------------------------------------

function QuickMenuEditor() {
  const s = useInputSettings()
  const profile = s.quickMenus.find((q) => q.id === s.quickMenuId) ?? s.quickMenus[0]
  const change = (patch: Partial<typeof profile>) => s.update({ quickMenus: s.quickMenus.map((q) => (q.id === profile.id ? { ...q, ...patch } : q)) })
  const add = () => {
    const p = { id: newId(), name: `Menu ${s.quickMenus.length + 1}`, slots: [...profile.slots] }
    s.update({ quickMenus: [...s.quickMenus, p], quickMenuId: p.id })
  }
  const remove = () => {
    const rest = s.quickMenus.filter((q) => q.id !== profile.id)
    if (rest.length) s.update({ quickMenus: rest, quickMenuId: rest[0].id })
  }
  return (
    <>
      <p className="input-help">{UI.quickIntro}</p>
      <div className="studio-row input-row">
        <span>{UI.menu}</span>
        <select className="input" value={profile.id} onChange={(e) => s.update({ quickMenuId: e.target.value })}>
          {s.quickMenus.map((q) => (
            <option key={q.id} value={q.id}>
              {q.name}
            </option>
          ))}
        </select>
        <button className="btn sketch-small" onClick={add}>
          {UI.newMenu}
        </button>
      </div>
      <label className="studio-row input-row">
        <span>{UI.renameMenu}</span>
        <input className="input" value={profile.name} onChange={(e) => change({ name: e.target.value })} />
        <button className="btn btn-ghost sketch-small" disabled={s.quickMenus.length < 2} onClick={remove}>
          {UI.deleteMenu}
        </button>
      </label>
      {Array.from({ length: QUICK_SLOTS }, (_, i) => (
        <label key={i} className="studio-row input-row">
          <span>{UI.slot(i + 1)}</span>
          <ActionSelect value={profile.slots[i]} none={UI.empty} onChange={(v) => change({ slots: profile.slots.map((x, j) => (j === i ? v : x)) })} />
        </label>
      ))}
    </>
  )
}
