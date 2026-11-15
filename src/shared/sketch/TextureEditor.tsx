import { Brush, ClipboardPaste, Crop, FlipVertical2, ImageUp, Repeat, RotateCw, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { brushTip, type BrushSettings } from './brushes'
import { grainCanvas, GRAINS, loadImageMask, makeTileable, maskFromPixels, SHAPES, tipImage, usesAlpha, type BrushGrain, type BrushShape } from './brushTextures'

const UI = {
  shapeLibrary: 'Shape library',
  grainLibrary: 'Grain library',
  custom: 'Your own image',
  import: 'Import image',
  paste: 'Paste',
  pasteHint: 'Nothing to paste. Copy an image first (or press Ctrl+V here).',
  draw: 'Draw it',
  invert: 'Invert',
  rotate: 'Turn 90°',
  crop: 'Crop to the drawing',
  tile: 'Make it tile',
  use: 'Use this',
  clearDraw: 'Clear',
  cancel: 'Cancel',
  drawHelp: 'Draw in white: white paints, black stays empty.',
  remove: 'Back to the built-in shape',
  white: 'White paints, black stays empty.',
}

const SIDE = 256

function canvas(w: number, h = w) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/** Store a mask as an opaque gray PNG (white = paint), at most 512 px. */
function maskToDataUrl(src: CanvasImageSource & { width: number; height: number }): string {
  const s = Math.min(1, 512 / Math.max(src.width, src.height))
  const c = canvas(Math.max(1, Math.round(src.width * s)), Math.max(1, Math.round(src.height * s)))
  const g = c.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, c.width, c.height)
  g.drawImage(src, 0, 0, c.width, c.height)
  return c.toDataURL('image/png')
}

/** Any image file or blob → a brush image data URL (a mask, or alpha + greys for see-through images). */
export async function blobToMask(blob: Blob): Promise<string | null> {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const s = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight))
    const c = canvas(Math.max(1, Math.round(img.naturalWidth * s)), Math.max(1, Math.round(img.naturalHeight * s)))
    const g = c.getContext('2d', { willReadFrequently: true })!
    g.drawImage(img, 0, 0, c.width, c.height)
    const data = g.getImageData(0, 0, c.width, c.height).data
    // A see-through image keeps its greys too (as alpha + grey), for brushes that keep the image's light and dark.
    if (usesAlpha(data)) return shadedUrl(data, c.width, c.height)
    return grayUrl(maskFromPixels(data), c.width, c.height)
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

function shadedUrl(data: Uint8ClampedArray, w: number, h: number) {
  const c = canvas(w, h)
  const img = new ImageData(w, h)
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    img.data[o] = img.data[o + 1] = img.data[o + 2] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]
    img.data[o + 3] = data[o + 3]
  }
  c.getContext('2d')!.putImageData(img, 0, 0)
  return c.toDataURL('image/png')
}

function grayUrl(mask: Uint8ClampedArray, w: number, h: number) {
  const c = canvas(w, h)
  const img = new ImageData(w, h)
  for (let i = 0; i < mask.length; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = mask[i]
    img.data[i * 4 + 3] = 255
  }
  c.getContext('2d')!.putImageData(img, 0, 0)
  return c.toDataURL('image/png')
}

/** The current shape or grain as a mask canvas (white with alpha). */
function currentMask(kind: 'shape' | 'grain', b: BrushSettings): HTMLCanvasElement | null {
  if (kind === 'shape') return b.shapeImage ? brushTip(b) : tipImage(b.shape, b.hardness)
  const g = grainCanvas({ ...b, grainDepth: 1, grainContrast: 0, grainBrightness: 0, grainInvert: false }, 'gray')
  if (!g) return null
  // Gray → alpha mask.
  const c = canvas(g.width, g.height)
  const x = c.getContext('2d')!
  x.drawImage(g, 0, 0)
  const d = x.getImageData(0, 0, c.width, c.height)
  for (let i = 0; i < d.data.length; i += 4) {
    d.data[i + 3] = d.data[i]
    d.data[i] = d.data[i + 1] = d.data[i + 2] = 255
  }
  x.putImageData(d, 0, 0)
  return c
}

/** Pixels of a mask canvas as 0..255 values. */
function maskValues(c: HTMLCanvasElement) {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data
  const out = new Uint8ClampedArray(c.width * c.height)
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3]
  return out
}

/** Editor for a brush's shape or grain: pick a built-in one, import, paste or draw your own, and change it. */
export function TextureEditor({ kind, brush, onChange }: { kind: 'shape' | 'grain'; brush: BrushSettings; onChange: (patch: Partial<BrushSettings>) => void }) {
  const [drawing, setDrawing] = useState(false)
  const [note, setNote] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const image = kind === 'shape' ? brush.shapeImage : brush.grainImage
  const setImage = (url: string | null) => onChange(kind === 'shape' ? { shapeImage: url, shapeInvert: false } : { grainImage: url, grainInvert: false })
  const [, loaded] = useState(0)
  useEffect(() => {
    if (image) void loadImageMask(image).then(() => loaded((n) => n + 1))
  }, [image])

  const takeBlob = async (blob: Blob) => {
    const url = await blobToMask(blob)
    if (url) {
      setNote('')
      setImage(url)
    }
  }

  // Ctrl+V while the editor is open pastes an image.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))
      const blob = item?.getAsFile()
      if (blob) {
        e.preventDefault()
        void takeBlob(blob)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  const paste = async () => {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith('image/'))
        if (type) return void (await takeBlob(await item.getType(type)))
      }
    } catch {
      // No permission or nothing there.
    }
    setNote(UI.pasteHint)
  }

  /** Change the current mask with a canvas operation and store the result as an image. */
  const transform = (fn: (src: HTMLCanvasElement) => HTMLCanvasElement | Uint8ClampedArray) => {
    const src = currentMask(kind, brush)
    if (!src) return
    const out = fn(src)
    setImage(out instanceof HTMLCanvasElement ? maskToDataUrl(out) : grayUrl(out, src.width, src.height))
  }

  const rotate = () =>
    transform((src) => {
      const c = canvas(src.height, src.width)
      const g = c.getContext('2d')!
      g.translate(c.width / 2, c.height / 2)
      g.rotate(Math.PI / 2)
      g.drawImage(src, -src.width / 2, -src.height / 2)
      return c
    })

  const crop = () =>
    transform((src) => {
      const v = maskValues(src)
      let x0 = src.width
      let y0 = src.height
      let x1 = -1
      let y1 = -1
      for (let y = 0; y < src.height; y++)
        for (let x = 0; x < src.width; x++)
          if (v[y * src.width + x] > 8) {
            x0 = Math.min(x0, x)
            y0 = Math.min(y0, y)
            x1 = Math.max(x1, x)
            y1 = Math.max(y1, y)
          }
      if (x1 < 0) return src
      // Keep it square and centred, so stamps don't stretch.
      const side = Math.max(x1 - x0, y1 - y0) + 3
      const c = canvas(side)
      c.getContext('2d')!.drawImage(src, x0 - (side - (x1 - x0)) / 2, y0 - (side - (y1 - y0)) / 2)
      return c
    })

  const invert = () => onChange(kind === 'shape' ? { shapeInvert: !brush.shapeInvert } : { grainInvert: !brush.grainInvert })

  return (
    <div className="studio-texture">
      <TexturePreview kind={kind} brush={brush} />
      <div className="studio-texture-tools">
        <button className="btn" onClick={() => file.current?.click()}>
          <ImageUp size={14} /> {UI.import}
        </button>
        <button className="btn" onClick={() => void paste()}>
          <ClipboardPaste size={14} /> {UI.paste}
        </button>
        <button className="btn" onClick={() => setDrawing(true)}>
          <Brush size={14} /> {UI.draw}
        </button>
        <button className={`btn${(kind === 'shape' ? brush.shapeInvert : brush.grainInvert) ? ' is-active' : ''}`} onClick={invert}>
          <FlipVertical2 size={14} /> {UI.invert}
        </button>
        <button className="btn" onClick={rotate}>
          <RotateCw size={14} /> {UI.rotate}
        </button>
        {kind === 'shape' ? (
          <button className="btn" onClick={crop}>
            <Crop size={14} /> {UI.crop}
          </button>
        ) : (
          <button className="btn" onClick={() => transform((src) => makeTileable(maskValues(src), src.width, src.height))}>
            <Repeat size={14} /> {UI.tile}
          </button>
        )}
        {image && (
          <button className="btn btn-ghost" onClick={() => setImage(null)}>
            <Trash2 size={14} /> {UI.remove}
          </button>
        )}
        <input
          ref={file}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void takeBlob(f)
            e.target.value = ''
          }}
        />
      </div>
      {note && <p className="muted studio-note">{note}</p>}
      <p className="muted studio-note">{UI.white}</p>
      <h5 className="studio-sub">{kind === 'shape' ? UI.shapeLibrary : UI.grainLibrary}</h5>
      <div className="studio-texture-grid">
        {(kind === 'shape' ? SHAPES : GRAINS.filter((g) => g.id !== 'none')).map((t) => {
          const active = !image && (kind === 'shape' ? brush.shape === t.id : brush.grain === t.id)
          return (
            <button
              key={t.id}
              className={`studio-texture-item${active ? ' is-active' : ''}`}
              title={t.label}
              onClick={() => onChange(kind === 'shape' ? { shape: t.id as BrushShape, shapeImage: null } : { grain: t.id as BrushGrain, grainImage: null })}
            >
              <Thumb kind={kind} id={t.id} hardness={brush.hardness} />
              <span>{t.label}</span>
            </button>
          )
        })}
      </div>
      {drawing && (
        <DrawMask
          onCancel={() => setDrawing(false)}
          onDone={(url) => {
            setDrawing(false)
            setImage(url)
          }}
        />
      )}
    </div>
  )
}

function Thumb({ kind, id, hardness }: { kind: 'shape' | 'grain'; id: string; hardness: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const g = c.getContext('2d')!
    g.fillStyle = '#000'
    g.fillRect(0, 0, c.width, c.height)
    if (kind === 'shape') g.drawImage(tipImage(id as BrushShape, hardness), 2, 2, c.width - 4, c.height - 4)
    else {
      const gr = grainCanvas({ grain: id as BrushGrain, grainDepth: 1, grainContrast: 0, grainBrightness: 0, grainInvert: false }, 'gray')
      if (gr) g.drawImage(gr, 0, 0, 96, 96, 0, 0, c.width, c.height)
    }
  }, [kind, id, hardness])
  return <canvas ref={ref} width={44} height={44} />
}

/** The current shape (one stamp) or grain (tiled at the brush's grain scale), white on black. */
function TexturePreview({ kind, brush }: { kind: 'shape' | 'grain'; brush: BrushSettings }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [tick, setTick] = useState(0)
  const image = kind === 'shape' ? brush.shapeImage : brush.grainImage
  useEffect(() => {
    if (image) void loadImageMask(image).then(() => setTick((t) => t + 1))
  }, [image])
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const g = c.getContext('2d')!
    g.fillStyle = '#000'
    g.fillRect(0, 0, c.width, c.height)
    if (kind === 'shape') {
      const tip = brushTip(brush)
      const s = c.height - 16
      g.save()
      g.translate(c.width / 2, c.height / 2)
      g.scale(1, brush.roundness)
      g.drawImage(tip, -s / 2, -s / 2, s, s)
      g.restore()
    } else {
      const gr = grainCanvas(brush, 'gray')
      if (gr) {
        const pat = g.createPattern(gr, 'repeat')!
        pat.setTransform(new DOMMatrix().rotateSelf(brush.grainRotation).scaleSelf(brush.grainScale, brush.grainScale))
        g.fillStyle = pat
        g.fillRect(0, 0, c.width, c.height)
      }
    }
  }, [kind, brush, tick])
  return <canvas ref={ref} width={300} height={130} className="studio-texture-preview" />
}

/** A small canvas to draw a shape or grain by hand. */
function DrawMask({ onDone, onCancel }: { onDone: (url: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [size, setSize] = useState(14)
  useEffect(() => {
    const g = ref.current!.getContext('2d')!
    g.fillStyle = '#000'
    g.fillRect(0, 0, SIDE, SIDE)
  }, [])
  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * SIDE, y: ((e.clientY - r.top) / r.height) * SIDE, p: e.pointerType === 'pen' ? e.pressure : 1 }
  }
  const dot = (a: { x: number; y: number }, b: { x: number; y: number; p: number }) => {
    const g = ref.current!.getContext('2d')!
    g.strokeStyle = '#fff'
    g.lineCap = 'round'
    g.lineWidth = Math.max(1, size * b.p)
    g.beginPath()
    g.moveTo(a.x, a.y)
    g.lineTo(b.x, b.y)
    g.stroke()
  }
  return (
    <div className="studio-draw">
      <span className="muted">{UI.drawHelp}</span>
      <canvas
        ref={ref}
        width={SIDE}
        height={SIDE}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          const p = at(e)
          last.current = p
          dot(p, p)
        }}
        onPointerMove={(e) => {
          if (!last.current) return
          const p = at(e)
          dot(last.current, p)
          last.current = p
        }}
        onPointerUp={() => (last.current = null)}
      />
      <label className="studio-draw-size">
        <input type="range" min={1} max={80} value={size} onChange={(e) => setSize(Number(e.target.value))} /> {size} px
      </label>
      <div className="studio-draw-actions">
        <button
          className="btn btn-ghost"
          onClick={() => {
            const g = ref.current!.getContext('2d')!
            g.fillStyle = '#000'
            g.fillRect(0, 0, SIDE, SIDE)
          }}
        >
          {UI.clearDraw}
        </button>
        <button className="btn" onClick={onCancel}>
          {UI.cancel}
        </button>
        <button className="btn btn-primary" onClick={() => onDone(ref.current!.toDataURL('image/png'))}>
          {UI.use}
        </button>
      </div>
    </div>
  )
}
