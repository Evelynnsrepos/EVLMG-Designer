import { Pause, Play } from 'lucide-react'
import { useState } from 'react'
import { saveBinaryFile, safeFileName } from '@/core/export'
import { FPS, FRAMES, fpsOf, framesOf } from './animatedLayers'
import type { SketchEngine } from './engine'
import { canEncodeVideo, exportDrawing, layerFrames, type ExportFormat } from './files/io'
import { exportLayers } from './layers'
import { updateLayer, type SketchDoc, type SketchLayer } from './model'
import { SheetExport } from './SheetExport'

const UI = {
  what: 'This layer moves: the animated brush strokes on it wiggle in a loop. It is not a regular image any more: PNG, JPEG and other still pictures keep only its first frame.',
  frames: 'Frames in the loop',
  speed: 'Speed (frames per second)',
  shared: 'Frames and speed are the same for every animated layer of this drawing.',
  play: 'Play',
  pause: 'Pause (shows frame 1)',
  export: 'Export the loop',
  gif: 'Animated GIF',
  apng: 'Animated PNG',
  webm: 'Video (WebM)',
  webmHere: 'Video (GIF here)',
  sheet: 'Sprite sheet for games',
  noVideo: 'This system cannot make videos, so it was saved as an animated GIF instead.',
  rasterize: 'Make it a normal still layer',
  rasterizeHint: 'Keeps frame 1 as a normal picture and stops the animation. Undo brings it back.',
  working: 'Working…',
}

/** Settings and exports of the active Animated layer (0.35). */
export function AnimatedPanel(p: {
  layer: SketchLayer
  doc: SketchDoc
  engine: SketchEngine
  title: string
  update(fn: (d: SketchDoc) => SketchDoc): void
  paused: boolean
  setPaused(v: boolean): void
  onRasterize(): void
}) {
  const { layer, doc, engine, title } = p
  const w = layer.wiggle!
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [sheet, setSheet] = useState(false)
  // Every animated layer gets the same loop, so they stay in step (and exports have one speed).
  const setAll = (patch: { frames?: number; fps?: number }) =>
    p.update((d) => d.layers.reduce((acc, l) => (l.wiggle ? updateLayer(acc, l.id, { wiggle: { ...l.wiggle, ...patch } }) : acc), d))

  const exportAs = async (format: ExportFormat) => {
    setBusy(true)
    setNote(UI.working)
    try {
      const file = await exportDrawing(format, engine, doc)
      setNote(format === 'webm' && file.ext !== 'webm' ? UI.noVideo : null)
      await saveBinaryFile({ title: UI.export, defaultName: `${safeFileName(title)}.${file.ext}`, bytes: file.bytes, filter: file.filter })
    } catch (e) {
      setNote((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sketch-anim-panel">
      <p className="muted">{UI.what}</p>
      <label className="sketch-anim-row">
        <span>{UI.frames}</span>
        <input type="range" min={FRAMES.min} max={FRAMES.max} step={1} value={framesOf(w)} onChange={(e) => setAll({ frames: Number(e.target.value) })} />
        <b>{framesOf(w)}</b>
      </label>
      <label className="sketch-anim-row">
        <span>{UI.speed}</span>
        <input type="range" min={FPS.min} max={FPS.max} step={1} value={fpsOf(w)} onChange={(e) => setAll({ fps: Number(e.target.value) })} />
        <b>{fpsOf(w)}</b>
      </label>
      {doc.layers.filter((l) => l.wiggle).length > 1 && <p className="muted">{UI.shared}</p>}
      <button className="btn btn-small" onClick={() => p.setPaused(!p.paused)}>
        {p.paused ? <Play size={14} /> : <Pause size={14} />} {p.paused ? UI.play : UI.pause}
      </button>
      <div className="studio-sub">{UI.export}</div>
      <div className="sketch-anim-exports">
        <button className="btn btn-small" disabled={busy} onClick={() => void exportAs('gif')}>
          {UI.gif}
        </button>
        <button className="btn btn-small" disabled={busy} onClick={() => void exportAs('apng')}>
          {UI.apng}
        </button>
        <button className="btn btn-small" disabled={busy} onClick={() => void exportAs('webm')}>
          {canEncodeVideo() ? UI.webm : UI.webmHere}
        </button>
        <button className="btn btn-small" disabled={busy} onClick={() => setSheet(true)}>
          {UI.sheet}
        </button>
      </div>
      {note && <p className="muted">{note}</p>}
      <button className="btn btn-small" title={UI.rasterizeHint} onClick={p.onRasterize}>
        {UI.rasterize}
      </button>
      {sheet && (
        <SheetExport
          title={title}
          onClose={() => setSheet(false)}
          // See-through, without private layers: one frame per step of the loop.
          frames={() => {
            const ms = Math.round(1000 / fpsOf(w))
            return layerFrames(engine, { ...doc, backgroundColor: null, layers: exportLayers(doc.layers) }).map((f) => ({ canvas: f(), ms }))
          }}
        />
      )}
    </div>
  )
}
