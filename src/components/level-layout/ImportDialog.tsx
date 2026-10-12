import { useEffect, useMemo, useRef, useState } from 'react'
import { NumberInput } from '@/shared/calculators'
import { Modal } from '@/shared/ui'
import { useProjectStore } from '@/core/state'
import { blackToTransparent, loadAssetImage } from './images'
import { grid, guessTileSize } from './model'

export interface ImportValues {
  name: string
  tileSize: number
  margin: number
  spacing: number
  blackTransparent: boolean
}

const PRESETS = [8, 16, 24, 32, 48, 64, 128]

/**
 * v0.15: the tileset import window. Shows the picture with the grid it will be cut into, so a wrong
 * tile size is plain to see, with common sizes and the user's own size, margin and spacing.
 */
export function ImportDialog({ image, title, initial, onDone, onClose }: { image: string; title: string; initial: Partial<ImportValues> & { name: string }; onDone(v: ImportValues & { width: number; height: number }): void; onClose(): void }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [v, setV] = useState<ImportValues>({ tileSize: 16, margin: 0, spacing: 0, blackTransparent: false, ...initial })
  const canvas = useRef<HTMLCanvasElement>(null)

  const root = useProjectStore((s) => s.root)
  useEffect(() => {
    if (!root) return
    void loadAssetImage(root, image).then((i) => {
      setImg(i)
      if (i && !initial.tileSize) setV((x) => ({ ...x, tileSize: guessTileSize(i.naturalWidth, i.naturalHeight) }))
    })
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- once per picture
  }, [root, image])

  const size = useMemo(() => (img ? { width: img.naturalWidth, height: img.naturalHeight } : null), [img])
  const g = useMemo(() => (size ? grid({ ...size, ...v }) : null), [size, v])
  // Whole-number zoom keeps pixel art sharp; big pictures are shown smaller.
  const scale = size ? Math.max(0.25, Math.min(8, Math.floor(Math.min(620 / size.width, 380 / size.height)) || Math.min(620 / size.width, 380 / size.height))) : 1

  useEffect(() => {
    const c = canvas.current
    if (!c || !img || !size || !g) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(size.width * scale * dpr)
    c.height = Math.round(size.height * scale * dpr)
    c.style.width = `${size.width * scale}px`
    const ctx = c.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    ctx.scale(scale * dpr, scale * dpr)
    ctx.drawImage(v.blackTransparent ? blackToTransparent(img) : img, 0, 0)
    ctx.lineWidth = 1 / (scale * dpr)
    ctx.strokeStyle = 'rgba(0, 200, 255, 0.9)'
    for (let row = 0; row < g.rows; row++)
      for (let col = 0; col < g.columns; col++) ctx.strokeRect(v.margin + col * (v.tileSize + v.spacing), v.margin + row * (v.tileSize + v.spacing), v.tileSize, v.tileSize)
    // Pixels no tile covers, on the right and at the bottom.
    ctx.fillStyle = 'rgba(224, 49, 49, 0.45)'
    if (g.restX > 0) ctx.fillRect(size.width - g.restX, 0, g.restX, size.height)
    if (g.restY > 0) ctx.fillRect(0, size.height - g.restY, size.width, g.restY)
  }, [img, size, g, v, scale])

  const set = (patch: Partial<ImportValues>) => setV((x) => ({ ...x, ...patch }))
  const uneven = g && (g.restX > 0 || g.restY > 0)

  return (
    <Modal onClose={onClose}>
      <div className="lv-import">
        <h3>{title}</h3>
        <div className="lv-import-preview">{img ? <canvas ref={canvas} /> : <p className="muted">Loading the picture…</p>}</div>
        <label className="ld-inline">
          Name <input className="input" value={v.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <div className="lv-import-row">
          <span className="muted">Tile size</span>
          {PRESETS.map((p) => (
            <button key={p} className={`btn${v.tileSize === p ? ' btn-primary' : ''}`} onClick={() => set({ tileSize: p })}>
              {p}
            </button>
          ))}
          <label className="ld-inline" title="Your own tile size, in pixels">
            <NumberInput value={v.tileSize} min={2} max={1024} onChange={(n) => set({ tileSize: Math.max(2, Math.round(n)) })} /> px
          </label>
        </div>
        <div className="lv-import-row">
          <label className="ld-inline" title="Empty pixels before the first tile, at the top and on the left">
            Margin <NumberInput value={v.margin} min={0} max={256} onChange={(n) => set({ margin: Math.max(0, Math.round(n)) })} /> px
          </label>
          <label className="ld-inline" title="Empty pixels between two tiles">
            Spacing <NumberInput value={v.spacing} min={0} max={256} onChange={(n) => set({ spacing: Math.max(0, Math.round(n)) })} /> px
          </label>
          <label className="sketch-check">
            <input type="checkbox" checked={v.blackTransparent} onChange={(e) => set({ blackTransparent: e.target.checked })} /> Black is see-through
          </label>
        </div>
        {g && size && (
          <p className={uneven ? 'lv-import-warn' : 'muted'}>
            {g.columns} × {g.rows} tiles from a {size.width} × {size.height} px picture.
            {uneven && ` ${[g.restX > 0 && `${g.restX} px are left over on the right`, g.restY > 0 && `${g.restY} px at the bottom`].filter(Boolean).join(' and ')} (red). Try another tile size, margin or spacing.`}
          </p>
        )}
        <p className="muted lv-import-hint">Pixel art looks blurry? Turn on Sharp pixel art in Settings.</p>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!size} onClick={() => size && onDone({ ...v, name: v.name.trim() || 'Tileset', ...size })}>
            Use these tiles
          </button>
        </div>
      </div>
    </Modal>
  )
}
