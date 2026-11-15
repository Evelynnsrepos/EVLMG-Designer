import { Crop, Download, FileUp, Film, PictureInPicture2 } from 'lucide-react'
import { frameOf } from '../growth'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { importAssetFromBlob } from '@/core/assets'
import { retireAssets } from '@/core/backups'
import { newId, type AssetPath, type Id } from '@/core/model'
import { saveBinaryFile, safeFileName } from '@/core/export'
import type { SketchEngine } from '../engine'
import { exportLayers, isGroup } from '../layers'
import { newLayer, type SketchDoc, type SketchLayer } from '../model'
import { addStroke, fitSize, flipCanvas, MAX_SIDE, mapPoint, shouldRecord, type CanvasChange, type DrawingStats } from './canvas'
import { CanvasDialog } from './CanvasDialog'
import { CompanionWindow } from './CompanionWindow'
import { applyChange, canEncodeVideo, canvasBlob, canvasOf, exportDrawing, IMPORT_EXTENSIONS, makeCanvas, pickFiles, readAssetImage, readImport, type ExportFormat } from './io'
import type { PsdFile } from './psd'
import { TimelapseDialog } from './TimelapseDialog'
import './files.css'

const UI = {
  canvas: 'Canvas: crop, resize, flip and info',
  import: 'Import a file (PSD, PNG, JPEG, GIF, TIFF)',
  importTitle: 'Import into this drawing',
  export: 'Export…',
  timelapse: 'Time-lapse replay',
  companion: 'Reference Companion: the whole canvas (or an image) in a small window',
  working: 'Working…',
  formats: [
    { id: 'png', label: 'PNG image' },
    { id: 'jpeg', label: 'JPEG image' },
    { id: 'tiff', label: 'TIFF image' },
    { id: 'psd', label: 'Photoshop file (PSD) with layers' },
    { id: 'layers', label: 'Each layer as a PNG (zip)' },
  ] as { id: ExportFormat; label: string }[],
  animTitle: 'Animation: each visible top-level layer or group is one frame',
  animAssist: 'Animation: the Animation Assist frames, at its speed',
  animFormats: [
    { id: 'gif', label: 'Animated GIF' },
    { id: 'apng', label: 'Animated PNG' },
    { id: 'webm', label: 'Video (WebM)' },
  ] as { id: ExportFormat; label: string }[],
  fps: 'Frames per second',
  noVideo: 'This system cannot make videos, so it was saved as an animated GIF instead.',
  imported: (n: number) => (n === 1 ? 'Imported 1 layer.' : `Imported ${n} layers.`),
  tooBig: (w: number, h: number) => `The file is ${w} × ${h}; canvases are at most ${MAX_SIDE} px per side, so it was cut.`,
}

export interface FilesHost {
  doc: SketchDoc
  update(recipe: (d: SketchDoc) => SketchDoc): void
  engine: SketchEngine
  root: string | null
  title: string
  activeId?: Id
  setActive(id: Id): void
  /** Save pending layer pixels (before the canvas is replaced). */
  flush(): Promise<void>
  /** Fit the canvas into the view. */
  fit(): void
}

/** Nothing drawn yet: an import then takes over the canvas size. */
function blankDrawing(doc: SketchDoc, engine: SketchEngine) {
  return doc.layers.every((l) => isGroup(l) || (!l.image && engine.isEmpty(l.id)))
}

/**
 * Canvas, time-lapse and files for SketchEditor (Sketch Pro): counts strokes and
 * drawing time, records the time-lapse, and gives the toolbar buttons, dialogs
 * and the Reference Companion window.
 */
export function useSketchFiles(host: FilesHost) {
  const hostRef = useRef(host)
  useEffect(() => {
    hostRef.current = host
  })
  const [dialog, setDialog] = useState<'canvas' | 'timelapse' | null>(null)
  const [menu, setMenu] = useState(false)
  const [fps, setFps] = useState(8)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const say = (text: string) => {
    setNote(text)
    setTimeout(() => setNote((n) => (n === text ? null : n)), 5000)
  }

  // ---- Strokes, drawing time and time-lapse frames -------------------------------

  const lastStroke = useRef<number | null>(null)
  const pending = useRef<DrawingStats | null>(null)
  const statsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const writeStats = useCallback(() => {
    const s = pending.current
    if (!s) return
    pending.current = null
    hostRef.current.update((d) => ({ ...d, stats: s }))
  }, [])
  useEffect(() => () => writeStats(), [writeStats])

  const recordFrame = async () => {
    const { doc, engine, root, update } = hostRef.current
    if (!root) return
    const f = frameOf(doc)
    const size = fitSize(f.w, f.h)
    const { canvas, ctx } = makeCanvas(size.width, size.height)
    ctx.fillStyle = doc.backgroundColor ?? '#ffffff'
    ctx.fillRect(0, 0, size.width, size.height)
    // Shrunk on the GPU when there is one: reading back and shrinking the whole picture stalled quick strokes.
    ctx.drawImage(engine.shrunk({ ...doc, layers: exportLayers(doc.layers) }, size.width, size.height), 0, 0)
    const asset = await importAssetFromBlob(root, await canvasBlob(canvas, 'image/jpeg', 0.8), 'image', 'timelapse.jpg')
    if (asset) update((d) => ({ ...d, timelapse: { ...d.timelapse, frames: [...(d.timelapse?.frames ?? []), asset.path] } }))
  }

  /** Call after every finished stroke. */
  const stroked = () => {
    const now = Date.now()
    const s = addStroke(pending.current ?? hostRef.current.doc.stats, now, lastStroke.current)
    lastStroke.current = now
    pending.current = s
    if (statsTimer.current) clearTimeout(statsTimer.current)
    statsTimer.current = setTimeout(writeStats, 1500)
    if (hostRef.current.doc.timelapse?.enabled !== false && shouldRecord(s.strokes)) void recordFrame().catch(() => {})
  }

  // ---- Canvas changes ---------------------------------------------------------------

  /** Redraw every layer, saved selection and the sticker onto the changed canvas. Not undoable. */
  const changeCanvas = async (c: CanvasChange) => {
    const h = hostRef.current
    if (!h.root || busy) return
    const root = h.root
    setBusy(true)
    try {
      await h.flush()
      const { doc, engine } = hostRef.current
      const save = async (canvas: HTMLCanvasElement) => (await importAssetFromBlob(root, await canvasBlob(canvas), 'image', 'layer.png'))?.path ?? null
      const paths = new Map<Id, AssetPath | null>()
      for (const l of doc.layers) if (!isGroup(l)) paths.set(l.id, engine.isEmpty(l.id) ? null : await save(applyChange(engine.layerCanvas(l.id), c)))
      const sticker = await save(applyChange(engine.render({ ...doc, layers: exportLayers(doc.layers) }, false), c))
      const selections = await Promise.all(
        (doc.selections ?? []).map(async (s) => ({ ...s, image: (await save(applyChange(await readAssetImage(root, s.image), c))) ?? s.image })),
      )
      const guide = doc.guide && { ...doc.guide, center: mapPoint(c, doc.guide.center), vanishing: doc.guide.vanishing.map((p) => mapPoint(c, p)) }
      // 0.31: the frame (the picked canvas inside a grown working area) goes along, kept inside the new canvas.
      const frame = doc.frame && (() => {
        const a = mapPoint(c, { x: doc.frame.x, y: doc.frame.y })
        const b = mapPoint(c, { x: doc.frame.x + doc.frame.w, y: doc.frame.y + doc.frame.h })
        const x = Math.max(0, Math.min(a.x, b.x))
        const y = Math.max(0, Math.min(a.y, b.y))
        const w = Math.min(c.width, Math.max(a.x, b.x)) - x
        const h = Math.min(c.height, Math.max(a.y, b.y)) - y
        return w >= 1 && h >= 1 ? { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) } : undefined
      })()
      const old: string[] = []
      h.update((d) => {
        old.push(...d.layers.map((l) => l.image ?? ''), d.sticker ?? '', ...(d.selections ?? []).map((s) => s.image))
        return {
          ...d,
          width: c.width,
          height: c.height,
          layers: d.layers.map((l) => (paths.has(l.id) ? { ...l, image: paths.get(l.id)! } : l)),
          sticker,
          ...(d.selections ? { selections } : {}),
          ...(guide ? { guide } : {}),
          frame,
        }
      })
      // Retired, not deleted: a backup may still show the old picture.
      void retireAssets(root, old)
      setTimeout(() => hostRef.current.fit(), 50)
    } finally {
      setBusy(false)
    }
  }

  // ---- Import ----------------------------------------------------------------------

  const place = async (file: PsdFile, fileName: string) => {
    const { doc, engine, root, update } = hostRef.current
    if (!root) return
    const blank = blankDrawing(doc, engine)
    const width = blank ? Math.min(MAX_SIDE, file.width) : doc.width
    const height = blank ? Math.min(MAX_SIDE, file.height) : doc.height
    if (blank && (file.width > MAX_SIDE || file.height > MAX_SIDE)) say(UI.tooBig(file.width, file.height))
    // Into an existing drawing the file is fitted and centred.
    const k = blank ? 1 : Math.min(1, width / file.width, height / file.height)
    const dx = blank ? 0 : (width - file.width * k) / 2
    const dy = blank ? 0 : (height - file.height * k) / 2
    const ids = new Map(file.layers.map((l) => [l.id, newId()]))
    const group = !blank && file.layers.length > 1 ? newId() : null
    const layers: SketchLayer[] = []
    for (const l of file.layers) {
      const parent = l.parent ? ids.get(l.parent) : group
      let image: AssetPath | null = null
      if (l.pixels) {
        const { canvas, ctx } = makeCanvas(width, height)
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(canvasOf(l.pixels), dx + l.pixels.left * k, dy + l.pixels.top * k, l.pixels.width * k, l.pixels.height * k)
        image = (await importAssetFromBlob(root, await canvasBlob(canvas), 'image', 'layer.png'))?.path ?? null
      }
      layers.push({
        ...newLayer(l.name),
        id: ids.get(l.id)!,
        opacity: l.opacity,
        blend: l.blend,
        visible: l.visible,
        clip: l.clip,
        ...(l.kind ? { kind: l.kind } : {}),
        ...(l.collapsed ? { collapsed: true } : {}),
        ...(parent ? { parent } : {}),
        image,
      })
    }
    if (group) layers.push({ ...newLayer(fileName.replace(/\.[^.]+$/, '')), id: group, kind: 'group' })
    if (blank) {
      update((d) => ({ ...d, width, height, layers }))
      setTimeout(() => hostRef.current.fit(), 50)
    } else update((d) => ({ ...d, layers: [...d.layers, ...layers] }))
    const top = [...layers].reverse().find((l) => !l.kind)
    if (top) hostRef.current.setActive(top.id)
    say(UI.imported(layers.filter((l) => !l.kind).length))
  }

  const importFiles = async () => {
    const files = await pickFiles(UI.importTitle, IMPORT_EXTENSIONS)
    if (!files.length) return
    setBusy(true)
    try {
      for (const f of files) {
        try {
          await place(await readImport(f.name, f.bytes), f.name)
        } catch (e) {
          say((e as Error).message)
        }
      }
    } finally {
      setBusy(false)
    }
  }

  // ---- Export ----------------------------------------------------------------------

  const exportAs = async (format: ExportFormat) => {
    setMenu(false)
    const { engine, doc, title } = hostRef.current
    setBusy(true)
    try {
      const file = await exportDrawing(format, engine, doc, fps)
      if (format === 'webm' && file.ext !== 'webm') say(UI.noVideo)
      await saveBinaryFile({ title: UI.export, defaultName: `${safeFileName(title)}.${file.ext}`, bytes: file.bytes, filter: file.filter })
    } catch (e) {
      say((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // ---- UI -------------------------------------------------------------------------

  const { doc, engine } = host
  const companionOpen = !!doc.companion
  const toggleCompanion = () =>
    hostRef.current.update((d) => ({ ...d, companion: d.companion ? undefined : { mode: 'canvas', image: null, x: 24, y: 24, width: 260 } }))

  const buttons: ReactNode = (
    <>
      <button className="icon-btn sketch-tool" title={UI.canvas} aria-label={UI.canvas} onClick={() => setDialog('canvas')}>
        <Crop size={16} />
      </button>
      <button className="icon-btn sketch-tool" title={UI.import} aria-label={UI.import} disabled={busy} onClick={() => void importFiles()}>
        <FileUp size={16} />
      </button>
      <span className="sketch-files-export">
        <button className={`icon-btn sketch-tool${menu ? ' is-active' : ''}`} title={UI.export} aria-label={UI.export} disabled={busy} onClick={() => setMenu(!menu)}>
          <Download size={16} />
        </button>
        {menu && (
          <div className="menu sketch-files-menu" onMouseLeave={() => setMenu(false)}>
            {UI.formats.map((f) => (
              <button key={f.id} onClick={() => void exportAs(f.id)}>
                {f.label}
              </button>
            ))}
            <div className="sketch-files-menu-head">{doc.animation?.on ? UI.animAssist : UI.animTitle}</div>
            {UI.animFormats.map((f) => (
              <button key={f.id} onClick={() => void exportAs(f.id)}>
                {f.label}
                {f.id === 'webm' && !canEncodeVideo() ? ' (GIF here)' : ''}
              </button>
            ))}
            <label className="sketch-files-fps" hidden={!!doc.animation?.on}>
              {UI.fps}
              <select className="input" value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                {[2, 4, 6, 8, 12, 15, 24, 30].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </span>
      <button className="icon-btn sketch-tool" title={UI.timelapse} aria-label={UI.timelapse} onClick={() => setDialog('timelapse')}>
        <Film size={16} />
      </button>
      <button className={`icon-btn sketch-tool${companionOpen ? ' is-active' : ''}`} title={UI.companion} aria-label={UI.companion} aria-pressed={companionOpen} onClick={toggleCompanion}>
        <PictureInPicture2 size={16} />
      </button>
    </>
  )

  /** Goes inside the stage, over the canvas. */
  const stage: ReactNode = (
    <>
      {doc.companion && (
        <CompanionWindow
          doc={doc}
          engine={engine}
          companion={doc.companion}
          onChange={(patch) => hostRef.current.update((d) => ({ ...d, companion: d.companion && { ...d.companion, ...patch } }))}
          onClose={toggleCompanion}
        />
      )}
      {(busy || note) && <div className="sketch-files-note">{busy ? UI.working : note}</div>}
    </>
  )

  const dialogs: ReactNode = (
    <>
      {dialog === 'canvas' && <CanvasDialog doc={doc} engine={engine} busy={busy} onChange={(c) => void changeCanvas(c)} onClose={() => setDialog(null)} />}
      {dialog === 'timelapse' && <TimelapseDialog host={host} onClose={() => setDialog(null)} />}
    </>
  )

  const actions = {
    canvasSettings: () => setDialog('canvas'),
    flipCanvasX: () => void changeCanvas(flipCanvas(doc.width, doc.height, 'x')),
    flipCanvasY: () => void changeCanvas(flipCanvas(doc.width, doc.height, 'y')),
    importFile: () => void importFiles(),
    timelapse: () => setDialog('timelapse'),
    companion: toggleCompanion,
  }

  return { stroked, buttons, stage, dialogs, actions }
}
