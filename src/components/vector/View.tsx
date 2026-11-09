import { zipSync } from 'fflate'
import { Frame, Shapes } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { safeFileName, saveBinaryFile, saveTextFile } from '@/core/export'
import { readDocument } from '@/core/project'
import type { PanelProps } from '@/core/registry'
import { useDocument, useProjectStore } from '@/core/state'
import {
  addNodes,
  CanvasEditor,
  fitRect,
  handTool,
  rectFromPoints,
  resolveActiveLayer,
  selectTool,
  textTool,
  updateNodes,
  useCanvasState,
  type CanvasApi,
  type CanvasTool,
  type Point,
  type Scene,
} from '@/shared/canvas'
import { LayersPanel } from '@/shared/moodboard/LayersPanel'
import type { MoodNode } from '@/shared/moodboard/model'
import '@/shared/moodboard/moodboard.css'
import { ColorPanel } from '@/shared/sketch/ColorPanel'
import { createVectorDoc, LOOKS, makeShape, OUTLINE_DARK, PRESETS, shade, startFrom, toSvg, type Preset, type ShapeNode, type VectorDoc, type VectorNode } from './model'
import { VECTOR_NODE_TYPES } from './nodeTypes'
import { SHAPE_DEFAULTS, SHAPE_LABEL, SHAPE_SLIDERS, SHAPES, shapePath, type ShapeKind } from './shapes'
import './vector.css'
import { atlasGrid, godotAtlasTexture } from '../card-designer/exportFormats'
import { canvasBytes } from '@/shared/print'
import { SendMenu } from '@/shell/editor/SendMenu'

const T = {
  start: 'What are you making?',
  startHint: 'Pick one to get the right size. You can change the size later.',
  shapes: 'Add a shape',
  look: 'Look',
  looks: 'One-click looks',
  fill: 'Colour',
  gradient: 'Fade to a second colour',
  outline: 'Outline',
  shadow: 'Shadow',
  opacity: 'See-through',
  shape: 'Shape',
  corner: 'Rounded corners',
  arrange: 'Place',
  centre: 'Centre on the drawing',
  artboard: 'Drawing size',
  background: 'Background',
  transparent: 'See-through background',
  preview: 'At game size',
  exportTitle: 'Save as…',
  png: 'Save PNG',
  svg: 'Save SVG',
  godot: 'Godot: all icons',
  godotHint: 'Every Vector drawing in this project on one sprite sheet, at the smallest size you ticked, with a .tres file for each icon (put the folder in res://icons/).',
  nothing: 'Select a shape to change its look. Nothing selected: new shapes get these colours.',
}

const PREVIEW_SIZES = [16, 32, 64, 128]
const EXPORT_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
const SWATCHES = ['#ffffff', '#ced4da', '#495057', OUTLINE_DARK, '#fa5252', '#e03170', '#be4bdb', '#7950f2', '#4c6ef5', '#4dabf7', '#15aabf', '#12b886', '#40c057', '#82c91e', '#fab005', '#fd7e14', '#b5835a']

/** Small picture of a shape for the buttons, from the same path data as the canvas. */
function ShapeIcon({ shapeId }: { shapeId: ShapeKind }) {
  return (
    <svg viewBox="-2 -2 28 28" width={22} height={22} aria-hidden>
      <path d={shapePath({ shapeId, width: 24, height: 24, ...SHAPE_DEFAULTS[shapeId] })} fill="currentColor" fillRule="nonzero" />
    </svg>
  )
}

function dataUrlBytes(url: string) {
  return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0))
}

/** A Vector drawing as a canvas with its longest side `size` px, drawn from its SVG. shortcut: text uses a fallback font (an SVG picture can't load app fonts), render on the canvas if icons with text look off. */
async function svgCanvas(d: Pick<VectorDoc, 'artboard' | 'scene'>, size: number) {
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(toSvg(d))}`
  await img.decode()
  const k = size / Math.max(d.artboard.width, d.artboard.height)
  const c = document.createElement('canvas')
  c.width = Math.round(d.artboard.width * k)
  c.height = Math.round(d.artboard.height * k)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return c
}

function StartScreen({ onPick }: { onPick(p: Preset): void }) {
  return (
    <div className="vec-start">
      <h2>{T.start}</h2>
      <p className="vec-muted">{T.startHint}</p>
      <div className="vec-start-grid">
        {PRESETS.map((p) => (
          <button key={p.id} className="vec-start-pick" onClick={() => onPick(p)}>
            <span className="vec-start-thumb">
              {/* The drawing's shape, so the size is easy to picture. */}
              <span className="vec-start-size" style={{ width: p.width * Math.min(150 / p.width, 90 / p.height), height: p.height * Math.min(150 / p.width, 90 / p.height) }} />
            </span>
            <strong>{p.label}</strong>
            <span className="vec-muted">{p.hint}</span>
            <span className="vec-muted vec-small">
              {p.width} × {p.height} px
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function ColourButton({ value, onPick, label, allowNone }: { value: string | undefined; onPick(c: string | undefined): void; label: string; allowNone?: boolean }) {
  const [r, setR] = useState<DOMRect | null>(null)
  const open = !!r
  const setOpen = (v: boolean) => setR(v && btn.current ? btn.current.getBoundingClientRect() : null)
  const btn = useRef<HTMLButtonElement>(null)
  const none = !value || value === 'transparent'
  return (
    <>
      <button ref={btn} className={`vec-colour${none ? ' vec-colour-none' : ''}`} style={none ? undefined : { background: value }} title={label} aria-label={label} onClick={() => setOpen(!open)} />
      {open && r && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="custom-color-pop vec-colour-pop" style={{ left: Math.max(8, Math.min(r.left - 260, window.innerWidth - 300)), top: Math.min(r.bottom + 6, window.innerHeight - 420) }} onPointerDown={(e) => e.stopPropagation()}>
            <div className="vec-swatches">
              {allowNone && <button className="vec-colour vec-colour-none" title="None" aria-label="None" onClick={() => onPick(undefined)} />}
              {SWATCHES.map((c) => (
                <button key={c} className="vec-colour" style={{ background: c }} title={c} aria-label={c} onClick={() => onPick(c)} />
              ))}
            </div>
            <ColorPanel color={none ? '#4dabf7' : value!} setColor={(c) => onPick(c)} swatches={[]} />
          </div>
        </>
      )}
    </>
  )
}

function Slider({ label, value, min, max, step = 1, onChange, unit = '' }: { label: string; value: number; min: number; max: number; step?: number; onChange(v: number): void; unit?: string }) {
  return (
    <label className="vec-slider">
      <span>
        {label}
        <em>
          {Math.round(value * 100) / 100}
          {unit}
        </em>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}

/** Drag a box to draw the picked shape; Shift keeps it even (square, circle). A click places a default size. */
function shapeTool(kind: ShapeKind, look: Partial<ShapeNode>, artboard: { width: number; height: number }): CanvasTool<VectorNode> {
  return {
    id: 'shape',
    label: 'Shape',
    icon: Shapes,
    shortcut: 'S',
    cursor: 'crosshair',
    pointerDown(e, api) {
      if (e.button !== 0) return
      const start = e.world
      let moved = false
      const box = (p: Point, even: boolean) => {
        let end = p
        if (even) {
          const s = Math.max(Math.abs(p.x - start.x), Math.abs(p.y - start.y))
          end = { x: start.x + Math.sign(p.x - start.x || 1) * s, y: start.y + Math.sign(p.y - start.y || 1) * s }
        }
        return rectFromPoints(start, end)
      }
      const make = (r: { x: number; y: number; width: number; height: number }) => makeShape(api.activeLayerId, kind, r.x, r.y, Math.max(2, r.width), Math.max(2, r.height), { ...look, name: SHAPE_LABEL[kind] })
      return {
        move(m) {
          if (!moved && Math.hypot(m.screen.x - e.screen.x, m.screen.y - e.screen.y) < 4) return
          moved = true
          api.setDraft([make(box(m.world, m.shift))])
        },
        up(m) {
          api.setDraft(null)
          const s = Math.round(Math.min(artboard.width, artboard.height) * 0.4)
          const node = make(moved ? box(m.world, m.shift) : { x: start.x - s / 2, y: start.y - s / 2, width: s, height: s })
          api.update((sc) => addNodes(sc, [node]))
          api.select([node.id])
          api.setTool('select')
        },
        cancel: () => api.setDraft(null),
      }
    },
  }
}

export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<VectorDoc>('vector', documentId!, createVectorDoc)
  const title = useProjectStore((s) => s.meta?.documents.find((x) => x.id === documentId)?.title ?? 'Vector')
  const canvas = useCanvasState()
  const apiRef = useRef<CanvasApi<VectorNode> | null>(null)
  const [kind, setKind] = useState<ShapeKind>('rect')
  const [newLook, setNewLook] = useState<Partial<ShapeNode>>({ fillColor: '#4dabf7', strokeColor: OUTLINE_DARK, strokeWidth: 0 })
  const [showLayers, setShowLayers] = useState(true)
  const [previews, setPreviews] = useState<string[]>([])
  const [sizes, setSizes] = useState<number[]>([64, 128])
  const lastTweak = useRef(0)

  const d = doc.data
  const artW = d?.artboard.width ?? 512
  const artH = d?.artboard.height ?? 512
  const tools = useMemo<CanvasTool<VectorNode>[]>(
    () => [selectTool, handTool, shapeTool(kind, newLook, { width: artW, height: artH }), textTool({ defaults: () => ({ textColor: newLook.fillColor ?? OUTLINE_DARK }) })],
    [kind, newLook, artW, artH],
  )

  // Open zoomed so the drawing fills the view (icons are small, so this zooms in up to 8×).
  const boxRef = useRef<HTMLDivElement>(null)
  const setViewport = canvas.setViewport
  const fitArt = useCallback(() => {
    const el = boxRef.current
    if (el) setViewport(fitRect({ x: 0, y: 0, width: artW, height: artH }, { width: el.clientWidth, height: el.clientHeight }, 48, 8))
  }, [artW, artH, setViewport])
  const started = !!d?.presetId
  useEffect(() => {
    if (!started) return
    const raf = requestAnimationFrame(fitArt)
    return () => cancelAnimationFrame(raf)
  }, [started, fitArt])

  // Game-size preview: real small renders, so blur and lost details show up honestly.
  const scene = d?.scene
  const art = d?.artboard
  useEffect(() => {
    if (!scene || !art) return
    const t = setTimeout(() => {
      const api = apiRef.current
      if (!api) return
      const long = Math.max(art.width, art.height)
      setPreviews(PREVIEW_SIZES.map((s) => api.exportPng({ area: { x: 0, y: 0, width: art.width, height: art.height }, padding: 0, pixelRatio: s / long, background: art.bgColor ?? 'transparent' }) ?? ''))
    }, 200)
    return () => clearTimeout(t)
  }, [scene, art])

  if (!d) return null

  const update = (fn: (x: VectorDoc) => VectorDoc) => doc.update(fn)
  // Sliders and the colour wheel send many changes; quick ones in a row become one undo step.
  const tweak = (fn: (x: VectorDoc) => VectorDoc) => {
    // oxlint-disable-next-line react/purity -- runs on input events, not while rendering
    const now = Date.now()
    doc.update(fn, { undoable: now - lastTweak.current > 800 })
    lastTweak.current = now
  }

  if (!d.presetId) return <StartScreen onPick={(p) => update((x) => startFrom(p, x))} />

  const activeLayerId = resolveActiveLayer(d.scene, canvas.activeLayerId)
  const sel = d.scene.nodes.filter((n) => canvas.selection.includes(n.id))
  const first = sel[0]
  const firstShape = sel.find((n): n is ShapeNode => n.kind === 'vshape')
  const lookOf: Partial<ShapeNode> = first ? (first.kind === 'vshape' ? first : { fillColor: first.textColor }) : newLook

  const patch = (p: (n: ShapeNode) => Partial<ShapeNode>, textPatch?: (n: VectorNode) => Partial<VectorNode>, undoStep = false) => {
    if (!sel.length) return setNewLook((l) => ({ ...l, ...p({ ...(l as ShapeNode) }) }))
    const ids = sel.map((n) => n.id)
    const fn = (x: VectorDoc) => ({ ...x, scene: updateNodes(x.scene, ids, (n) => (n.kind === 'vshape' ? { ...n, ...p(n) } : textPatch ? ({ ...n, ...textPatch(n) } as VectorNode) : n)) })
    if (undoStep) update(fn)
    else tweak(fn)
  }

  const addShape = (k: ShapeKind) => {
    setKind(k)
    const s = Math.round(Math.min(d.artboard.width, d.artboard.height) * 0.5)
    const node = makeShape(activeLayerId, k, (d.artboard.width - s) / 2, (d.artboard.height - s) / 2, s, s, { ...newLook, name: SHAPE_LABEL[k] })
    update((x) => ({ ...x, scene: addNodes(x.scene, [node]) }))
    canvas.setSelection([node.id])
    canvas.setToolId('select')
  }

  const centre = () => {
    const api = apiRef.current
    if (!api || !sel.length) return
    const boxes = sel.map((n) => api.getWorldBounds(n.id)).filter((b) => !!b)
    if (!boxes.length) return
    const x0 = Math.min(...boxes.map((b) => b.x))
    const y0 = Math.min(...boxes.map((b) => b.y))
    const x1 = Math.max(...boxes.map((b) => b.x + b.width))
    const y1 = Math.max(...boxes.map((b) => b.y + b.height))
    const dx = (d.artboard.width - (x1 - x0)) / 2 - x0
    const dy = (d.artboard.height - (y1 - y0)) / 2 - y0
    update((x) => ({ ...x, scene: updateNodes(x.scene, sel.map((n) => n.id), (n) => ({ ...n, x: n.x + dx, y: n.y + dy })) }))
  }

  const savePng = async () => {
    const api = apiRef.current
    if (!api || !sizes.length) return
    const long = Math.max(d.artboard.width, d.artboard.height)
    const name = safeFileName(title, 'Vector')
    const files = sizes.map((s) => [`${name}-${s}.png`, dataUrlBytes(api.exportPng({ area: { x: 0, y: 0, ...d.artboard }, padding: 0, pixelRatio: s / long, background: d.artboard.bgColor ?? 'transparent' }) ?? 'data:,')] as const)
    if (files.length === 1) await saveBinaryFile({ title: 'Save PNG', defaultName: files[0][0], bytes: files[0][1], filter: { name: 'PNG', extensions: ['png'] } })
    else await saveBinaryFile({ title: 'Save PNG sizes', defaultName: `${name} PNG.zip`, bytes: zipSync(Object.fromEntries(files)), filter: { name: 'ZIP', extensions: ['zip'] } })
  }

  /** The drawing as a PNG for Send to, at the biggest ticked size (512 if none). */
  const picture = async () => {
    const url = apiRef.current?.exportPng({ area: { x: 0, y: 0, ...d.artboard }, padding: 0, pixelRatio: (sizes.at(-1) ?? 512) / Math.max(d.artboard.width, d.artboard.height), background: d.artboard.bgColor ?? 'transparent' })
    return url ? new Blob([dataUrlBytes(url)], { type: 'image/png' }) : null
  }

  const saveGodot = async () => {
    const root = useProjectStore.getState().root
    const docs = useProjectStore.getState().meta?.documents.filter((x) => x.type === 'vector') ?? []
    if (!root || !docs.length) return
    const size = sizes[0] ?? 64
    const icons: [string, HTMLCanvasElement][] = []
    const used = new Set<string>()
    for (const m of docs) {
      const v = m.id === documentId ? d : await readDocument<VectorDoc | null>(root, 'vector', m.id, () => null).catch(() => null)
      if (!v?.artboard) continue
      let name = safeFileName(m.title, 'icon')
      for (let i = 2; used.has(name); i++) name = `${safeFileName(m.title, 'icon')} ${i}`
      used.add(name)
      icons.push([name, await svgCanvas(v, size)])
    }
    const { cols, rows } = atlasGrid(icons.length)
    const cell = size
    const sheet = document.createElement('canvas')
    sheet.width = cols * cell
    sheet.height = rows * cell
    const g = sheet.getContext('2d')!
    const files: Record<string, Uint8Array> = {}
    icons.forEach(([name, c], i) => {
      const x = (i % cols) * cell
      const y = Math.floor(i / cols) * cell
      g.drawImage(c, x, y)
      files[`${name}.tres`] = new TextEncoder().encode(godotAtlasTexture('res://icons/icons.png', x, y, c.width, c.height))
    })
    files['icons.png'] = await canvasBytes(sheet)
    await saveBinaryFile({ title: 'Export for Godot', defaultName: 'icons Godot.zip', bytes: zipSync(files), filter: { name: 'ZIP', extensions: ['zip'] } })
  }

  const saveSvg = () => saveTextFile({ title: 'Save SVG', defaultName: `${safeFileName(title, 'Vector')}.svg`, text: toSvg(d), filter: { name: 'SVG', extensions: ['svg'] } })

  const setArt = (p: Partial<VectorDoc['artboard']>) => tweak((x) => ({ ...x, artboard: { ...x.artboard, ...p } }))

  const frame = () => <div className="vec-artboard" style={{ width: d.artboard.width, height: d.artboard.height, boxShadow: `0 0 0 ${1.5 / canvas.viewport.scale}px var(--accent)` }} />
  // The drawing's background sits behind the shapes, as the canvas background moved and zoomed with the view.
  const v = canvas.viewport
  const artStyle = {
    '--vec-bg': d.artboard.bgColor ?? 'color-mix(in srgb, var(--text) 9%, var(--bg))',
    '--vec-x': `${v.x}px`,
    '--vec-y': `${v.y}px`,
    '--vec-w': `${d.artboard.width * v.scale}px`,
    '--vec-h': `${d.artboard.height * v.scale}px`,
  } as React.CSSProperties
  const sliders = firstShape ? SHAPE_SLIDERS[firstShape.shapeId] : null
  const defaults = firstShape ? SHAPE_DEFAULTS[firstShape.shapeId] : {}
  const maxStroke = Math.max(4, Math.round(Math.min(d.artboard.width, d.artboard.height) / 8))

  return (
    <div className="vec">
      <div className="vec-main">
        <div className="vec-canvas" ref={boxRef} style={artStyle}>
          <CanvasEditor<VectorNode>
            scene={d.scene}
            onChange={(r, o) => doc.update((x) => ({ ...x, scene: r(x.scene) }), o)}
            onUndo={doc.undo}
            onRedo={doc.redo}
            canUndo={doc.canUndo}
            canRedo={doc.canRedo}
            active={active}
            tools={tools}
            nodeTypes={VECTOR_NODE_TYPES}
            canvas={canvas}
            apiRef={apiRef}
            html={frame}
            grid={false}
            fitOnOpen={false}
            toolbarExtra={
              <button className="canvas-toolbar-btn" title="Fit the drawing in the view" aria-label="Fit the drawing in the view" onClick={fitArt}>
                <Frame size={16} strokeWidth={1.8} />
              </button>
            }
            layerScoped
            ariaLabel="Vector drawing"
          />
        </div>
        <div className="vec-preview" aria-label={T.preview}>
          <span className="vec-preview-title">{T.preview}</span>
          {(['dark', 'light', 'slot'] as const).map((bg) => (
            <div key={bg} className={`vec-preview-group vec-preview-${bg}`} title={bg === 'slot' ? 'In an inventory slot' : `On ${bg}`}>
              {previews.map((src, i) => (src ? <img key={i} src={src} alt={`${PREVIEW_SIZES[i]} px`} title={`${PREVIEW_SIZES[i]} px`} style={{ width: (PREVIEW_SIZES[i] * d.artboard.width) / Math.max(d.artboard.width, d.artboard.height) }} /> : null))}
            </div>
          ))}
        </div>
      </div>
      <aside className="vec-side">
        <section className="vec-section">
          <h3>{T.shapes}</h3>
          <div className="vec-shape-grid">
            {SHAPES.map((k) => (
              <button key={k} className={`vec-shape-btn${kind === k && canvas.toolId === 'shape' ? ' active' : ''}`} title={`${SHAPE_LABEL[k]}: click to add it in the middle`} onClick={() => addShape(k)}>
                <ShapeIcon shapeId={k} />
                <span>{SHAPE_LABEL[k]}</span>
              </button>
            ))}
          </div>
          <p className="vec-muted vec-small">Click adds it in the middle. To draw it yourself, press S (or the shapes button under the drawing) and drag; Shift keeps it even. T writes text.</p>
        </section>

        <section className="vec-section">
          <h3>{T.look}</h3>
          {!sel.length && <p className="vec-muted vec-small">{T.nothing}</p>}
          <div className="vec-looks" role="group" aria-label={T.looks}>
            {LOOKS.map((l) => (
              <button key={l.id} className="btn vec-look-btn" title={l.hint} onClick={() => patch((n) => l.apply(n, d.artboard), undefined, true)}>
                {l.label}
              </button>
            ))}
          </div>
          <div className="vec-row">
            <span>{T.fill}</span>
            <ColourButton label={T.fill} value={lookOf.fillColor} allowNone onPick={(c) => patch(() => ({ fillColor: c ?? 'transparent' }), () => ({ textColor: c ?? OUTLINE_DARK }))} />
          </div>
          {(!first || first.kind === 'vshape') && (
            <>
              <div className="vec-row">
                <label>
                  <input type="checkbox" checked={!!lookOf.fill2Color} onChange={(e) => patch((n) => ({ fill2Color: e.target.checked ? (n.fillColor && n.fillColor !== 'transparent' ? shade(n.fillColor, -0.35) : '#1c7ed6') : undefined }), undefined, true)} /> {T.gradient}
                </label>
                {lookOf.fill2Color && <ColourButton label="Second colour" value={lookOf.fill2Color} onPick={(c) => patch(() => ({ fill2Color: c }))} />}
              </div>
              <div className="vec-row">
                <span>{T.outline}</span>
                <ColourButton label="Outline colour" value={lookOf.strokeColor} onPick={(c) => patch((n) => ({ strokeColor: c, strokeWidth: n.strokeWidth || Math.max(2, Math.round(maxStroke / 4)) }))} />
              </div>
              <Slider label="Outline width" value={lookOf.strokeWidth ?? 0} min={0} max={maxStroke} onChange={(v) => patch(() => ({ strokeWidth: v }))} unit=" px" />
              <div className="vec-row">
                <label>
                  <input type="checkbox" checked={!!lookOf.shadow} onChange={(e) => patch(() => ({ shadow: e.target.checked }), undefined, true)} /> {T.shadow}
                </label>
              </div>
              <Slider label={T.opacity} value={Math.round((1 - (lookOf.opacity ?? 1)) * 100)} min={0} max={90} onChange={(v) => patch(() => ({ opacity: 1 - v / 100 }))} unit=" %" />
            </>
          )}
        </section>

        {firstShape && sliders && (sliders.corner || sliders.sides || sliders.inner) && (
          <section className="vec-section">
            <h3>
              {T.shape}: {SHAPE_LABEL[firstShape.shapeId]}
            </h3>
            {sliders.corner && <Slider label={T.corner} value={firstShape.corner ?? defaults.corner ?? 0} min={0} max={100} onChange={(v) => patch((n) => (n.shapeId === firstShape.shapeId ? { corner: v } : {}))} unit=" %" />}
            {sliders.sides && <Slider label={sliders.sides.label} value={firstShape.sides ?? defaults.sides ?? 5} min={sliders.sides.min} max={sliders.sides.max} onChange={(v) => patch((n) => (n.shapeId === firstShape.shapeId ? { sides: v } : {}))} />}
            {sliders.inner && <Slider label={sliders.inner} value={firstShape.inner ?? defaults.inner ?? 50} min={5} max={95} onChange={(v) => patch((n) => (n.shapeId === firstShape.shapeId ? { inner: v } : {}))} unit=" %" />}
          </section>
        )}

        {sel.length > 0 && (
          <section className="vec-section">
            <h3>{T.arrange}</h3>
            <button className="btn" onClick={centre}>
              {T.centre}
            </button>
          </section>
        )}

        <details className="vec-section" open={showLayers} onToggle={(e) => setShowLayers((e.target as HTMLDetailsElement).open)}>
          <summary>Layers</summary>
          <LayersPanel
            doc={{ scene: d.scene as unknown as Scene<MoodNode> }}
            onChange={(r) => update((x) => ({ ...x, scene: r(x.scene as unknown as Scene<MoodNode>) as unknown as Scene<VectorNode> }))}
            selection={canvas.selection}
            onSelect={(ids, mode) => {
              const n = d.scene.nodes.find((x) => x.id === ids[0])
              if (n && n.layerId !== activeLayerId) canvas.setActiveLayerId(n.layerId)
              canvas.setSelection(mode === 'toggle' ? [...canvas.selection.filter((x) => !ids.includes(x)), ...ids.filter((x) => !canvas.selection.includes(x))] : ids)
            }}
            activeLayerId={activeLayerId}
            onActiveLayer={(id) => (canvas.setActiveLayerId(id), canvas.setSelection([]))}
            onClose={() => setShowLayers(false)}
          />
        </details>

        <details className="vec-section">
          <summary>{T.artboard}</summary>
          <div className="vec-row">
            <label>
              W <input className="input vec-num" type="number" min={8} max={8192} value={d.artboard.width} onChange={(e) => setArt({ width: Math.max(8, Math.min(8192, Number(e.target.value) || 8)) })} />
            </label>
            <label>
              H <input className="input vec-num" type="number" min={8} max={8192} value={d.artboard.height} onChange={(e) => setArt({ height: Math.max(8, Math.min(8192, Number(e.target.value) || 8)) })} />
            </label>
          </div>
          <div className="vec-row">
            <span>{T.background}</span>
            <ColourButton label={T.background} value={d.artboard.bgColor} allowNone onPick={(c) => setArt({ bgColor: c })} />
          </div>
          <button className="vec-link" onClick={() => update((x) => ({ ...x, presetId: null }))}>
            Back to “{T.start}” (keeps nothing)
          </button>
        </details>

        <section className="vec-section">
          <h3>{T.exportTitle}</h3>
          <p className="vec-muted vec-small">PNG sizes (longest side, see-through background unless you set one):</p>
          <div className="vec-sizes">
            {EXPORT_SIZES.map((s) => (
              <label key={s} className="vec-size">
                <input type="checkbox" checked={sizes.includes(s)} onChange={(e) => setSizes((v) => (e.target.checked ? [...v, s].sort((a, b) => a - b) : v.filter((x) => x !== s)))} /> {s}
              </label>
            ))}
          </div>
          <div className="vec-row">
            <button className="btn btn-primary" disabled={!sizes.length} onClick={() => void savePng()}>
              {T.png}
              {sizes.length > 1 ? ` (${sizes.length} sizes, ZIP)` : ''}
            </button>
            <button className="btn" onClick={() => void saveSvg()}>
              {T.svg}
            </button>
          </div>
          <div className="vec-row">
            <button className="btn" title={T.godotHint} onClick={() => void saveGodot()}>
              {T.godot}
            </button>
            <SendMenu title={title} picture={picture} />
          </div>
        </section>
      </aside>
    </div>
  )
}

