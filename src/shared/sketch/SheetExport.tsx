import { useState } from 'react'
import { getFs } from '@/core/fs'
import { safeFileName } from '@/core/export'
import { godotSpriteFrames, sharedBounds, sheetJson, sheetLayout, type SheetOptions } from '@/shared/pixel/sheet'

const UI = {
  title: 'Sprite sheet',
  scale: 'Size',
  layout: 'Layout',
  layouts: { grid: 'Grid', row: 'One row' } as Record<'grid' | 'row', string>,
  trim: 'Trim empty space',
  trimHelp: 'Cuts the see-through border off every frame by the same amount, so the character stays in place.',
  padding: 'Space between frames',
  png: 'PNG + JSON',
  pngHelp: 'A sheet and a JSON file with where every frame is and how long it shows. Unity: slice the PNG by cell size in the Sprite Editor.',
  godot: 'Godot 4',
  godotHelp: 'Saves the sheet and a SpriteFrames .tres into egd/sprites/ of your Godot project: use it in an AnimatedSprite2D.',
  gamemaker: 'GameMaker strip',
  gamemakerHelp: 'One row named name_stripN.png, which GameMaker splits into N frames by itself.',
  saved: (what: string) => `Saved ${what}.`,
  noFrames: 'No frames to export.',
}

/** One animation frame as rendered, and how long it shows. */
export interface SheetFrame {
  canvas: HTMLCanvasElement
  ms: number
}

/** Animation mode → sprite sheet for games (Godot, GameMaker, Unity, anything that reads a sheet and JSON). */
export function SheetExport({ frames, title, onClose }: { frames: () => SheetFrame[]; title: string; onClose(): void }) {
  const [scale, setScale] = useState(0.5)
  const [layout, setLayout] = useState<'grid' | 'row'>('grid')
  const [trim, setTrim] = useState(true)
  const [padding, setPadding] = useState(0)
  const [note, setNote] = useState<string | null>(null)
  const base = safeFileName(title) || 'animation'

  /** The sheet as one canvas, plus the layout data the JSON and .tres describe. */
  const build = (o: SheetOptions) => {
    const list = frames()
    if (!list.length) return null
    const W = list[0].canvas.width
    const H = list[0].canvas.height
    const data = list.map((f) => f.canvas.getContext('2d')!.getImageData(0, 0, W, H).data)
    const box = (trim && sharedBounds(data.map((px) => ({ width: W, height: H, alpha: (x: number, y: number) => px[(y * W + x) * 4 + 3] })))) || { x: 0, y: 0, w: W, h: H }
    const fw = Math.max(1, Math.round(box.w * scale))
    const fh = Math.max(1, Math.round(box.h * scale))
    const doc = { width: fw, height: fh, frames: list.map((f, i) => ({ id: String(i), duration: f.ms })), tags: [] }
    const l = sheetLayout(doc, o)
    const out = document.createElement('canvas')
    out.width = l.width
    out.height = l.height
    const g = out.getContext('2d')!
    g.imageSmoothingQuality = 'high'
    list.forEach((f, i) => g.drawImage(f.canvas, box.x, box.y, box.w, box.h, l.at[i].x, l.at[i].y, fw, fh))
    return { out, doc }
  }
  const png = (c: HTMLCanvasElement) => new Promise<Uint8Array>((ok, fail) => c.toBlob((b) => (b ? b.arrayBuffer().then((a) => ok(new Uint8Array(a))) : fail(new Error('Could not encode PNG'))), 'image/png'))
  const save = async (folderTitle: string, sub: string[], files: [string, Uint8Array][]) => {
    const fs = getFs()
    const folder = await fs.pickFolder(folderTitle)
    if (!folder) return false
    const dir = await fs.join(folder, ...sub)
    await fs.mkdir(dir)
    for (const [name, bytes] of files) await fs.writeBinaryAtomic(await fs.join(dir, name), bytes)
    return true
  }
  const run = async (kind: 'png' | 'godot' | 'gamemaker') => {
    const o: SheetOptions = { layout: kind === 'gamemaker' ? 'row' : layout, padding: kind === 'gamemaker' ? 0 : padding }
    const b = build(o)
    if (!b) return setNote(UI.noFrames)
    const bytes = await png(b.out)
    const enc = (t: string) => new TextEncoder().encode(t)
    if (kind === 'png' && (await save('Choose a folder for the sprite sheet', [], [[`${base}.png`, bytes], [`${base}.json`, enc(JSON.stringify(sheetJson(b.doc, `${base}.png`, o), null, 2))]]))) setNote(UI.saved(`${base}.png and ${base}.json`))
    if (kind === 'godot' && (await save('Choose your Godot project folder', ['egd', 'sprites'], [[`${base}.png`, bytes], [`${base}.tres`, enc(godotSpriteFrames(b.doc, `res://egd/sprites/${base}.png`, o))]]))) setNote(UI.saved(`egd/sprites/${base}.tres`))
    const strip = `${base}_strip${b.doc.frames.length}.png`
    if (kind === 'gamemaker' && (await save('Choose a folder for the GameMaker strip', [], [[strip, bytes]]))) setNote(UI.saved(strip))
  }

  return (
    <div className="sketch-sheet" onPointerDown={(e) => e.stopPropagation()}>
      <strong>{UI.title}</strong>
      <label className="sketch-sheet-row">
        <span>{UI.scale}</span>
        <select className="input" value={scale} onChange={(e) => setScale(Number(e.target.value))}>
          {[1, 0.5, 0.25, 0.125].map((v) => (
            <option key={v} value={v}>
              {v * 100}%
            </option>
          ))}
        </select>
      </label>
      <label className="sketch-sheet-row">
        <span>{UI.layout}</span>
        <select className="input" value={layout} onChange={(e) => setLayout(e.target.value as 'grid' | 'row')}>
          {(['grid', 'row'] as const).map((v) => (
            <option key={v} value={v}>
              {UI.layouts[v]}
            </option>
          ))}
        </select>
      </label>
      <label className="sketch-sheet-row">
        <span>{UI.padding}</span>
        <input className="input" type="number" min={0} max={64} value={padding} onChange={(e) => setPadding(Math.max(0, Math.min(64, Number(e.target.value) || 0)))} />
      </label>
      <label className="sketch-sheet-row" title={UI.trimHelp}>
        <input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} /> <span>{UI.trim}</span>
      </label>
      <div className="sketch-sheet-row">
        <button className="btn" title={UI.godotHelp} onClick={() => void run('godot')}>
          {UI.godot}
        </button>
        <button className="btn" title={UI.pngHelp} onClick={() => void run('png')}>
          {UI.png}
        </button>
        <button className="btn" title={UI.gamemakerHelp} onClick={() => void run('gamemaker')}>
          {UI.gamemaker}
        </button>
        <button className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
      {note && <p className="input-help">{note}</p>}
    </div>
  )
}
