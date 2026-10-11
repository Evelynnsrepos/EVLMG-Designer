import { FlipHorizontal2, FlipVertical2, RotateCcwSquare, RotateCwSquare } from 'lucide-react'
import { useState } from 'react'
import { Modal } from '../../ui'
import type { SketchEngine } from '../engine'
import { isGroup, isMask } from '../layers'
import type { SketchDoc } from '../model'
import { maxLayers } from '../tiles'
import { cropCanvas, flipCanvas, formatDuration, MAX_SIDE, resizeCanvas, rotateCanvas, type CanvasChange } from './canvas'
import { pixelsOf } from './io'
import { opaqueBounds } from './psd'

const UI = {
  title: 'Canvas',
  size: 'Size',
  info: 'Info',
  width: 'Width',
  height: 'Height',
  keepRatio: 'Keep proportions',
  resample: 'Scale the picture with the canvas',
  resampleOff: 'The picture keeps its size; the canvas grows or is cut around the picked spot.',
  resampleOn: 'The picture is stretched or shrunk to the new size.',
  anchor: 'Picture stays at',
  apply: 'Change size',
  crop: 'Crop to selection',
  cropHint: 'Select an area with the rectangle or lasso first, then crop to it.',
  turn: 'Flip and turn the whole picture',
  flipX: 'Flip left / right',
  flipY: 'Flip top / bottom',
  rotL: 'Turn left',
  rotR: 'Turn right',
  noUndo: 'Canvas changes clear the undo history.',
  close: 'Close',
  rows: {
    size: 'Canvas size',
    layers: 'Layers',
    groups: 'Groups',
    masks: 'Masks',
    maxLayers: 'Most layers this canvas can hold',
    strokes: 'Strokes',
    time: 'Time spent drawing',
    timelapse: 'Time-lapse frames',
    colorSpace: 'Colour space',
  },
  px: (w: number, h: number) => `${w} × ${h} px`,
}

const ANCHORS = ['↖', '↑', '↗', '←', '•', '→', '↙', '↓', '↘']

/** Crop, resize, flip and turn the canvas, and see its numbers (Sketch Pro). */
export function CanvasDialog(p: { doc: SketchDoc; engine: SketchEngine; busy: boolean; onChange(c: CanvasChange): void; onClose(): void }) {
  const { doc } = p
  const [tab, setTab] = useState<'size' | 'info'>('size')
  const [w, setW] = useState(doc.width)
  const [h, setH] = useState(doc.height)
  const [ratio, setRatio] = useState(true)
  const [anchor, setAnchor] = useState(4)
  const [resample, setResample] = useState(false)
  const apply = (c: CanvasChange | null) => {
    if (!c) return
    p.onChange(c)
    p.onClose()
  }
  const setWidth = (v: number) => {
    setW(v)
    if (ratio) setH(Math.max(1, Math.round((v * doc.height) / doc.width)))
  }
  const setHeight = (v: number) => {
    setH(v)
    if (ratio) setW(Math.max(1, Math.round((v * doc.width) / doc.height)))
  }
  const mask = p.engine.selectionMask
  const cropToSelection = () => {
    if (!mask) return
    const b = opaqueBounds(pixelsOf(mask, doc.width, doc.height))
    if (b) apply(cropCanvas(doc.width, doc.height, { x: b.left, y: b.top, w: b.right - b.left, h: b.bottom - b.top }))
  }
  const layers = doc.layers.filter((l) => !isGroup(l) && !isMask(l)).length
  const rows: [string, string | number][] = [
    [UI.rows.size, UI.px(doc.width, doc.height)],
    [UI.rows.layers, layers],
    [UI.rows.groups, doc.layers.filter(isGroup).length],
    [UI.rows.masks, doc.layers.filter(isMask).length],
    [UI.rows.maxLayers, maxLayers(doc.width, doc.height)],
    [UI.rows.strokes, doc.stats?.strokes ?? 0],
    [UI.rows.time, formatDuration(doc.stats?.timeMs ?? 0)],
    [UI.rows.timelapse, doc.timelapse?.frames.length ?? 0],
    [UI.rows.colorSpace, doc.colorSpace === 'display-p3' ? 'Display P3' : 'sRGB'],
  ]
  return (
    <Modal onClose={p.onClose}>
      <div className="sketch-canvas-dlg">
        <div className="sketch-canvas-tabs">
          <h3>{UI.title}</h3>
          <button className={`btn btn-ghost${tab === 'size' ? ' is-active' : ''}`} onClick={() => setTab('size')}>
            {UI.size}
          </button>
          <button className={`btn btn-ghost${tab === 'info' ? ' is-active' : ''}`} onClick={() => setTab('info')}>
            {UI.info}
          </button>
        </div>
        {tab === 'size' ? (
          <>
            <div className="sketch-canvas-size">
              <label>
                {UI.width}
                <input className="input" type="number" min={1} max={MAX_SIDE} value={w} onChange={(e) => setWidth(Number(e.target.value))} />
              </label>
              <span>×</span>
              <label>
                {UI.height}
                <input className="input" type="number" min={1} max={MAX_SIDE} value={h} onChange={(e) => setHeight(Number(e.target.value))} />
              </label>
            </div>
            <label className="sketch-check">
              <input type="checkbox" checked={ratio} onChange={(e) => setRatio(e.target.checked)} /> {UI.keepRatio}
            </label>
            <label className="sketch-check">
              <input type="checkbox" checked={resample} onChange={(e) => setResample(e.target.checked)} /> {UI.resample}
            </label>
            <p className="muted sketch-canvas-hint">{resample ? UI.resampleOn : UI.resampleOff}</p>
            {!resample && (
              <div className="sketch-canvas-anchor-row">
                <span>{UI.anchor}</span>
                <div className="sketch-canvas-anchor">
                  {ANCHORS.map((a, i) => (
                    <button key={i} className={`btn${anchor === i ? ' btn-primary' : ''}`} aria-pressed={anchor === i} onClick={() => setAnchor(i)}>
                      {a}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="sketch-canvas-actions">
              <button className="btn btn-primary" disabled={p.busy || (w === doc.width && h === doc.height)} onClick={() => apply(resizeCanvas(doc.width, doc.height, w, h, anchor, resample))}>
                {UI.apply}
              </button>
              <button className="btn" disabled={p.busy || !mask} title={mask ? undefined : UI.cropHint} onClick={cropToSelection}>
                {UI.crop}
              </button>
            </div>
            <h4>{UI.turn}</h4>
            <div className="sketch-canvas-actions">
              <button className="btn" disabled={p.busy} onClick={() => apply(flipCanvas(doc.width, doc.height, 'x'))}>
                <FlipVertical2 size={14} /> {UI.flipX}
              </button>
              <button className="btn" disabled={p.busy} onClick={() => apply(flipCanvas(doc.width, doc.height, 'y'))}>
                <FlipHorizontal2 size={14} /> {UI.flipY}
              </button>
              <button className="btn" disabled={p.busy} onClick={() => apply(rotateCanvas(doc.width, doc.height, -1))}>
                <RotateCcwSquare size={14} /> {UI.rotL}
              </button>
              <button className="btn" disabled={p.busy} onClick={() => apply(rotateCanvas(doc.width, doc.height, 1))}>
                <RotateCwSquare size={14} /> {UI.rotR}
              </button>
            </div>
            <p className="muted sketch-canvas-hint">{UI.noUndo}</p>
          </>
        ) : (
          <table className="sketch-canvas-info">
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k}>
                  <th>{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={p.onClose}>
            {UI.close}
          </button>
        </div>
      </div>
    </Modal>
  )
}
