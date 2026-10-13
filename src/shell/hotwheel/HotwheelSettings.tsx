import { useState } from 'react'
import type { Panel } from '@/core/model'
import { getManifest } from '@/core/registry'
import { DEFAULT_INNER, useSettings, type HotwheelSettings } from '@/core/state'
import { hotwheelKey, innerActions, outerRing, toolActions } from './Hotwheel'

const set = (patch: Partial<HotwheelSettings>) => useSettings.getState().update({ hotwheel: { ...useSettings.getState().hotwheel, ...patch } })

/** Settings → Hotwheel: how it opens, its size and the inner ring. */
export function HotwheelSection() {
  const h = useSettings((s) => s.hotwheel)
  const choices = innerActions(null)
  return (
    <section data-section="hotwheel">
      <h3>Hotwheel</h3>
      <p className="muted settings-hint">
        Hold {hotwheelKey()} anywhere in a project, point at a slice and let go; or tap {hotwheelKey()} and click a slice. The inner ring is the same in every tool, the outer ring changes with the tool (set it with the keyboard button in a tool's header). Esc or the centre closes it.
      </p>
      <label className="settings-check">
        <input type="checkbox" checked={h.penButton} onChange={(e) => set({ penButton: e.target.checked })} />
        Open with the pen's side button (most pens send it as a right-click)
      </label>
      <label className="settings-check">
        <input type="checkbox" checked={h.rightHold} onChange={(e) => set({ rightHold: e.target.checked })} />
        Open by holding the right mouse button (a short right-click stays a right-click)
      </label>
      <label className="settings-check">
        <input type="checkbox" checked={h.middle} onChange={(e) => set({ middle: e.target.checked })} />
        Open with the middle mouse button
      </label>
      {h.middle && <p className="settings-error">The middle mouse button also pans in Draw, Pixel Art, Level Layout, the Map and on boards; while this is on, it opens the Hotwheel there instead.</p>}
      <label className="settings-row">
        Size
        <select className="input" value={h.size} onChange={(e) => set({ size: e.target.value as HotwheelSettings['size'] })}>
          <option value="S">Small</option>
          <option value="M">Medium</option>
          <option value="L">Large (big tablets)</option>
        </select>
      </label>
      <h4>Inner ring, clockwise from the top</h4>
      {Array.from({ length: 6 }, (_, i) => (
        <label key={i} className="settings-row">
          Slice {i + 1}
          <select className="input" value={h.inner[i] ?? ''} onChange={(e) => set({ inner: Array.from({ length: 6 }, (_, j) => (j === i ? e.target.value : (h.inner[j] ?? ''))) })}>
            <option value="">Empty</option>
            {choices.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      <button className="btn btn-ghost" onClick={() => set({ inner: DEFAULT_INNER, outer: {} })}>
        Reset all wheels
      </button>
    </section>
  )
}

/** In a tool's shortcuts window: that tool's outer ring (up to 10 slices). */
export function ToolRingEditor({ panel }: { panel: Panel }) {
  const outer = useSettings((s) => s.hotwheel.outer)
  // The tool is open, so what it offers can be read once.
  const [{ actions, ownOrder }] = useState(() => toolActions(panel))
  const name = getManifest(panel.type)?.name ?? panel.type
  if (ownOrder) return <p className="muted">{name}'s ring follows your Hotwheel profiles: Pen and keys settings, Hotwheel.</p>
  if (!actions.length) return <p className="muted">{name} has nothing of its own for the outer ring; the inner ring works here as everywhere.</p>
  const ids = outer[panel.type] ?? outerRing(panel).map((a) => a.id)
  const change = (i: number, id: string) => {
    const next = Array.from({ length: 10 }, (_, j) => (j === i ? id : (ids[j] ?? ''))).filter(Boolean)
    set({ outer: { ...outer, [panel.type]: next } })
  }
  const reset = () => {
    const rest = { ...outer }
    delete rest[panel.type]
    set({ outer: rest })
  }
  return (
    <>
      <p className="muted">Up to ten slices, clockwise from the top. Empty slices are left out.</p>
      <div className="tool-ring">
        {Array.from({ length: 10 }, (_, i) => (
          <select key={i} className="input" aria-label={`Slice ${i + 1}`} value={ids[i] ?? ''} onChange={(e) => change(i, e.target.value)}>
            <option value="">Empty</option>
            {actions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        ))}
      </div>
      <button className="btn btn-ghost" disabled={!outer[panel.type]} onClick={reset}>
        Reset this tool's wheel
      </button>
    </>
  )
}
