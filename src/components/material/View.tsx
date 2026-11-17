// EXPERIMENTAL: Material Lab, first screens (gallery, big preview, Simple view). The Graph view comes next.
import { zipSync } from 'fflate'
import { Dices, Grid3x3, Image as ImageIcon, LayoutGrid, Loader2, RotateCcw, Save, Search, Undo2, Redo2, Circle, SlidersHorizontal, Workflow } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { safeFileName, saveBinaryFile } from '@/core/export'
import type { PanelProps } from '@/core/registry'
import { useDocument, useProjectStore } from '@/core/state'
import type { Json } from '@/shared/material/gen'
import {
  createMaterialDoc, emptyGraph, GALLERY, galleryGraph, loadMaterial, MAPS, MATERIAL_SLIDERS, materialNode, materialParam,
  materialTint, renderMaps, searchGallery, type MapKey, type MaterialDoc,
} from '@/shared/material/material'
import { LIGHTS, MaterialPreview, type PreviewShape } from '@/shared/material/preview'
import { MaterialRenderer } from '@/shared/material/render'
import { GraphView } from './GraphView'
import { godotMaterial } from './godot'
import { SendMenu } from '@/shell/editor/SendMenu'
import { canvasBytes } from '@/shared/print'
import './material.css'

const T = {
  start: 'Pick a material to start from',
  startHint: 'Every material can be changed afterwards. Search with everyday words like "old", "floor" or "dungeon".',
  search: 'Search materials',
  empty: 'Empty',
  emptyHint: 'Only the Material node, for building your own in the Graph view',
  noMatch: 'No material matches those words.',
  experimental: 'Experimental: Material Lab is new. The Layers view and more ready materials come next.',
  shapes: { ball: 'Ball', tiled: 'Tiled floor', pixel: 'Pixel-art size' } as Record<PreviewShape, string>,
  shapesHint: { ball: 'Drag to turn it, scroll to zoom', tiled: '3 × 3 tiles, so seams show right away', pixel: 'At 64 × 64 pixels, with hard pixels' } as Record<PreviewShape, string>,
  light: 'Light',
  mode: { simple: 'Simple', graph: 'Graph' },
  modeHint: { simple: 'Pick and tweak with a few sliders', graph: 'Every node and wire of the material, to change anything' },
  lit: 'Lit',
  litHint: 'The whole material, lit',
  rendering: 'Rendering…',
  tint: 'Colour tint',
  tintHint: 'Multiplies the colour; white keeps it as designed',
  surprise: 'Surprise me',
  surpriseHint: 'Rolls a new random variation of the same material',
  asDesigned: 'Back to as designed',
  another: 'Pick another material',
  anotherHint: 'Back to the gallery. Ctrl+Z brings this material back.',
  save: 'Save as images',
  saveHint: 'One PNG per map, in a ZIP, with your slider settings baked in. Works in Godot, Unity, Blender and other engines. The ZIP also has a ready Godot material (.tres): unpack it into your Godot project and drop the .tres on a mesh.',
  send: 'Send colour to…',
  size: 'Size',
  noGpu: 'This device has no WebGL2, which Material Lab needs to draw materials.',
  error: 'This material could not be drawn:',
}

// One renderer for the whole app: shader programs are kept, so switching materials gets faster.
let sharedRenderer: MaterialRenderer | null = null
const renderer = () => (sharedRenderer ??= new MaterialRenderer())

// Gallery thumbnails, drawn once per app run.
const thumbs = new Map<string, string>()
let thumbPreview: MaterialPreview | null = null
function drawThumb(id: string): string {
  if (thumbs.has(id)) return thumbs.get(id)!
  if (!thumbPreview) {
    const c = document.createElement('canvas')
    c.width = c.height = 160
    thumbPreview = new MaterialPreview(c)
  }
  const graph = galleryGraph(id)!
  const r = renderer()
  r.variation = 0
  const maps = renderMaps(r, loadMaterial(graph), 128)
  for (const m of MAPS) thumbPreview.upload(m.key, maps[m.key] ?? null, 128)
  thumbPreview.draw({ ...looks(graph), shape: 'ball', light: LIGHTS[0], yaw: 0.4, pitch: 0.3, zoom: 1, only: null })
  const url = thumbPreview.canvas.toDataURL()
  thumbs.set(id, url)
  return url
}

/** The Material node settings the preview needs. */
const looks = (graph: Json) => ({
  tint: materialTint(graph), metallic: materialParam(graph, 'metallic'), roughness: materialParam(graph, 'roughness'),
  normal: materialParam(graph, 'normal'), ao: materialParam(graph, 'ao'), emission: materialParam(graph, 'emission_energy'),
})

function Gallery({ onPick }: { onPick(id: string | null): void }) {
  const [q, setQ] = useState('')
  const [, setDrawn] = useState(0)
  const list = useMemo(() => searchGallery(q), [q])
  // draw the thumbnails one at a time, so the screen stays responsive
  useEffect(() => {
    let stop = false
    const next = () => {
      if (stop) return
      const id = GALLERY.find(e => !thumbs.has(e.id))?.id
      if (!id) return
      try {
        drawThumb(id)
      } catch {
        thumbs.set(id, '')
      }
      setDrawn(n => n + 1)
      setTimeout(next, 0)
    }
    setTimeout(next, 0)
    return () => {
      stop = true
    }
  }, [])
  return (
    <div className="mat-start">
      <h2>{T.start}</h2>
      <p className="mat-muted">{T.startHint}</p>
      <p className="mat-muted mat-small">{T.experimental}</p>
      <label className="mat-search">
        <Search size={16} aria-hidden />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={T.search} aria-label={T.search} autoFocus />
      </label>
      <div className="mat-gallery">
        {list.map(e => (
          <button key={e.id} className="mat-pick" onClick={() => onPick(e.id)} title={e.words}>
            {thumbs.get(e.id) ? <img src={thumbs.get(e.id)} alt="" /> : <span className="mat-pick-wait"><Loader2 size={20} className="mat-spin" aria-hidden /></span>}
            <span>{e.name}</span>
          </button>
        ))}
        {!q && (
          <button className="mat-pick" onClick={() => onPick(null)} title={T.emptyHint}>
            <span className="mat-pick-wait"><Circle size={28} aria-hidden /></span>
            <span>{T.empty}</span>
          </button>
        )}
      </div>
      {!list.length && <p className="mat-muted">{T.noMatch}</p>}
    </div>
  )
}

/** Sets one Material node setting in a copy of the graph. */
function withParam(graph: Json, param: string, value: Json): Json {
  const g = structuredClone(graph)
  const n = materialNode(g)
  if (n) n.parameters = { ...(n.parameters ?? {}), [param]: value }
  return g
}

const toHex = (c: [number, number, number]) => '#' + c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')
const fromHex = (h: string) => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255, a: 1, type: 'Color' })

/** One map with the slider settings baked in, as PNG bytes. */
async function mapPng(key: MapKey, px: Float32Array | null, size: number, graph: Json): Promise<Uint8Array> {
  const l = looks(graph)
  const fb = MAPS.find(m => m.key === key)!.fallback
  const c = document.createElement('canvas')
  c.width = c.height = px ? size : 1
  const img = c.getContext('2d')!.createImageData(c.width, c.height)
  for (let i = 0; i < img.data.length; i += 4) {
    let v = px ? [px[i], px[i + 1], px[i + 2]] : [...fb]
    if (key === 'albedo') v = v.map((x, j) => x * l.tint[j])
    else if (key === 'metallic') v = v.map(x => x * l.metallic)
    else if (key === 'roughness') v = v.map(x => x * l.roughness)
    else if (key === 'emission') v = v.map(x => x * l.emission)
    else if (key === 'ao') v = v.map(x => 1 + (x - 1) * l.ao)
    else if (key === 'normal') v = [0.5 + (v[0] - 0.5) * l.normal, 0.5 + (v[1] - 0.5) * l.normal, v[2]]
    for (let j = 0; j < 3; j++) img.data[i + j] = Math.round(Math.max(0, Math.min(1, v[j])) * 255)
    img.data[i + 3] = 255
  }
  c.getContext('2d')!.putImageData(img, 0, 0)
  return canvasBytes(c)
}

export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<MaterialDoc>('material', documentId!, createMaterialDoc)
  const title = useProjectStore(s => s.meta?.documents.find(d => d.id === documentId)?.title) ?? 'Material'
  const d = doc.data
  const canvas = useRef<HTMLCanvasElement>(null)
  const preview = useRef<MaterialPreview | null>(null)
  const [mode, setMode] = useState<'simple' | 'graph'>('simple')
  const [shape, setShape] = useState<PreviewShape>('ball')
  const [light, setLight] = useState(0)
  const [only, setOnly] = useState<MapKey | null>(null)
  const [turn, setTurn] = useState({ yaw: 0.4, pitch: 0.3, zoom: 1 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [noGpu, setNoGpu] = useState(false)
  const [exportSize, setExportSize] = useState(1024)
  const [maps, setMaps] = useState<Partial<Record<MapKey, Float32Array | null>>>({})
  const graph = d?.graph ?? null
  const variation = d?.variation ?? 0
  // the maps only change with the nodes and the variation; Material node sliders are applied by the preview itself
  const nodesKey = useMemo(() => (graph ? JSON.stringify({ ...graph, nodes: graph.nodes.map((n: Json) => (n === materialNode(graph) ? { ...n, parameters: {} } : n)) }) : ''), [graph])

  // draw the maps small first, then sharp
  useEffect(() => {
    if (!graph) return
    let stop = false
    setBusy(true)
    const run = (size: number, then?: () => void) =>
      setTimeout(() => {
        if (stop) return
        try {
          const r = renderer()
          r.variation = variation
          const m = renderMaps(r, loadMaterial(JSON.parse(nodesKey)), size)
          if (stop) return
          for (const map of MAPS) preview.current?.upload(map.key, m[map.key] ?? null, size)
          setMaps(m)
          setError(null)
          if (then) then()
          else setBusy(false)
        } catch (e) {
          setError(e instanceof Error ? e.message.split('\n')[0] : String(e))
          setBusy(false)
        }
      }, 0)
    run(128, () => run(512))
    return () => {
      stop = true
    }
    // graph is read through nodesKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodesKey, variation])

  const hasGraph = graph !== null
  // a new canvas each time the editor opens again from the gallery
  useEffect(() => {
    if (!canvas.current || preview.current?.canvas === canvas.current) return
    preview.current?.dispose()
    try {
      preview.current = new MaterialPreview(canvas.current)
    } catch {
      setNoGpu(true)
    }
  }, [hasGraph])

  // keep the canvas as sharp as its box
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ro = new ResizeObserver(() => {
      const k = window.devicePixelRatio || 1
      c.width = Math.max(1, Math.round(c.clientWidth * k))
      c.height = Math.max(1, Math.round(c.clientHeight * k))
      setTurn(t => ({ ...t }))
    })
    ro.observe(c)
    return () => ro.disconnect()
  }, [hasGraph])

  useEffect(() => {
    if (graph) preview.current?.draw({ ...looks(graph), shape, light: LIGHTS[light], ...turn, only })
  }, [graph, shape, light, turn, only, maps])

  const set = useCallback((param: string, value: Json, undoable: boolean) => doc.update(x => ({ ...x, graph: withParam(x.graph, param, value) }), { undoable }), [doc])

  const pick = (id: string | null) =>
    doc.update(x => ({ ...x, graph: id ? galleryGraph(id) : emptyGraph(), from: id ?? undefined, variation: 0 }))

  const save = async () => {
    if (!graph) return
    setBusy(true)
    try {
      const r = renderer()
      r.variation = variation
      const m = renderMaps(r, loadMaterial(graph), exportSize)
      const name = safeFileName(title)
      const files: Record<string, Uint8Array> = {}
      const names: Partial<Record<MapKey, string>> = {}
      for (const map of MAPS) if (m[map.key] || map.key === 'albedo') files[(names[map.key] = `${name}_${map.key}.png`)] = await mapPng(map.key, m[map.key] ?? null, exportSize, graph)
      files[`${name}.tres`] = new TextEncoder().encode(godotMaterial(names))
      await saveBinaryFile({ title: T.save, defaultName: `${name} maps.zip`, bytes: zipSync(files), filter: { name: 'ZIP', extensions: ['zip'] } })
    } finally {
      setBusy(false)
    }
  }

  // the colour map with the sliders baked in, for tools that take a picture (Asset Pool, Moodboard, …)
  const picture = async () => {
    if (!graph) return null
    const r = renderer()
    r.variation = variation
    const png = await mapPng('albedo', renderMaps(r, loadMaterial(graph), exportSize, ['albedo']).albedo ?? null, exportSize, graph)
    return new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' })
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (!active || !(e.ctrlKey || e.metaKey)) return
    const k = e.key.toLowerCase()
    if (k === 'z' && !e.shiftKey) doc.undo()
    else if (k === 'y' || (k === 'z' && e.shiftKey)) doc.redo()
    else return
    e.preventDefault()
  }

  const drag = useRef<{ x: number; y: number } | null>(null)

  if (!d) return null
  if (!graph) return <Gallery onPick={pick} />

  return (
    <div className="mat" onKeyDown={onKey} tabIndex={-1}>
      <div className="mat-main">
        <div className="mat-bar" role="toolbar">
          {(['simple', 'graph'] as const).map(m => (
            <button key={m} className={mode === m ? 'mat-on' : ''} onClick={() => setMode(m)} title={T.modeHint[m]} aria-pressed={mode === m}>
              {m === 'simple' ? <SlidersHorizontal size={16} /> : <Workflow size={16} />} {T.mode[m]}
            </button>
          ))}
          <span className="mat-sep" />
          {(['ball', 'tiled', 'pixel'] as PreviewShape[]).map(s => (
            <button key={s} className={shape === s ? 'mat-on' : ''} onClick={() => setShape(s)} title={T.shapesHint[s]} aria-pressed={shape === s}>
              {s === 'ball' ? <Circle size={16} /> : s === 'tiled' ? <Grid3x3 size={16} /> : <LayoutGrid size={16} />} {T.shapes[s]}
            </button>
          ))}
          <span className="mat-gap" />
          <label className="mat-muted">
            {T.light}{' '}
            <select value={light} onChange={e => setLight(+e.target.value)}>
              {LIGHTS.map((l, i) => (
                <option key={l.name} value={i}>{l.name}</option>
              ))}
            </select>
          </label>
          <button onClick={doc.undo} disabled={!doc.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo"><Undo2 size={16} /></button>
          <button onClick={doc.redo} disabled={!doc.canRedo} title="Redo (Ctrl+Y)" aria-label="Redo"><Redo2 size={16} /></button>
        </div>
        {mode === 'graph' && <GraphView graph={graph} renderer={renderer} variation={variation} change={(fn, undoable) => doc.update(x => ({ ...x, graph: fn(x.graph) }), { undoable })} />}
        <div className={`mat-view${mode === 'graph' ? ' mat-view-small' : ''}`}>
          <canvas
            ref={canvas}
            className="mat-canvas"
            aria-label={`${title}: ${T.shapes[shape]}`}
            onPointerDown={e => {
              drag.current = { x: e.clientX, y: e.clientY }
              e.currentTarget.setPointerCapture(e.pointerId)
            }}
            onPointerMove={e => {
              if (!drag.current || shape !== 'ball') return
              const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y
              drag.current = { x: e.clientX, y: e.clientY }
              setTurn(t => ({ ...t, yaw: t.yaw - dx * 0.01, pitch: Math.max(-1.5, Math.min(1.5, t.pitch + dy * 0.01)) }))
            }}
            onPointerUp={() => (drag.current = null)}
            onWheel={e => setTurn(t => ({ ...t, zoom: Math.max(0.3, Math.min(4, t.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))) }))}
          />
          {noGpu && <p className="mat-note">{T.noGpu}</p>}
          {error && <p className="mat-note">{T.error} {error}</p>}
          {busy && !error && <span className="mat-busy"><Loader2 size={14} className="mat-spin" aria-hidden /> {T.rendering}</span>}
          <span className="mat-hint mat-muted mat-small">{T.shapesHint[shape]}</span>
        </div>
        <div className="mat-strip" role="toolbar" aria-label="Maps">
          <button className={only === null ? 'mat-on' : ''} onClick={() => setOnly(null)} title={T.litHint}>{T.lit}</button>
          {MAPS.filter(m => maps[m.key]).map(m => (
            <button key={m.key} className={only === m.key ? 'mat-on' : ''} onClick={() => setOnly(m.key)} title={`Only the ${m.name.toLowerCase()} map (${m.pro})`}>
              {m.name} <span className="mat-muted mat-small">{m.pro}</span>
            </button>
          ))}
        </div>
      </div>
      <aside className="mat-side" hidden={mode === 'graph'}>
        <h3>{title}</h3>
        <label className="mat-row" title={T.tintHint}>
          <span>{T.tint}</span>
          <input type="color" value={toHex(materialTint(graph))} onChange={e => set('albedo_color', fromHex(e.target.value), false)} onBlur={e => set('albedo_color', fromHex(e.target.value), true)} />
        </label>
        {MATERIAL_SLIDERS.map(s => (
          <label key={s.param} className="mat-slider" title={s.help}>
            <span>{s.name} <span className="mat-muted mat-small">{materialParam(graph, s.param).toFixed(2)}</span></span>
            <input
              type="range" min={s.min} max={s.max} step={0.01} value={materialParam(graph, s.param)}
              onChange={e => set(s.param, +e.target.value, false)}
              onPointerUp={e => set(s.param, +e.currentTarget.value, true)}
              onKeyUp={e => set(s.param, +e.currentTarget.value, true)}
            />
            <span className="mat-muted mat-small">{s.help}</span>
          </label>
        ))}
        <div className="mat-buttons">
          <button onClick={() => doc.update(x => ({ ...x, variation: Math.round(Math.random() * 1000) / 1000 + 0.001 }))} title={T.surpriseHint}><Dices size={16} /> {T.surprise}</button>
          {variation !== 0 && <button onClick={() => doc.update(x => ({ ...x, variation: 0 }))}><RotateCcw size={16} /> {T.asDesigned}</button>}
        </div>
        <div className="mat-buttons">
          <button onClick={() => doc.update(x => ({ ...x, graph: null }))} title={T.anotherHint}><ImageIcon size={16} /> {T.another}</button>
        </div>
        <h4>{T.save}</h4>
        <p className="mat-muted mat-small">{T.saveHint}</p>
        <div className="mat-buttons">
          <label>
            {T.size}{' '}
            <select value={exportSize} onChange={e => setExportSize(+e.target.value)}>
              {[256, 512, 1024, 2048].map(s => (
                <option key={s} value={s}>{s} px</option>
              ))}
            </select>
          </label>
          <button onClick={() => void save()} disabled={busy}><Save size={16} /> {T.save}</button>
          <SendMenu title={title} picture={picture} label={T.send} />
        </div>
      </aside>
    </div>
  )
}
