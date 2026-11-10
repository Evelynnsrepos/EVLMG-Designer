import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { PixelDoc } from '@/shared/pixel/model'
import type { Ease } from '@/shared/pixel/shapes'
import { withInBetweens, withShapes, type useShapeTool } from './shapeTool'

const UI = {
  title: 'Shape layer',
  intro: 'Shapes stay editable: drag their points with the Shape tool, fill them with the bucket. Draw a rough shape with the pencil and it becomes one too.',
  none: 'Nothing selected. Click a shape with the Shape tool.',
  outline: 'Outline',
  fill: 'Fill',
  useMain: 'Main colour',
  noColor: 'None',
  width: 'Width',
  smooth: 'Smooth curve',
  closed: 'Closed',
  animation: 'Animation',
  key: 'This frame is a key (drawn by you).',
  between: 'This frame is an in-between. Change it and it becomes a key.',
  ease: 'Timing',
  eases: { even: 'Even', in: 'Slow start', out: 'Slow end', inout: 'Slow start and end' } as Record<Ease, string>,
  fillBetween: 'Fill in-betweens',
  fillBetweenHelp: 'Every frame between two keys gets the shapes moved part way, so a shape glides from one key to the next.',
  bake: 'Turn into pixels',
  bakeHelp: 'Keeps the pixels and drops the shapes (undo brings them back).',
}

/** Settings for the selected live shape, in-betweens, and turning the layer into pixels. */
export function ShapePanel({ d, layerId, frameKey, tool, update, main }: { d: PixelDoc; layerId: string; frameKey: string; tool: ReturnType<typeof useShapeTool>; update(fn: (x: PixelDoc) => PixelDoc): void; main: string }) {
  const [ease, setEase] = useState<Ease>('even')
  const s = tool.selected
  const cel = d.shapes?.[frameKey]
  const i = s ? tool.list.findIndex((x) => x.id === s.id) : -1
  const reorder = (by: number) => {
    const j = i + by
    if (j < 0 || j >= tool.list.length) return
    const next = [...tool.list]
    ;[next[i], next[j]] = [next[j], next[i]]
    tool.write(next)
  }
  const swatch = (label: string, value: string | undefined, set: (v: string | undefined) => void) => (
    <div className="px-row">
      {label}
      <span className="px-color-dot" style={{ background: value ?? 'transparent' }} title={value ?? UI.noColor} />
      <button className="btn btn-ghost" onClick={() => set(main)}>
        {UI.useMain}
      </button>
      <button className="btn btn-ghost" disabled={!value} onClick={() => set(undefined)}>
        {UI.noColor}
      </button>
    </div>
  )
  return (
    <div className="px-panel">
      <strong>{UI.title}</strong>
      <p className="px-note">{UI.intro}</p>
      {!s && <p className="px-note">{UI.none}</p>}
      {s && (
        <>
          {swatch(UI.outline, s.strokeColor, (strokeColor) => tool.change(s.id, { strokeColor }))}
          {swatch(UI.fill, s.fillColor, (fillColor) => tool.change(s.id, { fillColor }))}
          <label className="px-row">
            {UI.width} <input className="input px-ms" type="number" min={1} max={16} value={s.width} onChange={(e) => tool.change(s.id, { width: Math.max(1, Math.min(16, Number(e.target.value) || 1)) })} />
          </label>
          <label className="px-row">
            <input type="checkbox" checked={!!s.smooth} onChange={(e) => tool.change(s.id, { smooth: e.target.checked || undefined })} /> {UI.smooth}
          </label>
          <label className="px-row">
            <input type="checkbox" checked={s.closed} disabled={s.points.length < 3} onChange={(e) => tool.change(s.id, { closed: e.target.checked })} /> {UI.closed}
          </label>
          <div className="px-row">
            <button className="icon-btn" title="Bring forward" onClick={() => reorder(1)}>
              <ArrowUp size={13} />
            </button>
            <button className="icon-btn" title="Send backward" onClick={() => reorder(-1)}>
              <ArrowDown size={13} />
            </button>
            <button
              className="icon-btn"
              title="Delete shape"
              onClick={() => {
                tool.write(tool.list.filter((x) => x.id !== s.id))
                tool.setSel(null)
              }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </>
      )}
      {d.kind === 'sprite' && d.frames.length > 1 && (
        <>
          <strong>{UI.animation}</strong>
          {cel && <p className="px-note">{cel.key ? UI.key : UI.between}</p>}
          <label className="px-row">
            {UI.ease}
            <select className="input" value={ease} onChange={(e) => setEase(e.target.value as Ease)}>
              {(Object.keys(UI.eases) as Ease[]).map((k) => (
                <option key={k} value={k}>
                  {UI.eases[k]}
                </option>
              ))}
            </select>
          </label>
          <button className="btn" title={UI.fillBetweenHelp} onClick={() => update((x) => withInBetweens(x, layerId, ease))}>
            {UI.fillBetween}
          </button>
          {cel && !cel.key && (
            <button className="btn btn-ghost" onClick={() => update((x) => withShapes(x, frameKey, cel.list, true))}>
              Make this a key
            </button>
          )}
        </>
      )}
      <button
        className="btn btn-ghost"
        title={UI.bakeHelp}
        onClick={() =>
          update((x) => ({
            ...x,
            layers: x.layers.map((l) => (l.id === layerId ? { ...l, vector: undefined } : l)),
            shapes: Object.fromEntries(Object.entries(x.shapes ?? {}).filter(([k]) => !k.startsWith(`${layerId}:`))),
          }))
        }
      >
        {UI.bake}
      </button>
    </div>
  )
}
