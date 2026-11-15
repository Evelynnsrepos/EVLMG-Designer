import { Pause, Play } from 'lucide-react'
import { frameOf } from '../growth'
import { useEffect, useRef, useState } from 'react'
import { resolveAssetPath } from '@/core/assets'
import { getFs } from '@/core/fs'
import { saveBinaryFile, safeFileName } from '@/core/export'
import { Modal } from '../../ui'
import { exportLayers } from '../layers'
import { fitSize, REPLAY_FPS, replayPlan } from './canvas'
import { canEncodeVideo, encodeAnimation, makeCanvas, readAssetImage, timelapseFrames } from './io'
import type { FilesHost } from './SketchFiles'

const UI = {
  title: 'Time-lapse',
  record: 'Record a time-lapse while I draw',
  recordHint: 'A small picture is kept every few strokes, in this project.',
  none: 'Nothing recorded yet. Draw a few strokes and come back.',
  frames: (n: number) => `${n} frames, ${Math.round(n / REPLAY_FPS)} s at full speed`,
  play: 'Play',
  pause: 'Pause',
  export: 'Export',
  full: 'Full length',
  short: '30 seconds',
  format: 'As',
  formats: { webm: 'Video (WebM)', gif: 'Animated GIF', apng: 'Animated PNG' },
  noVideo: 'This system cannot make videos, so it was saved as an animated GIF instead.',
  progress: (a: number, b: number) => `Making the file… ${a} / ${b}`,
  clear: 'Delete recording',
  confirmClear: 'Delete every recorded time-lapse frame of this drawing?',
  close: 'Close',
}

const NONE: string[] = []

/** Replay the recorded time-lapse and export it (Sketch Pro). */
export function TimelapseDialog({ host, onClose }: { host: FilesHost; onClose: () => void }) {
  const { doc, update, root } = host
  const frames = doc.timelapse?.frames ?? NONE
  const recording = doc.timelapse?.enabled !== false
  const [index, setIndex] = useState(Math.max(0, frames.length - 1))
  const [playing, setPlaying] = useState(false)
  const [format, setFormat] = useState<'webm' | 'gif' | 'apng'>(canEncodeVideo() ? 'webm' : 'gif')
  const [progress, setProgress] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const view = useRef<HTMLCanvasElement>(null)

  // Show the current frame.
  useEffect(() => {
    if (!root || !frames[index]) return
    let gone = false
    void readAssetImage(root, frames[index])
      .then((bmp) => {
        const c = view.current
        if (gone || !c) return
        c.width = bmp.width
        c.height = bmp.height
        c.getContext('2d')!.drawImage(bmp, 0, 0)
      })
      .catch(() => {})
    return () => {
      gone = true
    }
  }, [root, frames, index])

  useEffect(() => {
    if (!playing) return
    const t = setTimeout(() => {
      if (index + 1 >= frames.length) setPlaying(false)
      else setIndex(index + 1)
    }, 1000 / REPLAY_FPS)
    return () => clearTimeout(t)
  }, [playing, index, frames.length])

  const exportAs = async (mode: 'full' | 'short') => {
    if (!root || !frames.length) return
    const { engine, title } = host
    const plan = replayPlan(frames.length, mode)
    const f = frameOf(doc)
    const size = fitSize(f.w, f.h)
    const final = () => {
      const { canvas, ctx } = makeCanvas(f.w, f.h)
      ctx.fillStyle = doc.backgroundColor ?? '#ffffff'
      ctx.fillRect(0, 0, f.w, f.h)
      ctx.drawImage(engine.render({ ...doc, layers: exportLayers(doc.layers) }, false), -f.x, -f.y)
      return canvas
    }
    setProgress(UI.progress(0, plan.length))
    setBusy(true)
    try {
      const file = await encodeAnimation(format, size.width, size.height, timelapseFrames(root, frames, plan, final), (n) => setProgress(UI.progress(n, plan.length)))
      setProgress(format === 'webm' && file.ext !== 'webm' ? UI.noVideo : null)
      await saveBinaryFile({ title: UI.export, defaultName: `${safeFileName(title)} time-lapse${mode === 'short' ? ' 30s' : ''}.${file.ext}`, bytes: file.bytes, filter: file.filter })
    } catch (e) {
      setProgress((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const clear = () => {
    if (!root || !window.confirm(UI.confirmClear)) return
    for (const p of frames) void resolveAssetPath(root, p).then((abs) => getFs().remove(abs).catch(() => {}))
    update((d) => ({ ...d, timelapse: { ...d.timelapse, frames: [] } }))
    setIndex(0)
  }

  return (
    <Modal onClose={onClose}>
      <div className="sketch-timelapse">
        <h3>{UI.title}</h3>
        <label className="sketch-check">
          <input type="checkbox" checked={recording} onChange={(e) => update((d) => ({ ...d, timelapse: { frames: d.timelapse?.frames ?? [], enabled: e.target.checked } }))} /> {UI.record}
        </label>
        <p className="muted sketch-canvas-hint">{UI.recordHint}</p>
        {frames.length ? (
          <>
            <div className="sketch-timelapse-view">
              <canvas ref={view} />
            </div>
            <div className="sketch-timelapse-controls">
              <button
                className="icon-btn"
                title={playing ? UI.pause : UI.play}
                aria-label={playing ? UI.pause : UI.play}
                onClick={() => {
                  if (!playing && index >= frames.length - 1) setIndex(0)
                  setPlaying(!playing)
                }}
              >
                {playing ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <input type="range" min={0} max={frames.length - 1} value={index} onChange={(e) => setIndex(Number(e.target.value))} />
              <span className="muted">{UI.frames(frames.length)}</span>
            </div>
            <div className="sketch-canvas-actions">
              <span>{UI.export}</span>
              <button className="btn" disabled={busy} onClick={() => void exportAs('full')}>
                {UI.full}
              </button>
              <button className="btn" disabled={busy} onClick={() => void exportAs('short')}>
                {UI.short}
              </button>
              <label className="sketch-files-fps">
                {UI.format}
                <select className="input" value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
                  {(['webm', 'gif', 'apng'] as const).map((f) => (
                    <option key={f} value={f}>
                      {UI.formats[f]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {progress && <p className="muted">{progress}</p>}
          </>
        ) : (
          <p className="muted">{UI.none}</p>
        )}
        <div className="modal-actions">
          {frames.length > 0 && (
            <button className="btn btn-ghost" disabled={busy} onClick={clear}>
              {UI.clear}
            </button>
          )}
          <span className="sketch-spacer" />
          <button className="btn" onClick={onClose}>
            {UI.close}
          </button>
        </div>
      </div>
    </Modal>
  )
}
