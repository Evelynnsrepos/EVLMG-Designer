import { zipSync } from 'fflate'
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  FlipHorizontal2,
  Brush,
  Combine,
  FlipVertical2,
  Frame,
  Group as GroupIcon,
  Magnet,
  MousePointer2,
  PenTool,
  Shapes,
  Spline,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { safeFileName, saveBinaryFile, saveTextFile } from '@/core/export'
import { newId } from '@/core/model'
import { readDocument } from '@/core/project'
import type { PanelProps } from '@/core/registry'
import { isShortcut } from '@/core/shortcuts'
import { useDocument, useProjectStore } from '@/core/state'
import {
  addNodes,
  CanvasEditor,
  deleteNodes,
  fitRect,
  handTool,
  rectFromPoints,
  resolveActiveLayer,
  textTool,
  updateNodes,
  useCanvasState,
  type CanvasApi,
  type CanvasTool,
  type Point,
  type Rect,
  type Scene,
} from '@/shared/canvas'
import { LayersPanel } from '@/shared/moodboard/LayersPanel'
import type { MoodNode } from '@/shared/moodboard/model'
import '@/shared/moodboard/moodboard.css'
import { confirmDialog } from '@/shared/dialogs'
import { useHotwheel, type HotAction } from '@/shared/hotwheel'
import { systemFonts } from '@/shared/fontList'
import { ColorPanel } from '@/shared/sketch/ColorPanel'
import { anchorsOf, geomReady, loadGeom, offset, outline, type CombineMode } from './geom'
import { createVectorDoc, geomOf, isPaint, LOOKS, makeShape, OUTLINE_DARK, PRESETS, shade, startFrom, toSvg, type Look, type PaintNode, type PathNode, type Preset, type ShapeNode, type VectorDoc, type VectorNode, type VTextNode } from './model'
import { applyMatrix, mapPaths, nodeMatrix, pathD, removeAnchor, toggleSmooth } from './paths'
import { importSvg } from './svgImport'
import { combineNodes, lookOf, pathNode, penTool, pencilTool, pointsTool, shapeBuilderTool, vectorSelectTool, withPaths, type Guide, type PointPick } from './tools'
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
function shapeTool(kind: ShapeKind, look: Look, artboard: { width: number; height: number }): CanvasTool<VectorNode> {
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

/** Copied items, shared by every Vector drawing in this window. */
let clipboard: VectorNode[] = []

const COMBINE: { mode: CombineMode; label: string; pro: string; hint: string }[] = [
  { mode: 'unite', label: 'Join', pro: 'Union', hint: 'Melt the shapes into one' },
  { mode: 'minus_front', label: 'Cut out', pro: 'Subtract', hint: 'The front shapes cut holes in the back one' },
  { mode: 'intersect', label: 'Keep overlap', pro: 'Intersect', hint: 'Keep only where all of them overlap' },
  { mode: 'exclude', label: 'Remove overlap', pro: 'Exclude', hint: 'Keep everything except where they overlap' },
  { mode: 'divide', label: 'Split into pieces', pro: 'Divide', hint: 'Every overlap becomes its own piece' },
]

/** Tiny before/after pictures for the combine buttons: a square behind a circle. */
function CombineIcon({ mode }: { mode: CombineMode }) {
  const sq = 'M2 2H13V13H2Z'
  const ci = 'M15 10A5 5 0 1 1 5 10A5 5 0 1 1 15 10Z'
  const id = `vec-ci-${mode}`
  return (
    <svg viewBox="0 0 18 18" width={28} height={28} aria-hidden>
      <defs>
        <clipPath id={id}>
          <path d={sq} />
        </clipPath>
      </defs>
      {mode === 'unite' && <path d={`${sq} ${ci}`} fill="currentColor" />}
      {mode === 'minus_front' && <path d={`${sq} ${ci}`} fill="currentColor" fillRule="evenodd" clipPath={`url(#${id})`} />}
      {mode === 'intersect' && <path d={ci} fill="currentColor" clipPath={`url(#${id})`} />}
      {mode === 'exclude' && <path d={`${sq} ${ci}`} fill="currentColor" fillRule="evenodd" />}
      {mode === 'divide' && (
        <>
          <path d={`${sq} ${ci}`} fill="currentColor" fillRule="evenodd" opacity={0.6} />
          <path d={ci} fill="currentColor" clipPath={`url(#${id})`} />
        </>
      )}
      <path d={`${sq} ${ci}`} fill="none" stroke="currentColor" strokeWidth={0.6} opacity={0.5} />
    </svg>
  )
}

const round = (v: number) => Math.round(v * 100) / 100

/** Number box that applies on Enter or when leaving it, so typing "1" on the way to "128" doesn't jump. */
function NumBox({ label, value, onSet, title }: { label: string; value: number; onSet(v: number): void; title?: string }) {
  const [text, setText] = useState<string | null>(null)
  const apply = () => {
    if (text === null) return
    const v = Number(text)
    setText(null)
    if (Number.isFinite(v)) onSet(v)
  }
  return (
    <label className="vec-numbox" title={title}>
      {label}
      <input className="input vec-num" inputMode="decimal" value={text ?? String(round(value))} onChange={(e) => setText(e.target.value)} onBlur={apply} onKeyDown={(e) => e.key === 'Enter' && apply()} />
    </label>
  )
}

/** Point handles of the path being edited, drawn above the canvas in drawing space. */
function PointsOverlay({ node, picked, scale }: { node: PathNode; picked: PointPick | null; scale: number }) {
  const m = nodeMatrix(node)
  const s = 1 / scale
  const out: React.ReactNode[] = []
  node.paths.forEach((sp, k) =>
    sp.anchors.forEach((a, i) => {
      const p = applyMatrix(m, a.p)
      const on = picked?.sp === k && picked.i === i
      if (on)
        for (const h of [a.in, a.out]) {
          if (!h || (h[0] === a.p[0] && h[1] === a.p[1])) continue
          const q = applyMatrix(m, h)
          out.push(<line key={`l${k}-${i}-${q}`} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke="var(--accent)" strokeWidth={s} />, <circle key={`h${k}-${i}-${q}`} cx={q[0]} cy={q[1]} r={4 * s} fill="var(--bg-elevated)" stroke="var(--accent)" strokeWidth={1.5 * s} />)
        }
      out.push(<rect key={`a${k}-${i}`} x={p[0] - 4.5 * s} y={p[1] - 4.5 * s} width={9 * s} height={9 * s} rx={a.kind === 'Smooth' ? 4.5 * s : 1 * s} fill={on ? 'var(--accent)' : 'var(--bg-elevated)'} stroke="var(--accent)" strokeWidth={1.5 * s} />)
    }),
  )
  return (
    <svg className="vec-overlay" aria-hidden>
      <path d={pathD(node.paths)} transform={`matrix(${m.join(' ')})`} fill="none" stroke="var(--accent)" strokeWidth={1.2 / (scale * Math.abs(node.scaleX ?? 1))} />
      {out}
    </svg>
  )
}

export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<VectorDoc>('vector', documentId!, createVectorDoc)
  const title = useProjectStore((s) => s.meta?.documents.find((x) => x.id === documentId)?.title ?? 'Vector')
  const canvas = useCanvasState()
  const apiRef = useRef<CanvasApi<VectorNode> | null>(null)
  const [kind, setKind] = useState<ShapeKind>('rect')
  const [newLook, setNewLook] = useState<Look>({ fillColor: '#4dabf7', strokeColor: OUTLINE_DARK, strokeWidth: 0 })
  const [showLayers, setShowLayers] = useState(true)
  const [previews, setPreviews] = useState<string[]>([])
  const [sizes, setSizes] = useState<number[]>([64, 128])
  const [msg, setMsg] = useState<string | null>(null)
  const [guides, setGuides] = useState<Guide[]>([])
  const [editId, setEditId] = useState<string | null>(null)
  const [picked, setPicked] = useState<PointPick | null>(null)
  const [grow, setGrow] = useState(4)
  const [smooth, setSmooth] = useState(50)
  const [copiedLook, setCopiedLook] = useState<Look | null>(null)
  const lastTweak = useRef(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => void loadGeom().catch(() => setMsg('The shape maths could not start, so combining shapes is off.')), [])
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), 5000)
    return () => clearTimeout(t)
  }, [msg])

  const d = doc.data
  const artW = d?.artboard.width ?? 512
  const artH = d?.artboard.height ?? 512
  // Tools read the latest document and choices through refs, so they don't need rebuilding on every change.
  const live = useRef({ d, newLook, editId, picked, smooth, selection: canvas.selection })
  live.current = { d, newLook, editId, picked, smooth, selection: canvas.selection }

  const snapOn = d?.snap !== false
  const crisp = d?.crisp ?? (d?.presetId !== 'logo' && d?.presetId !== 'app')
  const crispRef = useRef(crisp)
  crispRef.current = crisp
  const snapRef = useRef(snapOn)
  snapRef.current = snapOn

  /** Changes the document; `step` false merges it into the last undo step (quick slider moves). */
  const update = (fn: (x: VectorDoc) => VectorDoc) => doc.update(fn)
  const tweak = (fn: (x: VectorDoc) => VectorDoc) => {
    // oxlint-disable-next-line react/purity -- runs on input events, not while rendering
    const now = Date.now()
    doc.update(fn, { undoable: now - lastTweak.current > 800 })
    lastTweak.current = now
  }

  /** Turns a live shape into points (one undo step) and starts editing it; null leaves point editing. */
  const editPoints = (id: string | null) => {
    setPicked(null)
    const api = apiRef.current
    const cur = live.current.d
    const n = id ? cur?.scene.nodes.find((x) => x.id === id) : undefined
    if (!api || !cur || !isPaint(n)) {
      const was = live.current.editId
      setEditId(null)
      canvas.setToolId('select')
      if (was) canvas.setSelection([was])
      return
    }
    if (n.kind === 'vshape') {
      if (!geomReady()) return setMsg('Shape maths are still loading. Try again in a moment.')
      const paths = anchorsOf({ d: shapePath(n) })?.paths ?? []
      const { shapeId: _s, corner: _c, sides: _n, inner: _i, kind: _k, ...rest } = n
      const asPath: PathNode = { ...rest, kind: 'vpath', paths, width: n.width, height: n.height }
      update((x) => ({ ...x, scene: updateNodes(x.scene, [n.id], () => asPath) }))
    }
    canvas.setSelection([])
    setEditId(n.id)
    canvas.setToolId('points')
  }

  const tools = useMemo<CanvasTool<VectorNode>[]>(() => {
    const layer = () => apiRef.current?.activeLayerId ?? ''
    const lookNow = () => live.current.newLook
    const done = (id: string) => {
      canvas.setSelection([id])
      canvas.setToolId('select')
    }
    return [
      vectorSelectTool({
        snap: () => ({ on: snapRef.current, grid: crispRef.current ? 1 : 0, artboard: { x: 0, y: 0, width: live.current.d?.artboard.width ?? 0, height: live.current.d?.artboard.height ?? 0 } }),
        onGuides: setGuides,
        onEditPoints: (id) => editPoints(id),
      }),
      handTool,
      shapeTool(kind, newLook, { width: artW, height: artH }),
      penTool({ look: lookNow, layer, done }),
      pencilTool({ look: lookNow, layer, smooth: () => live.current.smooth, done }),
      pointsTool({
        editing: () => {
          const n = live.current.d?.scene.nodes.find((x) => x.id === live.current.editId)
          return n?.kind === 'vpath' ? n : null
        },
        picked: () => live.current.picked,
        setPicked,
        switchTo: (id) => editPoints(id),
      }),
      shapeBuilderTool({
        shapes: (api) => {
          const nodes = (live.current.d?.scene.nodes ?? []).filter((n): n is PaintNode => isPaint(n) && !n.hidden && n.layerId === api.activeLayerId)
          const chosen = nodes.filter((n) => live.current.selection.includes(n.id))
          return chosen.length >= 2 ? chosen : nodes
        },
        onError: setMsg,
      }),
      textTool({ defaults: () => ({ textColor: live.current.newLook.fillColor ?? OUTLINE_DARK }) }),
    ]
    // editPoints only uses refs and stable setters.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, newLook, artW, artH])

  // Pressing A (or picking Edit points) with one shape selected starts editing that shape.
  useEffect(() => {
    if (canvas.toolId !== 'points' || editId) return
    const id = canvas.selection.length === 1 ? canvas.selection[0] : null
    if (id) editPoints(id)
    else {
      setMsg('Select one shape first, then press A or double-click it.')
      canvas.setToolId('select')
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas.toolId, editId])
  // Leaving the tool any other way ends point editing.
  useEffect(() => {
    if (canvas.toolId !== 'points' && editId) {
      setEditId(null)
      setPicked(null)
    }
  }, [canvas.toolId, editId])

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

  // Hotwheel (hold Q): the ring is filled from the current render below, so it always matches the selection.
  const wheel = useRef<{ actions: HotAction[]; size?: { label: string; smaller(): void; bigger(): void } }>({ actions: [] })
  useHotwheel(() => wheel.current.actions, true, { label: 'Outline width', smaller: () => wheel.current.size?.smaller(), bigger: () => wheel.current.size?.bigger() })

  if (!d) return null

  if (!d.presetId) return <StartScreen onPick={(p) => update((x) => startFrom(p, x))} />

  const activeLayerId = resolveActiveLayer(d.scene, canvas.activeLayerId)
  const sel = d.scene.nodes.filter((n) => canvas.selection.includes(n.id))
  const selIds = sel.map((n) => n.id)
  const first = sel[0]
  const firstShape = sel.find((n): n is ShapeNode => n.kind === 'vshape')
  const paints = sel.filter(isPaint)
  const texts = sel.filter((n): n is VTextNode => n.kind === 'text')
  const editing = editId ? d.scene.nodes.find((n): n is PathNode => n.id === editId && n.kind === 'vpath') : undefined
  const lookNow: Look = first ? (isPaint(first) ? first : { fillColor: first.textColor }) : newLook

  const setScene = (fn: (s: Scene<VectorNode>) => Scene<VectorNode>) => update((x) => ({ ...x, scene: fn(x.scene) }))

  const patch = (p: (n: Look) => Look, textPatch?: (n: VTextNode) => Partial<VTextNode>, undoStep = false) => {
    if (!sel.length) return setNewLook((l) => ({ ...l, ...p(l) }))
    const fn = (x: VectorDoc) => ({ ...x, scene: updateNodes(x.scene, selIds, (n) => (isPaint(n) ? ({ ...n, ...p(n) } as VectorNode) : textPatch ? ({ ...n, ...textPatch(n) } as VectorNode) : n)) })
    if (undoStep) update(fn)
    else tweak(fn)
  }

  /** Runs a shape-maths action and shows its error instead of failing silently. */
  const tryGeom = (f: () => void) => {
    if (!geomReady()) return setMsg('Shape maths are still loading. Try again in a moment.')
    try {
      f()
    } catch (err) {
      setMsg((err as Error).message)
    }
  }

  const doCombine = (mode: CombineMode) =>
    tryGeom(() => {
      const r = combineNodes(d.scene, selIds, mode)
      setScene(() => r.scene)
      canvas.setSelection(r.ids)
    })

  const takeApart = () => {
    const withFrom = paints.filter((n): n is PathNode => n.kind === 'vpath' && !!n.from?.length)
    if (!withFrom.length) return
    const back = withFrom.flatMap((n) => n.from!)
    setScene((s) => {
      const at = s.nodes.findIndex((n) => n.id === withFrom[0].id)
      const rest = deleteNodes(s, withFrom.map((n) => n.id))
      const nodes = [...rest.nodes]
      nodes.splice(Math.min(at, nodes.length), 0, ...back.map((n) => ({ ...n, layerId: withFrom[0].layerId })))
      return { ...rest, nodes }
    })
    canvas.setSelection(back.map((n) => n.id))
  }

  const growShrink = (amount: number) =>
    tryGeom(() => {
      const made = paints.map((n) => {
        const r = offset(geomOf(n), amount, !n.strokeSharp)
        if (!r?.paths.length) throw new Error('Shrunk too far: nothing is left of the shape.')
        return { old: n.id, node: { ...pathNode(n.layerId, r.paths, { ...lookOf(n), name: n.name }), id: n.id } }
      })
      setScene((s) => ({ ...s, nodes: s.nodes.map((x) => made.find((m) => m.old === x.id)?.node ?? x) }))
    })

  const outlineToShape = () =>
    tryGeom(() => {
      const withLine = paints.filter((n) => n.strokeWidth && n.strokeColor)
      if (!withLine.length) throw new Error('The selected shapes have no outline.')
      const made: VectorNode[] = []
      setScene((s) => {
        let nodes = [...s.nodes]
        for (const n of withLine) {
          const r = outline(geomOf(n), n.strokeWidth!, !n.strokeSharp)
          if (!r?.paths.length) continue
          const line = pathNode(n.layerId, r.paths, { fillColor: n.strokeColor, opacity: n.opacity, name: `${n.name ?? 'Shape'} outline` })
          const at = nodes.findIndex((x) => x.id === n.id)
          const filled = n.fillColor && n.fillColor !== 'transparent'
          nodes = filled ? nodes.map((x) => (x.id === n.id ? ({ ...n, strokeWidth: 0 } as VectorNode) : x)) : nodes.filter((x) => x.id !== n.id)
          nodes.splice(filled ? at + 1 : at, 0, line)
          made.push(line)
        }
        return { ...s, nodes }
      })
      canvas.setSelection(made.map((n) => n.id))
    })

  const addShape = (k: ShapeKind) => {
    setKind(k)
    const s = Math.round(Math.min(d.artboard.width, d.artboard.height) * 0.5)
    const h = k === 'arrow' ? Math.round(s * 0.6) : s
    const node = makeShape(activeLayerId, k, (d.artboard.width - s) / 2, (d.artboard.height - h) / 2, s, h, { ...newLook, name: SHAPE_LABEL[k] })
    setScene((sc) => addNodes(sc, [node]))
    canvas.setSelection([node.id])
    canvas.setToolId('select')
  }

  const addLine = () => {
    const w = d.artboard.width
    const h = d.artboard.height
    const n = pathNode(activeLayerId, [{ anchors: [{ p: [w * 0.25, h / 2] }, { p: [w * 0.75, h / 2] }], closed: false }], {
      ...newLook,
      fillColor: 'transparent',
      strokeColor: newLook.strokeWidth ? newLook.strokeColor : (newLook.fillColor ?? OUTLINE_DARK),
      strokeWidth: newLook.strokeWidth || Math.max(2, Math.round(Math.min(w, h) * 0.04)),
      name: 'Line',
    })
    setScene((sc) => addNodes(sc, [n]))
    canvas.setSelection([n.id])
  }

  // ---------- place ----------

  const boxes = () => {
    const api = apiRef.current
    return api ? sel.map((n) => ({ n, b: api.getWorldBounds(n.id) })).filter((x): x is { n: VectorNode; b: Rect } => !!x.b) : []
  }

  const align = (how: 'left' | 'hcentre' | 'right' | 'top' | 'vcentre' | 'bottom') => {
    const bs = boxes()
    if (!bs.length) return
    // One item lines up with the drawing, several with each other.
    const ref: Rect =
      bs.length === 1
        ? { x: 0, y: 0, width: d.artboard.width, height: d.artboard.height }
        : (() => {
            const x0 = Math.min(...bs.map((x) => x.b.x))
            const y0 = Math.min(...bs.map((x) => x.b.y))
            return { x: x0, y: y0, width: Math.max(...bs.map((x) => x.b.x + x.b.width)) - x0, height: Math.max(...bs.map((x) => x.b.y + x.b.height)) - y0 }
          })()
    const shift = new Map(
      bs.map(({ n, b }) => {
        const dx = how === 'left' ? ref.x - b.x : how === 'hcentre' ? ref.x + ref.width / 2 - (b.x + b.width / 2) : how === 'right' ? ref.x + ref.width - (b.x + b.width) : 0
        const dy = how === 'top' ? ref.y - b.y : how === 'vcentre' ? ref.y + ref.height / 2 - (b.y + b.height / 2) : how === 'bottom' ? ref.y + ref.height - (b.y + b.height) : 0
        return [n.id, [dx, dy]] as const
      }),
    )
    setScene((s) => updateNodes(s, selIds, (n) => ({ ...n, x: n.x + (shift.get(n.id)?.[0] ?? 0), y: n.y + (shift.get(n.id)?.[1] ?? 0) })))
  }

  const spread = (axis: 'x' | 'y') => {
    const bs = boxes().sort((a, b) => (axis === 'x' ? a.b.x - b.b.x : a.b.y - b.b.y))
    if (bs.length < 3) return
    const size = (r: Rect) => (axis === 'x' ? r.width : r.height)
    const pos = (r: Rect) => (axis === 'x' ? r.x : r.y)
    const span = pos(bs[bs.length - 1].b) + size(bs[bs.length - 1].b) - pos(bs[0].b)
    const gap = (span - bs.reduce((t, x) => t + size(x.b), 0)) / (bs.length - 1)
    let at = pos(bs[0].b)
    const shift = new Map<string, number>()
    for (const { n, b } of bs) {
      shift.set(n.id, at - pos(b))
      at += size(b) + gap
    }
    setScene((s) => updateNodes(s, selIds, (n) => ({ ...n, [axis]: n[axis] + (shift.get(n.id) ?? 0) })))
  }

  const setGeom = (p: { x?: number; y?: number; width?: number; height?: number; rotation?: number }) => {
    if (sel.length !== 1) return
    setScene((s) =>
      updateNodes(s, selIds, (n) => {
        let next = { ...n, ...(p.x !== undefined ? { x: p.x } : {}), ...(p.y !== undefined ? { y: p.y } : {}), ...(p.rotation !== undefined ? { rotation: p.rotation } : {}) } as VectorNode
        const w = Math.max(1, p.width ?? ('width' in n ? n.width : 1))
        const h = Math.max(1, p.height ?? ('height' in n ? n.height : 1))
        if (next.kind === 'vshape') next = { ...next, width: w, height: h }
        else if (next.kind === 'vpath') next = { ...next, paths: mapPaths(next.paths, ([x, y]) => [(x * w) / next.width, (y * h) / (next as PathNode).height]), width: w, height: h }
        else if (next.kind === 'text' && p.width !== undefined) next = { ...next, width: w, autoWidth: undefined }
        return next
      }),
    )
  }

  /** Mirror: paths flip their points; live shapes and text flip with a negative scale. */
  const flip = (axis: 'x' | 'y') =>
    setScene((s) =>
      updateNodes(s, selIds, (n) => {
        if (n.kind === 'vpath') return { ...n, paths: mapPaths(n.paths, ([x, y]) => (axis === 'x' ? [n.width - x, y] : [x, n.height - y])) }
        const api = apiRef.current
        const b = api?.getWorldBounds(n.id)
        // shortcut: flips about the item's box for unrotated items; rotated ones may shift a little.
        if (axis === 'x') return { ...n, scaleX: -(n.scaleX ?? 1), x: b ? (n.x === b.x ? n.x + b.width : n.x - b.width) : n.x }
        return { ...n, scaleY: -(n.scaleY ?? 1), y: b ? (n.y === b.y ? n.y + b.height : n.y - b.height) : n.y }
      }),
    )

  const group = () => {
    if (sel.length < 2) return
    const g = newId()
    setScene((s) => updateNodes(s, selIds, (n) => ({ ...n, groupId: g })))
  }
  const ungroup = () => setScene((s) => updateNodes(s, selIds, (n) => ({ ...n, groupId: undefined })))
  const grouped = sel.some((n) => n.groupId)

  const copy = () => {
    if (sel.length) clipboard = structuredClone(sel)
  }
  const paste = () => {
    if (!clipboard.length) return
    const groups = new Map<string, string>()
    const made = clipboard.map((n) => ({ ...structuredClone(n), id: newId(), layerId: activeLayerId, x: n.x + 10, y: n.y + 10, ...(n.groupId ? { groupId: groups.get(n.groupId) ?? (groups.set(n.groupId, newId()), groups.get(n.groupId)!) } : {}) }) as VectorNode)
    clipboard = made
    setScene((s) => addNodes(s, made))
    canvas.setSelection(made.map((n) => n.id))
  }

  const stroke = (dw: number) => patch((n) => ({ strokeWidth: Math.max(0, Math.min(maxStroke, (n.strokeWidth ?? 0) + dw)), strokeColor: n.strokeColor ?? OUTLINE_DARK }))
  wheel.current = {
    actions: [
      { id: 'vec-select', label: 'Select', icon: MousePointer2, on: canvas.toolId === 'select', run: () => canvas.setToolId('select') },
      { id: 'vec-shape', label: `Draw a ${SHAPE_LABEL[kind].toLowerCase()}`, icon: Shapes, on: canvas.toolId === 'shape', run: () => canvas.setToolId('shape') },
      { id: 'vec-pen', label: 'Pen', icon: PenTool, on: canvas.toolId === 'pen', run: () => canvas.setToolId('pen') },
      { id: 'vec-pencil', label: 'Pencil', icon: Brush, on: canvas.toolId === 'pencil', run: () => canvas.setToolId('pencil') },
      { id: 'vec-points', label: 'Edit points', icon: Spline, on: canvas.toolId === 'points', run: () => (paints.length === 1 ? editPoints(paints[0].id) : canvas.setToolId('points')) },
      { id: 'vec-builder', label: 'Shape builder', icon: Combine, on: canvas.toolId === 'builder', run: () => canvas.setToolId('builder') },
      { id: 'vec-combine', label: 'Combine', halves: [{ label: 'Join', run: () => doCombine('unite') }, { label: 'Cut out', run: () => doCombine('minus_front') }] },
      { id: 'vec-group', label: grouped ? 'Ungroup' : 'Group', icon: GroupIcon, on: grouped, run: () => (grouped ? ungroup() : group()) },
      { id: 'vec-copy', label: 'Copy and paste', halves: [{ label: 'Copy', run: copy }, { label: 'Paste', run: paste }] },
      { id: 'vec-snap', label: 'Snap while moving', icon: Magnet, on: snapOn, run: () => update((x) => ({ ...x, snap: !snapOn })) },
    ],
    size: { label: 'Outline width', smaller: () => stroke(-1), bigger: () => stroke(1) },
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!active) return
    // Undo/redo also right after ticking a box or moving a slider in the side panel (the canvas ignores keys from inputs).
    const t = e.target as HTMLElement
    if (t instanceof HTMLInputElement && ['checkbox', 'radio', 'range'].includes(t.type)) {
      const k = { key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey, target: e.target }
      if (isShortcut(k, 'app.undo')) return e.preventDefault(), doc.undo()
      if (isShortcut(k, 'app.redo')) return e.preventDefault(), doc.redo()
    }
    if (t.closest('input, textarea, select, [contenteditable="true"]')) return
    const mod = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    if (mod && k === 'c') copy()
    else if (mod && k === 'x') {
      copy()
      setScene((s) => deleteNodes(s, selIds))
    } else if (mod && k === 'v') paste()
    else if (mod && k === 'g') {
      if (e.shiftKey) ungroup()
      else group()
    } else return
    e.preventDefault()
  }

  const importFile = async (f: File) => {
    if (!geomReady()) return setMsg('Shape maths are still loading. Try again in a moment.')
    try {
      const made = importSvg(await f.text(), activeLayerId, d.artboard)
      const g = made.length > 1 ? newId() : undefined
      const nodes = made.map((n) => ({ ...n, ...(g ? { groupId: g } : {}) }))
      setScene((s) => addNodes(s, nodes))
      canvas.setSelection(nodes.map((n) => n.id))
      canvas.setToolId('select')
    } catch (err) {
      setMsg((err as Error).message)
    }
  }

  const backToStart = async () => {
    if (d.scene.nodes.length && !(await confirmDialog({ title: 'Start over?', message: 'This removes everything in this drawing. You can undo it.', confirmLabel: 'Start over', danger: true }))) return
    update((x) => ({ ...createVectorDoc(), scene: { ...x.scene, nodes: [] }, presetId: null }))
  }

  // Crisp pixels: whole-pixel positions and live-shape sizes, so 16 and 32 px exports stay sharp.
  const onCanvasChange = (r: (s: Scene<VectorNode>) => Scene<VectorNode>, o?: { undoable?: boolean }) =>
    doc.update(
      (x) => {
        const next = r(x.scene)
        if (!crispRef.current) return { ...x, scene: next }
        const before = new Map(x.scene.nodes.map((n) => [n.id, n]))
        const nodes = next.nodes.map((n) => {
          if (before.get(n.id) === n || !isPaint(n)) return n
          const c = { ...n, x: Math.round(n.x), y: Math.round(n.y) }
          return c.kind === 'vshape' ? { ...c, width: Math.max(1, Math.round(c.width)), height: Math.max(1, Math.round(c.height)) } : c
        })
        return { ...x, scene: { ...next, nodes } }
      },
      o,
    )

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

  const overlay = (api: CanvasApi<VectorNode>, shown: Scene<VectorNode>) => {
    const s = canvas.viewport.scale
    const ed = editId ? shown.nodes.find((n): n is PathNode => n.id === editId && n.kind === 'vpath') : undefined
    return (
      <>
        <div className="vec-artboard" style={{ width: d.artboard.width, height: d.artboard.height, boxShadow: `0 0 0 ${1.5 / s}px var(--accent)` }} />
        {guides.length > 0 && (
          <svg className="vec-overlay" aria-hidden>
            {guides.map((g, i) => (g.x !== undefined ? <line key={i} x1={g.x} x2={g.x} y1={-1e5} y2={1e5} stroke="#e03170" strokeWidth={1 / s} /> : <line key={i} y1={g.y} y2={g.y} x1={-1e5} x2={1e5} stroke="#e03170" strokeWidth={1 / s} />))}
          </svg>
        )}
        {ed && <PointsOverlay node={ed} picked={picked} scale={api.viewport.scale} />}
      </>
    )
  }
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
  const effect = lookNow.shadow ? (lookNow.glow ? 'glow' : 'shadow') : 'none'
  const pickedAnchor = editing && picked ? editing.paths[picked.sp]?.anchors[picked.i] : undefined
  const one = sel.length === 1 ? first : undefined
  const fonts = systemFonts()

  return (
    <div className="vec" ref={rootRef} onKeyDown={onKeyDown}>
      <div className="vec-main">
        <div className="vec-canvas" ref={boxRef} style={artStyle}>
          <CanvasEditor<VectorNode>
            scene={d.scene}
            onChange={onCanvasChange}
            onUndo={doc.undo}
            onRedo={doc.redo}
            canUndo={doc.canUndo}
            canRedo={doc.canRedo}
            active={active}
            tools={tools}
            nodeTypes={VECTOR_NODE_TYPES}
            canvas={canvas}
            apiRef={apiRef}
            html={overlay}
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
          {msg && (
            <div className="vec-msg" role="status" onClick={() => setMsg(null)}>
              {msg}
            </div>
          )}
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
        {editing ? (
          <section className="vec-section">
            <h3>Editing points</h3>
            <p className="vec-muted vec-small">Drag a point or its handles. Click the outline to add a point. Alt-drag a handle to make a sharp bend. Delete removes the picked point.</p>
            <div className="vec-row vec-wrap">
              <button className="btn" disabled={!pickedAnchor} onClick={() => picked && setScene((s) => updateNodes(s, [editing.id], (n) => withPaths(n as PathNode, toggleSmooth((n as PathNode).paths, picked.sp, picked.i))))}>
                {pickedAnchor?.kind === 'Smooth' || pickedAnchor?.in || pickedAnchor?.out ? 'Make it a corner' : 'Make it smooth'}
              </button>
              <button
                className="btn"
                disabled={!pickedAnchor}
                onClick={() => {
                  if (!picked) return
                  const paths = removeAnchor(editing.paths, picked.sp, picked.i)
                  setPicked(null)
                  setScene((s) => (paths.length ? updateNodes(s, [editing.id], (n) => withPaths(n as PathNode, paths)) : deleteNodes(s, [editing.id])))
                }}
              >
                Delete point
              </button>
              <button className="btn" title="Open the path at the picked point, or close an open one" onClick={() => setScene((s) => updateNodes(s, [editing.id], (n) => ({ ...(n as PathNode), paths: (n as PathNode).paths.map((p, k) => (k === (picked?.sp ?? 0) ? { ...p, closed: !p.closed } : p)) })))}>
                {editing.paths[picked?.sp ?? 0]?.closed ? 'Open the path' : 'Close the path'}
              </button>
              <button className="btn btn-primary" onClick={() => editPoints(null)}>
                Done
              </button>
            </div>
          </section>
        ) : (
          <section className="vec-section">
            <h3>{T.shapes}</h3>
            <div className="vec-shape-grid">
              {SHAPES.map((k) => (
                <button key={k} className={`vec-shape-btn${kind === k && canvas.toolId === 'shape' ? ' active' : ''}`} title={`${SHAPE_LABEL[k]}: click to add it in the middle`} onClick={() => addShape(k)}>
                  <ShapeIcon shapeId={k} />
                  <span>{SHAPE_LABEL[k]}</span>
                </button>
              ))}
              <button className="vec-shape-btn" title="Line: a straight line you can bend with Edit points" onClick={addLine}>
                <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden>
                  <path d="M3 21L21 3" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
                </svg>
                <span>Line</span>
              </button>
            </div>
            <div className="vec-row vec-wrap">
              <button className={`btn${canvas.toolId === 'pen' ? ' btn-primary' : ''}`} title="Click for corners, drag for curves, click the first point to close" onClick={() => canvas.setToolId('pen')}>
                Pen (P)
              </button>
              <button className={`btn${canvas.toolId === 'pencil' ? ' btn-primary' : ''}`} title="Draw freely; it becomes smooth curves" onClick={() => canvas.setToolId('pencil')}>
                Pencil (N)
              </button>
              <button className="btn" title="Bring in shapes from an SVG file as editable paths" onClick={() => fileRef.current?.click()}>
                Import SVG…
              </button>
              <input ref={fileRef} type="file" accept=".svg,image/svg+xml" hidden onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) void importFile(f)
                }}
              />
            </div>
            {canvas.toolId === 'pencil' && <Slider label="Smoothing" value={smooth} min={0} max={100} onChange={setSmooth} unit=" %" />}
            <p className="vec-muted vec-small">Click a shape button to add it in the middle, or press S and drag. Double-click any shape to edit its points. T writes text.</p>
          </section>
        )}

        {paints.length > 0 && !editing && (
          <section className="vec-section">
            <h3>Combine and change</h3>
            <div className="vec-combine">
              {COMBINE.map((c) => (
                <button key={c.mode} className="vec-combine-btn" disabled={paints.length < 2} title={`${c.hint} (${c.pro})`} onClick={() => doCombine(c.mode)}>
                  <CombineIcon mode={c.mode} />
                  <span>{c.label}</span>
                  <em>{c.pro}</em>
                </button>
              ))}
            </div>
            {paints.length < 2 && <p className="vec-muted vec-small">Select two or more shapes (Shift-click) to combine them.</p>}
            <div className="vec-row vec-wrap">
              <button className={`btn${canvas.toolId === 'builder' ? ' btn-primary' : ''}`} title="Drag across overlapping pieces to join them; Alt-drag removes them" onClick={() => canvas.setToolId('builder')}>
                Shape builder (M)
              </button>
              {paints.some((n) => n.kind === 'vpath' && n.from?.length) && (
                <button className="btn" title="Get the shapes back that this was combined from" onClick={takeApart}>
                  Take apart
                </button>
              )}
              {paints.length === 1 && (
                <button className="btn" title="Turn it into points you can drag (A)" onClick={() => editPoints(paints[0].id)}>
                  Edit points
                </button>
              )}
              {paints.some((n) => n.strokeWidth && n.strokeColor) && (
                <button className="btn" title="Turn the outline into a shape of its own (Outline stroke)" onClick={outlineToShape}>
                  Outline to shape
                </button>
              )}
            </div>
            <Slider label="Grow or shrink by" value={grow} min={1} max={40} onChange={setGrow} unit=" px" />
            <div className="vec-row vec-wrap">
              <button className="btn" title="Make it bigger all around, keeping its form (Offset path)" onClick={() => growShrink(grow)}>
                Grow
              </button>
              <button className="btn" title="Make it smaller all around, keeping its form (Offset path)" onClick={() => growShrink(-grow)}>
                Shrink
              </button>
            </div>
          </section>
        )}

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
            <ColourButton label={T.fill} value={lookNow.fillColor} allowNone onPick={(c) => patch(() => ({ fillColor: c ?? 'transparent' }), () => ({ textColor: c ?? OUTLINE_DARK }))} />
          </div>
          {(!first || isPaint(first)) && (
            <>
              <div className="vec-row">
                <label>
                  <input type="checkbox" checked={!!lookNow.fill2Color} onChange={(e) => patch((n) => ({ fill2Color: e.target.checked ? (n.fillColor && n.fillColor !== 'transparent' ? shade(n.fillColor, -0.35) : '#1c7ed6') : undefined }), undefined, true)} /> {T.gradient}
                </label>
                {lookNow.fill2Color && <ColourButton label="Second colour" value={lookNow.fill2Color} onPick={(c) => patch(() => ({ fill2Color: c }))} />}
              </div>
              {lookNow.fill2Color && (
                <>
                  <div className="vec-row">
                    <label>
                      <input type="checkbox" checked={!!lookNow.gradRadial} onChange={(e) => patch(() => ({ gradRadial: e.target.checked }), undefined, true)} /> Round (from the middle out)
                    </label>
                  </div>
                  {!lookNow.gradRadial && <Slider label="Direction" value={lookNow.gradAngle ?? 0} min={0} max={359} onChange={(v) => patch(() => ({ gradAngle: v }))} unit="°" />}
                </>
              )}
              <div className="vec-row">
                <span>{T.outline}</span>
                <ColourButton label="Outline colour" value={lookNow.strokeColor} onPick={(c) => patch((n) => ({ strokeColor: c, strokeWidth: n.strokeWidth || Math.max(2, Math.round(maxStroke / 4)) }))} />
              </div>
              <Slider label="Outline width" value={lookNow.strokeWidth ?? 0} min={0} max={maxStroke} step={0.5} onChange={(v) => patch(() => ({ strokeWidth: v }))} unit=" px" />
              {!!lookNow.strokeWidth && (
                <div className="vec-row vec-wrap">
                  <label>
                    <input type="checkbox" checked={!!lookNow.strokeDash} onChange={(e) => patch(() => ({ strokeDash: e.target.checked }), undefined, true)} /> Dashed
                  </label>
                  <label>
                    <input type="checkbox" checked={!!lookNow.strokeSharp} onChange={(e) => patch(() => ({ strokeSharp: e.target.checked }), undefined, true)} /> Sharp corners
                  </label>
                </div>
              )}
              <div className="vec-row vec-wrap" role="radiogroup" aria-label="Effect">
                {(['none', 'shadow', 'glow'] as const).map((k) => (
                  <label key={k}>
                    <input type="radio" name={`vec-fx-${documentId}`} checked={effect === k} onChange={() => patch(() => ({ shadow: k !== 'none', glow: k === 'glow' }), undefined, true)} /> {k === 'none' ? 'No effect' : k === 'shadow' ? T.shadow : 'Glow'}
                  </label>
                ))}
              </div>
              {effect !== 'none' && (
                <>
                  <div className="vec-row">
                    <span>{effect === 'glow' ? 'Glow colour' : 'Shadow colour'}</span>
                    <ColourButton label="Effect colour" value={lookNow.shadowColor ?? (effect === 'glow' ? '#ffd43b' : '#000000')} onPick={(c) => patch(() => ({ shadowColor: c }))} />
                  </div>
                  <Slider label="Effect size" value={lookNow.shadowSize ?? 100} min={20} max={400} step={10} onChange={(v) => patch(() => ({ shadowSize: v }))} unit=" %" />
                </>
              )}
              <Slider label={T.opacity} value={Math.round((1 - (lookNow.opacity ?? 1)) * 100)} min={0} max={90} onChange={(v) => patch(() => ({ opacity: 1 - v / 100 }))} unit=" %" />
              {paints.length > 0 && (
                <div className="vec-row vec-wrap">
                  <button className="btn" title="Remember this look" onClick={() => setCopiedLook(lookOf(paints[0]))}>
                    Copy look
                  </button>
                  <button className="btn" disabled={!copiedLook} title="Give the selected shapes the remembered look" onClick={() => copiedLook && patch(() => copiedLook, undefined, true)}>
                    Paste look
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        {texts.length > 0 && (
          <section className="vec-section">
            <h3>Text</h3>
            <label className="vec-row">
              <span>Font</span>
              <select className="input" value={texts[0].fontFamily ?? 'Lexend Deca'} onChange={(e) => patch(() => ({}), () => ({ fontFamily: e.target.value }), true)}>
                {fonts.map((f) => (
                  <option key={f} value={f} style={{ fontFamily: `'${f}'` }}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <Slider label="Size" value={texts[0].fontSize} min={6} max={Math.max(48, Math.round(d.artboard.height / 2))} onChange={(v) => patch(() => ({}), () => ({ fontSize: v }))} unit=" px" />
            <div className="vec-row vec-wrap">
              <button className={`btn${texts[0].bold ? ' btn-primary' : ''}`} aria-pressed={!!texts[0].bold} onClick={() => patch(() => ({}), (n) => ({ bold: !n.bold }), true)}>
                <b>B</b>
              </button>
              <button className={`btn${texts[0].italic ? ' btn-primary' : ''}`} aria-pressed={!!texts[0].italic} onClick={() => patch(() => ({}), (n) => ({ italic: !n.italic }), true)}>
                <i>I</i>
              </button>
              {(['left', 'center', 'right'] as const).map((a) => (
                <button key={a} className={`btn${(texts[0].align ?? 'left') === a ? ' btn-primary' : ''}`} onClick={() => patch(() => ({}), () => ({ align: a, autoWidth: undefined }), true)}>
                  {a === 'left' ? 'Left' : a === 'center' ? 'Centre' : 'Right'}
                </button>
              ))}
            </div>
          </section>
        )}

        {firstShape && sliders && (sliders.corner || sliders.sides || sliders.inner) && (
          <section className="vec-section">
            <h3>
              {T.shape}: {SHAPE_LABEL[firstShape.shapeId]}
            </h3>
            {sliders.corner && <Slider label={T.corner} value={firstShape.corner ?? defaults.corner ?? 0} min={0} max={100} onChange={(v) => setSceneTweak(tweak, selIds, (n) => (n.kind === 'vshape' && n.shapeId === firstShape.shapeId ? { ...n, corner: v } : n))} unit=" %" />}
            {sliders.sides && <Slider label={sliders.sides.label} value={firstShape.sides ?? defaults.sides ?? 5} min={sliders.sides.min} max={sliders.sides.max} onChange={(v) => setSceneTweak(tweak, selIds, (n) => (n.kind === 'vshape' && n.shapeId === firstShape.shapeId ? { ...n, sides: v } : n))} />}
            {sliders.inner && <Slider label={sliders.inner} value={firstShape.inner ?? defaults.inner ?? 50} min={5} max={95} onChange={(v) => setSceneTweak(tweak, selIds, (n) => (n.kind === 'vshape' && n.shapeId === firstShape.shapeId ? { ...n, inner: v } : n))} unit=" %" />}
          </section>
        )}

        {sel.length > 0 && !editing && (
          <section className="vec-section">
            <h3>{T.arrange}</h3>
            {one && (
              <div className="vec-row vec-wrap">
                <NumBox label="X" value={one.x} onSet={(x) => setGeom({ x })} />
                <NumBox label="Y" value={one.y} onSet={(y) => setGeom({ y })} />
                {'width' in one && <NumBox label="W" value={one.width} onSet={(width) => setGeom({ width })} />}
                {one.kind !== 'text' && <NumBox label="H" value={one.height} onSet={(height) => setGeom({ height })} />}
                <NumBox label="°" title="Turn (degrees)" value={one.rotation ?? 0} onSet={(rotation) => setGeom({ rotation })} />
              </div>
            )}
            <div className="vec-align" role="group" aria-label={sel.length === 1 ? 'Line up with the drawing' : 'Line up with each other'}>
              {(
                [
                  ['left', AlignStartVertical, 'Left'],
                  ['hcentre', AlignCenterVertical, 'Centre'],
                  ['right', AlignEndVertical, 'Right'],
                  ['top', AlignStartHorizontal, 'Top'],
                  ['vcentre', AlignCenterHorizontal, 'Middle'],
                  ['bottom', AlignEndHorizontal, 'Bottom'],
                ] as const
              ).map(([how, Icon, label]) => (
                <button key={how} className="canvas-toolbar-btn" title={`${label} ${sel.length === 1 ? 'of the drawing' : '(line up with each other)'}`} aria-label={label} onClick={() => align(how)}>
                  <Icon size={16} />
                </button>
              ))}
              <button className="canvas-toolbar-btn" disabled={sel.length < 3} title="Same gaps left to right" aria-label="Spread out across" onClick={() => spread('x')}>
                <AlignHorizontalSpaceAround size={16} />
              </button>
              <button className="canvas-toolbar-btn" disabled={sel.length < 3} title="Same gaps top to bottom" aria-label="Spread out down" onClick={() => spread('y')}>
                <AlignVerticalSpaceAround size={16} />
              </button>
              <button className="canvas-toolbar-btn" title="Mirror left to right" aria-label="Mirror left to right" onClick={() => flip('x')}>
                <FlipHorizontal2 size={16} />
              </button>
              <button className="canvas-toolbar-btn" title="Mirror top to bottom" aria-label="Mirror top to bottom" onClick={() => flip('y')}>
                <FlipVertical2 size={16} />
              </button>
            </div>
            <div className="vec-row vec-wrap">
              <button className="btn" disabled={sel.length < 2} title="Ctrl+G: move and pick them as one" onClick={group}>
                Group
              </button>
              {grouped && (
                <button className="btn" title="Ctrl+Shift+G" onClick={ungroup}>
                  Ungroup
                </button>
              )}
              <button className="btn" title="Ctrl+C" onClick={copy}>
                Copy
              </button>
              <button className="btn" disabled={!clipboard.length} title="Ctrl+V" onClick={paste}>
                Paste
              </button>
            </div>
          </section>
        )}

        <section className="vec-section">
          <div className="vec-row vec-wrap">
            <label title="Things stick to the drawing's edges and middle and to each other while you move them">
              <input type="checkbox" checked={snapOn} onChange={(e) => update((x) => ({ ...x, snap: e.target.checked }))} /> Snap while moving
            </label>
            <label title="Keeps positions and sizes on whole pixels, so small icons stay sharp">
              <input type="checkbox" checked={crisp} onChange={(e) => update((x) => ({ ...x, crisp: e.target.checked }))} /> Crisp pixels
            </label>
          </div>
        </section>

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
          <button className="vec-link" onClick={() => void backToStart()}>
            Start over (back to “{T.start}”)
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

/** Slider changes to the selected items, merged into one undo step while the slider moves. */
function setSceneTweak(tweak: (fn: (x: VectorDoc) => VectorDoc) => void, ids: string[], fn: (n: VectorNode) => VectorNode) {
  tweak((x) => ({ ...x, scene: updateNodes(x.scene, ids, fn) }))
}
