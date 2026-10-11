import { Box, Download, Grid3x3, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { importAssetFromBlob, resolveAssetPath } from '@/core/assets'
import { saveBinaryFile, safeFileName } from '@/core/export'
import { getFs } from '@/core/fs'
import { newId } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useProjectStore } from '@/core/state'
import { createSketchDoc, SketchEditor, type SketchEditorHandle } from '@/shared/sketch'
import { createTexturePaintDoc, MODEL_EXTENSIONS, TEXTURE_SIZES, type TexturePaintDoc } from './model'
import { Viewer, type PaintTarget, type ViewerHandle } from './Viewer'
import './texture-paint.css'

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
          <button className="btn btn-ghost" title={UI.glb} onClick={() => void exportGlb()} disabled={!bytes || !!busy}>
            <Download size={14} /> {busy ?? 'GLB'}
          </button>
          <button className="btn btn-ghost" title={UI.replace} onClick={() => void replace()}>
            <RefreshCw size={14} />
          </button>
        </div>
        <Viewer bytes={bytes} path={model ?? ''} target={target} onOriginal={(img) => void onOriginal(img)} handleRef={viewer} />
        <p className="tp-hint">Paint on the model with the left button. Drag next to it or with the right button to turn, the middle button to move, the wheel to zoom.</p>
      </div>
      <div className="tp-right">
        <SketchEditor editorRef={editor} doc={d} update={(fn) => doc.update((x) => ({ ...x, ...fn(x) }), { undoable: false })} active={active} title={title} />
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
