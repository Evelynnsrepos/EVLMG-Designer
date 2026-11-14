import { Box, Check, Dices, Download, Grid3x3, Mountain, PaintBucket, RefreshCw, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { importAssetFromBlob, resolveAssetPath } from '@/core/assets'
import { saveBinaryFile, safeFileName } from '@/core/export'
import { getFs } from '@/core/fs'
import { newId } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useProjectStore } from '@/core/state'
import { createSketchDoc, SketchEditor, type SketchEditorHandle } from '@/shared/sketch'
import type * as THREE from 'three'
import { createTexturePaintDoc, MODEL_EXTENSIONS, TEXTURE_SIZES, uvFlipped, type TexturePaintDoc } from './model'
import { Viewer, type PaintTarget, type ViewerHandle } from './Viewer'
import { bakeMap, coreAvailable, drawTriangles, FILL_MODES, fillPart, loadModel, packModel, pick, SHAPE_MAPS, toCanvas, unloadModel, WEARS, wearMask, type FillModeKey, type PackedModel, type ShapeMapKey, type WearKey } from './core'
import type { Id } from '@/core/model'
import './texture-paint.css'
import { SendMenu } from '@/shell/editor/SendMenu'

const UI = {
  title: 'Paint a 3D model',
  hint: 'Pick a model and a texture size. You paint on the model on the left or on its texture on the right, with every Draw brush. GLB works best; OBJ and FBX work too.',
  pick: 'Choose a model…',
  size: 'Texture size',
  start: 'Start painting',
  replace: 'Replace the model',
  uv: 'Show the UV layout as a layer',
  glb: 'Export the model with its texture (GLB)',
  noModel: 'Choose a model file first.',
  fill: 'Fill a part: click a piece of the model to fill it with the current colour on the current layer (Ctrl+Z undoes it)',
  maps: 'Add a map made from the model\'s shape as a new layer (Ctrl+Z undoes it)',
  noCore: 'Fill a part and shape maps need the installed app (desktop, tablet or phone).',
  preparing: 'Getting the model ready…',
  noLayer: 'Pick a visible, unlocked paint layer on the right first.',
  wear: 'Add wear or dirt: a new layer in your current colour, with a mask that puts it where it belongs on the model (Ctrl+Z undoes it)',
}

/** The wear layer being tuned: its settings and where its mask is. */
interface WearEdit {
  kind: WearKey
  layerId: Id
  maskId: Id
  amount: number
  breakup: number
  seed: number
}

/** Copy a model file into the project (assets/models/<id>.<ext>). */
async function importModel(root: string): Promise<{ path: string; name: string } | null> {
  const fs = getFs()
  const [picked] = await fs.pickFiles('Choose a 3D model', MODEL_EXTENSIONS)
  if (!picked) return null
  const name = picked.split(/[\\/]/).pop() ?? 'model'
  const ext = name.split('.').pop()!.toLowerCase()
  const file = `${newId()}.${ext}`
  await fs.mkdir(await fs.join(root, 'assets', 'models'))
  await fs.writeBinaryAtomic(await fs.join(root, 'assets', 'models', file), await fs.readBinary(picked))
  return { path: `assets/models/${file}`, name }
}

/** Texture Paint (v0.14): a 3D model and its texture side by side, painted with the Draw engine. */
export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<TexturePaintDoc>('texture-paint', documentId!, createTexturePaintDoc)
  const root = useProjectStore((s) => s.root)
  const title = useProjectStore((s) => s.meta?.documents.find((d) => d.id === documentId)?.title ?? 'Model')
  const editor = useRef<SketchEditorHandle>(null)
  const viewer = useRef<ViewerHandle>(null)
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // Experimental: say so every time the tool opens.
  const [warned, setWarned] = useState(false)
  const model = doc.data?.model ?? null
  // The Rust core's copy of the model, for Fill a part and shape maps.
  const packed = useRef<PackedModel | null>(null)
  const [core, setCore] = useState<'off' | 'loading' | 'ready'>('off')
  const [fillMode, setFillMode] = useState<FillModeKey | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [wear, setWear] = useState<WearEdit | null>(null)
  useEffect(() => () => void unloadModel(documentId!), [documentId])

  useEffect(() => {
    if (!root || !model) return
    let gone = false
    void resolveAssetPath(root, model)
      .then((abs) => getFs().readBinary(abs))
      .then((b) => !gone && setBytes(b.slice().buffer as ArrayBuffer))
      .catch(() => !gone && setBytes(null))
    return () => {
      gone = true
    }
  }, [root, model])

  const target = useMemo<PaintTarget | null>(() => {
    if (!doc.data) return null
    const size = { width: doc.data.width, height: doc.data.height }
    let fallback: HTMLCanvasElement | null = null
    return {
      size,
      version: () => editor.current?.engine.version ?? 0,
      texture: () => editor.current?.render() ?? (fallback ??= Object.assign(document.createElement('canvas'), size)),
      down: (p, t) => editor.current?.paintDown(p, t) ?? false,
      move: (p, t) => editor.current?.paintMove(p, t),
      up: () => editor.current?.paintUp(),
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- only the texture size matters here
  }, [doc.data?.width, doc.data?.height])

  if (!doc.data || !target) return null
  const d = doc.data
  const warning = !warned && (
    <div className="tp-warning" role="alert">
      <strong>Texture Paint is experimental.</strong> It can be slow with big models or textures, some model files may not load right, and things may still change. Keep a copy of your model files.
      <button className="btn btn-primary" onClick={() => setWarned(true)}>
        OK
      </button>
    </div>
  )

  if (!d.started) return <>{warning}<Start model={d.modelName} onPick={async () => {
    if (!root) return
    const m = await importModel(root)
    if (m) doc.update((x) => ({ ...x, model: m.path, modelName: m.name }))
  }} onStart={(size) => doc.update((x) => ({ ...x, ...createSketchDoc(size, size), backgroundColor: '#ffffff', started: true }))} /></>

  /** The model's own texture becomes the first layer, once, when the texture is still empty. */
  const onOriginal = async (img: CanvasImageSource) => {
    if (!root || d.layers.some((l) => l.image) || !editor.current) return
    const c = document.createElement('canvas')
    c.width = d.width
    c.height = d.height
    c.getContext('2d')!.drawImage(img, 0, 0, d.width, d.height)
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'))
    const asset = blob && (await importAssetFromBlob(root, blob, 'image', 'texture.png'))
    if (asset) await editor.current.insertImage(asset.path, 'Original texture', { fill: true })
  }

  const addUvLayer = async () => {
    const c = viewer.current?.uvLayout()
    if (!c || !root || !editor.current) return
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'))
    const asset = blob && (await importAssetFromBlob(root, blob, 'image', 'uv-layout.png'))
    if (!asset) return
    // A guide only: left out of exports and of the model, and locked against painting.
    await editor.current.insertImage(asset.path, 'UV layout', { fill: true, layer: { private: true, locked: true, opacity: 0.6 } })
  }

  const exportGlb = async () => {
    setBusy('Exporting…')
    try {
      const glb = await viewer.current?.exportGlb()
      if (glb) await saveBinaryFile({ title: 'Export the painted model', defaultName: `${safeFileName(title)}.glb`, bytes: new Uint8Array(glb), filter: { name: 'glTF binary', extensions: ['glb'] } })
    } finally {
      setBusy(null)
    }
  }

  const onModel = (meshes: THREE.Mesh[], materials: (THREE.Material | THREE.Material[])[]) => {
    packed.current = null
    if (!coreAvailable()) return setCore('off')
    const m = packModel(meshes, materials, uvFlipped(model ?? ''))
    setCore('loading')
    loadModel(documentId!, m)
      .then(() => {
        packed.current = m
        setCore('ready')
      })
      .catch((e) => {
        setCore('off')
        setNote(`The model could not be prepared: ${String(e)}`)
      })
  }

  const fillAt = async (origin: THREE.Vector3, dir: THREE.Vector3) => {
    const m = packed.current
    if (!m || !fillMode || !editor.current) return
    try {
      const hit = await pick(documentId!, origin, dir)
      if (!hit) return
      const tris = await fillPart(documentId!, fillMode, hit[0], hit[1])
      const ok = editor.current.paintShape((ctx, color) => drawTriangles(ctx, m, tris, { width: d.width, height: d.height }, color))
      setNote(ok ? null : UI.noLayer)
    } catch (e) {
      setNote(String(e))
    }
  }

  const addShapeMap = async (key: ShapeMapKey) => {
    const info = SHAPE_MAPS.find((x) => x.key === key)
    if (!info || !root || !editor.current) return
    // shortcut: bakes at most 2048² and stretches up for 4096 textures; bake at full size once baking reports progress.
    const size = Math.min(d.width, 2048)
    setBusy('Baking…')
    try {
      const img = await bakeMap(documentId!, key, size)
      editor.current.insertPicture(toCanvas(img), info.label.replace(/ \(.*\)$/, ''), { layer: { blend: info.blend, visible: info.visible } })
      setNote(info.visible ? null : `Added as a hidden layer: turn on its eye on the right to see it.`)
    } catch (e) {
      setNote(`Baking failed: ${String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  // shortcut: wear masks share the shape maps' 2048² cap.
  const wearSize = () => Math.min(d.width, 2048)

  const addWear = async (key: WearKey) => {
    const info = WEARS.find((w) => w.key === key)
    if (!info || !editor.current) return
    setBusy('Placing wear…')
    try {
      const seed = 1
      const mask = await wearMask(documentId!, wearSize(), key, info.amount, 0.5, seed)
      const { layerId, maskId } = editor.current.insertPicture(editor.current.color, info.label, { mask: toCanvas(mask) })
      if (maskId) setWear({ kind: key, layerId, maskId, amount: info.amount, breakup: 0.5, seed })
      setNote(null)
    } catch (e) {
      setNote(`Placing wear failed: ${String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  /** New settings for the wear layer: its mask is made again (one undo step each). */
  const retune = async (next: WearEdit) => {
    // The layer was undone or deleted: nothing left to tune.
    if (!editor.current || !d.layers.some((l) => l.id === next.maskId)) return setWear(null)
    setWear(next)
    try {
      const mask = await wearMask(documentId!, wearSize(), next.kind, next.amount, next.breakup, next.seed)
      editor.current.replacePixels(next.maskId, toCanvas(mask))
    } catch (e) {
      setNote(String(e))
    }
  }

  const replace = async () => {
    if (!root) return
    const m = await importModel(root)
    if (m) doc.update((x) => ({ ...x, model: m.path, modelName: m.name }))
  }

  return (
    <div className="tp">
      {warning}
      <div className="tp-left">
        <div className="tp-bar">
          <span className="tp-name" title={d.modelName}>
            <Box size={14} /> {d.modelName || UI.noModel}
          </span>
          <button className="btn btn-ghost" title={UI.uv} onClick={() => void addUvLayer()} disabled={!bytes}>
            <Grid3x3 size={14} /> UV layout
          </button>
          <label className="tp-pick" title={core === 'off' ? UI.noCore : UI.fill}>
            <PaintBucket size={14} />
            <select value={fillMode ?? ''} disabled={core !== 'ready'} onChange={(e) => setFillMode((e.target.value || null) as FillModeKey | null)}>
              <option value="">Paint with the brush</option>
              {FILL_MODES.map((m) => (
                <option key={m.key} value={m.key}>
                  Fill: {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="tp-pick" title={core === 'off' ? UI.noCore : UI.maps}>
            <Mountain size={14} />
            <select value="" disabled={core !== 'ready' || !!busy} onChange={(e) => e.target.value && void addShapeMap(e.target.value as ShapeMapKey)}>
              <option value="">{core === 'loading' ? UI.preparing : 'Add a shape map…'}</option>
              {SHAPE_MAPS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="tp-pick" title={core === 'off' ? UI.noCore : UI.wear}>
            <Sparkles size={14} />
            <select value="" disabled={core !== 'ready' || !!busy} onChange={(e) => e.target.value && void addWear(e.target.value as WearKey)}>
              <option value="">Add wear…</option>
              {WEARS.map((w) => (
                <option key={w.key} value={w.key} title={w.hint}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-ghost" title={UI.glb} onClick={() => void exportGlb()} disabled={!bytes || !!busy}>
            <Download size={14} /> {busy ?? 'GLB'}
          </button>
          <button className="btn btn-ghost" title={UI.replace} onClick={() => void replace()}>
            <RefreshCw size={14} />
          </button>
        </div>
        {wear && <WearBar key={`${wear.layerId}:${wear.amount}:${wear.breakup}:${wear.seed}`} wear={wear} onChange={(w) => void retune(w)} onDone={() => setWear(null)} />}
        <Viewer bytes={bytes} path={model ?? ''} target={target} onOriginal={(img) => void onOriginal(img)} onModel={onModel} filling={!!fillMode && core === 'ready'} onFillAt={(o, dir) => void fillAt(o, dir)} handleRef={viewer} />
        <p className="tp-hint" role="status">
          {note ?? (fillMode ? 'Click a piece of the model to fill it with the current colour. Drag next to it or with the right button to turn.' : 'Paint on the model with the left button. Drag next to it or with the right button to turn, the middle button to move, the wheel to zoom.')}
        </p>
      </div>
      <div className="tp-right">
        <SketchEditor editorRef={editor} doc={d} update={(fn) => doc.update((x) => ({ ...x, ...fn(x) }), { undoable: false })} active={active} title={title} actions={(flatten) => <SendMenu title={title} picture={flatten} label="Send the texture to…" />} />
      </div>
    </div>
  )
}

function Start({ model, onPick, onStart }: { model: string; onPick(): void; onStart(size: number): void }) {
  const [size, setSize] = useState(2048)
  return (
    <div className="sketch-start">
      <h2>{UI.title}</h2>
      <p className="muted">{UI.hint}</p>
      <button className="btn" onClick={onPick}>
        <Box size={14} /> {model || UI.pick}
      </button>
      <div className="sketch-start-presets">
        {TEXTURE_SIZES.map((s) => (
          <button key={s} className={`btn${s === size ? ' btn-primary' : ''}`} onClick={() => setSize(s)}>
            {s} × {s}
          </button>
        ))}
      </div>
      <button className="btn btn-primary" disabled={!model} onClick={() => onStart(size)}>
        {UI.start}
      </button>
    </div>
  )
}

/** Tune the wear layer just added: sliders take effect when let go, each change one undo step. */
function WearBar({ wear, onChange, onDone }: { wear: WearEdit; onChange(w: WearEdit): void; onDone(): void }) {
  const [amount, setAmount] = useState(wear.amount)
  const [breakup, setBreakup] = useState(wear.breakup)
  const label = WEARS.find((w) => w.key === wear.kind)?.label ?? 'Wear'
  const commit = () => (amount !== wear.amount || breakup !== wear.breakup) && onChange({ ...wear, amount, breakup })
  return (
    <div className="tp-wear" role="group" aria-label={`${label} settings`}>
      <strong>{label}</strong>
      <label title="Less or more of it">
        How much
        <input type="range" min={0} max={1} step={0.01} value={amount} onChange={(e) => setAmount(+e.target.value)} onPointerUp={commit} onKeyUp={commit} />
      </label>
      <label title="Smooth edges, or broken up by noise">
        Break up
        <input type="range" min={0} max={1} step={0.01} value={breakup} onChange={(e) => setBreakup(+e.target.value)} onPointerUp={commit} onKeyUp={commit} />
      </label>
      <button className="btn btn-ghost" title="Another random pattern" onClick={() => onChange({ ...wear, seed: wear.seed + 1 })}>
        <Dices size={14} /> New pattern
      </button>
      <button className="btn btn-ghost" title="Done: paint the mask on the right to add or take away wear by hand" onClick={onDone}>
        <Check size={14} /> Done
      </button>
    </div>
  )
}
