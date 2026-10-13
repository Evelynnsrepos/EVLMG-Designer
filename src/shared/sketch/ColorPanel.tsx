import { ArrowLeftRight, Check, Ellipsis, FolderPlus, ImagePlus, LayoutGrid, Maximize2, Minimize2, Plus, Rows3, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { saveBinaryFile, safeFileName } from '@/core/export'
import { promptDialog } from '../dialogs'
import type { ColorDrop } from './colordrop'
import {
  colorName,
  extractPalette,
  harmony,
  HARMONIES,
  hexToHsb,
  hexToRgb,
  hsbToHex,
  discToSquare,
  hsbToRgb,
  parseAco,
  squareToDisc,
  parseAse,
  parseHexInput,
  parseSwatches,
  rgbToHex,
  writeAse,
  writeSwatches,
  type Harmony,
  type HSB,
  type Palette,
} from './color'
import { usePalettes } from './palettes'
import './color.css'
import { viewMatrix, type View } from './view'

const UI = {
  color: 'Colour',
  tabs: { disc: 'Disc', classic: 'Classic', harmony: 'Harmony', value: 'Value', palettes: 'Palettes' },
  primary: 'Main colour. Drag it onto the canvas to fill an area (ColorDrop)',
  secondary: 'Second colour: click to swap',
  swap: 'Swap colours',
  history: 'Recent colours',
  historyEmpty: 'Colours you paint with show up here.',
  choosePalette: 'Palette shown here',
  addToPalette: 'Add the current colour to this palette',
  newPaletteTitle: 'New palette',
  newPaletteName: 'My palette',
  removeHint: 'Right-click to remove it from the palette',
  float: 'Float the colour panel',
  dock: 'Put the colour panel back',
  floating: 'The colour panel is floating over the canvas.',
  harmonies: { complementary: 'Complementary', split: 'Split complementary', analogous: 'Analogous', triadic: 'Triadic', tetradic: 'Tetradic' } as Record<Harmony, string>,
  brightness: 'Brightness',
  hue: 'Hue',
  saturation: 'Saturation',
  hex: 'Hex',
  newPalette: 'New palette',
  fromImage: 'New palette from an image',
  importFile: 'Import palettes (.swatches, .ase, .aco)',
  compact: 'Compact view',
  cards: 'Card view',
  addColor: 'Add the colour',
  setDefault: 'Use as the default palette',
  isDefault: 'Default palette',
  rename: 'Rename',
  exportAse: 'Export as .ase',
  exportSwatches: 'Export as .swatches',
  remove: 'Delete palette',
  removeColor: 'Right-click to remove',
  paletteName: 'Palette name',
  untitled: 'Palette',
  importFailed: (n: string) => `Could not read ${n}.`,
  canvasColors: 'Canvas colours',
  srgb: 'sRGB',
  p3: 'Display P3 (wider colours)',
  p3Missing: 'Display P3 is not supported here',
  dropBar: 'Click to keep filling',
  recolor: 'Recolor: click a colour on the layer to swap it for this one',
  threshold: 'Threshold',
  doneFilling: 'Stop filling',
}

type Tab = keyof typeof UI.tabs

export interface ColorPanelProps {
  color: string
  setColor(c: string): void
  /** Extra colours from the host tool (shown above the palettes). */
  swatches: string[]
  /** Drag the colour onto the canvas (Draw only). */
  drop?: ColorDrop
  /** Canvas colour space (Draw only); without it the choice is hidden. */
  colorSpace?: 'srgb' | 'display-p3'
  onColorSpace?(cs: 'srgb' | 'display-p3'): void
}

const p3Supported = (() => {
  try {
    const c = document.createElement('canvas').getContext('2d', { colorSpace: 'display-p3' })
    return c?.getContextAttributes?.().colorSpace === 'display-p3'
  } catch {
    return false
  }
})()

/** The colour panel (Sketch Pro): disc, classic, harmony, value and palettes; main and second colour, history, floating. */
export function ColorPanel(p: ColorPanelProps) {
  const pal = usePalettes()
  const [tab, setTab] = useState<Tab>('disc')
  const [floating, setFloating] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    void usePalettes.getState().load()
  }, [])
  // A colour that stays picked for a moment goes into the history.
  useEffect(() => {
    const t = setTimeout(() => usePalettes.getState().used(p.color), 1200)
    return () => clearTimeout(t)
  }, [p.color])

  const body = (
    <>
      <div className="cp-head">
        <span className="cp-pair">
          <button
            className="cp-secondary"
            style={{ background: pal.secondary }}
            title={UI.secondary}
            onClick={() => {
              const s = pal.secondary
              pal.setSecondary(p.color)
              p.setColor(s)
            }}
          />
          <button className="cp-primary" style={{ background: p.color }} title={UI.primary} onPointerDown={(e) => p.drop?.begin(p.color, e)} />
        </span>
        <span className="cp-name" title={p.color}>
          {colorName(p.color)}
        </span>
        <button
          className="icon-btn"
          title={UI.swap}
          onClick={() => {
            const s = pal.secondary
            pal.setSecondary(p.color)
            p.setColor(s)
          }}
        >
          <ArrowLeftRight size={13} />
        </button>
        <button className="icon-btn" title={floating ? UI.dock : UI.float} onClick={() => setFloating(floating ? null : { x: window.innerWidth - 600, y: 120 })}>
          {floating ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
      </div>
      <div className="cp-tabs">
        {(Object.keys(UI.tabs) as Tab[]).map((t) => (
          <button key={t} className={`cp-tab${tab === t ? ' is-active' : ''}`} onClick={() => setTab(t)}>
            {UI.tabs[t]}
          </button>
        ))}
      </div>
      {tab === 'disc' && <Disc color={p.color} setColor={p.setColor} />}
      {tab === 'classic' && <Classic color={p.color} setColor={p.setColor} />}
      {tab === 'harmony' && <HarmonyView color={p.color} setColor={p.setColor} />}
      {tab === 'value' && <Values color={p.color} setColor={p.setColor} />}
      {tab === 'palettes' && <Palettes color={p.color} setColor={p.setColor} />}
      <div className="cp-label">{UI.history}</div>
      <div className="cp-row">
        {pal.history.length ? (
          pal.history.map((h) => (
            <button key={h} className={`sketch-swatch${h === p.color ? ' is-active' : ''}`} style={{ background: h }} title={`${colorName(h)} ${h}`} onClick={() => p.setColor(h)} />
          ))
        ) : (
          <span className="muted cp-empty">{UI.historyEmpty}</span>
        )}
      </div>
      {tab !== 'palettes' && <QuickPalette color={p.color} setColor={p.setColor} extra={p.swatches} />}
      {p.onColorSpace && (
      <label className="sketch-row cp-space">
        <span>{UI.canvasColors}</span>
        <select className="input" value={p.colorSpace} disabled={!p3Supported && p.colorSpace === 'srgb'} title={p3Supported ? undefined : UI.p3Missing} onChange={(e) => p.onColorSpace?.(e.target.value as 'srgb' | 'display-p3')}>
          <option value="srgb">{UI.srgb}</option>
          <option value="display-p3">{UI.p3}</option>
        </select>
      </label>
      )}
    </>
  )

  if (floating)
    return (
      <section>
        <h4>{UI.color}</h4>
        <p className="muted cp-note">{UI.floating}</p>
        <FloatingWindow at={floating} onMove={setFloating}>
          {body}
        </FloatingWindow>
      </section>
    )
  return (
    <section>
      <h4>{UI.color}</h4>
      {body}
    </section>
  )
}

function FloatingWindow({ at, onMove, children }: { at: { x: number; y: number }; onMove(p: { x: number; y: number }): void; children: ReactNode }) {
  const drag = (e: React.PointerEvent) => {
    e.preventDefault()
    const sx = e.clientX - at.x
    const sy = e.clientY - at.y
    const move = (ev: PointerEvent) => onMove({ x: Math.max(0, Math.min(window.innerWidth - 80, ev.clientX - sx)), y: Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - sy)) })
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div className="cp-float" style={{ left: at.x, top: at.y }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="cp-float-bar" onPointerDown={drag} />
      {children}
    </div>
  )
}

/** Drag on an element; `fn` gets the pointer position as 0..1 of its box. */
function usePad(fn: (x: number, y: number, box: DOMRect) => void) {
  return (e: React.PointerEvent<HTMLElement>) => {
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const at = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect()
      fn(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)), r)
    }
    at(e)
    const move = (ev: PointerEvent) => at(ev)
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
}

/** Keeps hue and saturation while they are undefined in the colour itself (greys, black). */
function useHsb(color: string): [HSB, (hsb: HSB) => string] {
  const [kept, setKept] = useState<HSB>(() => hexToHsb(color))
  const now = hexToHsb(color)
  const same = hsbToHex(kept) === color
  const hsb: HSB = same ? kept : now
  const set = (next: HSB) => {
    setKept(next)
    return hsbToHex(next)
  }
  return [hsb, set]
}

type PickerProps = { color: string; setColor(c: string): void }

function Disc({ color, setColor }: PickerProps) {
  const [hsb, keep] = useHsb(color)
  const [h, s, b] = hsb
  const ring = usePad((x, y) => setColor(keep([((Math.atan2(x - 0.5, 0.5 - y) * 180) / Math.PI + 360) % 360, s || 1, b || 1])))
  // The inner circle is a real disc: its edge is the square's edge, so every colour can be reached and moved (v0.13).
  const inner = usePad((x, y) => {
    const q = discToSquare(x * 2 - 1, y * 2 - 1)
    setColor(keep([h, (q.u + 1) / 2, (1 - q.v) / 2]))
  })
  const dot = squareToDisc(s * 2 - 1, (1 - b) * 2 - 1)
  const a = (h * Math.PI) / 180
  return (
    <div className="cp-disc">
      <div className="cp-ring" onPointerDown={(e) => (e.target === e.currentTarget ? ring(e) : undefined)}>
        <span className="cp-ring-dot" style={{ left: `${50 + 45 * Math.sin(a)}%`, top: `${50 - 45 * Math.cos(a)}%`, background: hsbToHex([h, 1, 1]) }} />
        <div className="cp-disc-inner" onPointerDown={inner}>
          <DiscShade hue={h} />
          <span className="cp-dot" style={{ left: `${(dot.x + 1) * 50}%`, top: `${(dot.y + 1) * 50}%`, background: color }} />
        </div>
      </div>
    </div>
  )
}

/** The saturation/brightness disc for one hue, painted through the same mapping the pointer uses. */
function DiscShade({ hue }: { hue: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current?.getContext('2d')
    if (!c) return
    const n = c.canvas.width
    const img = c.createImageData(n, n)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const q = discToSquare(((x + 0.5) / n) * 2 - 1, ((y + 0.5) / n) * 2 - 1)
        const [r, g, b] = hsbToRgb([hue, (q.u + 1) / 2, (1 - q.v) / 2])
        const i = (y * n + x) * 4
        img.data[i] = r
        img.data[i + 1] = g
        img.data[i + 2] = b
        img.data[i + 3] = 255
      }
    c.putImageData(img, 0, 0)
  }, [hue])
  return <canvas ref={ref} width={146} height={146} className="cp-disc-shade" />
}

function Classic({ color, setColor }: PickerProps) {
  const [hsb, keep] = useHsb(color)
  const [h, s, b] = hsb
  const square = usePad((x, y) => setColor(keep([h, x, 1 - y])))
  const hue = usePad((x) => setColor(keep([x * 360, s, b])))
  return (
    <div className="cp-classic">
      <div className="cp-square" style={{ ['--hue' as string]: hsbToHex([h, 1, 1]) }} onPointerDown={square}>
        <span className="cp-dot" style={{ left: `${s * 100}%`, top: `${(1 - b) * 100}%`, background: color }} />
      </div>
      <div className="cp-hue" onPointerDown={hue}>
        <span className="cp-bar-dot" style={{ left: `${(h / 360) * 100}%` }} />
      </div>
    </div>
  )
}

function HarmonyView({ color, setColor }: PickerProps) {
  const [scheme, setScheme] = useState<Harmony>('complementary')
  const [hsb, keep] = useHsb(color)
  const [h, s, b] = hsb
  const wheel = usePad((x, y) => {
    const dx = x - 0.5
    const dy = y - 0.5
    setColor(keep([((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360, Math.min(1, Math.hypot(dx, dy) * 2), b]))
  })
  const bright = usePad((x) => setColor(keep([h, s, x])))
  const colors = harmony(color, scheme)
  return (
    <div className="cp-harmony">
      <select className="input" value={scheme} onChange={(e) => setScheme(e.target.value as Harmony)}>
        {HARMONIES.map((k) => (
          <option key={k} value={k}>
            {UI.harmonies[k]}
          </option>
        ))}
      </select>
      <div className="cp-wheel" style={{ ['--dim' as string]: String(1 - b) }} onPointerDown={wheel}>
        {colors.map((c, i) => {
          const [ch, cs] = i ? hexToHsb(c) : [h, s]
          const a = (ch * Math.PI) / 180
          return <span key={i} className={`cp-dot${i ? ' is-partner' : ''}`} style={{ left: `${50 + 50 * cs * Math.sin(a)}%`, top: `${50 - 50 * cs * Math.cos(a)}%`, background: c }} />
        })}
      </div>
      <div className="cp-bright" style={{ ['--hue' as string]: hsbToHex([h, s, 1]) }} onPointerDown={bright} title={UI.brightness}>
        <span className="cp-bar-dot" style={{ left: `${b * 100}%` }} />
      </div>
      <div className="cp-row">
        {colors.map((c, i) => (
          <button key={i} className={`cp-big-swatch${c === color ? ' is-active' : ''}`} style={{ background: c }} title={`${colorName(c)} ${c}`} onClick={() => setColor(c)} />
        ))}
      </div>
    </div>
  )
}

function Values({ color, setColor }: PickerProps) {
  const [hsb, keep] = useHsb(color)
  const rgb = hexToRgb(color)
  // What is typed in the hex field until it is left.
  const [draft, setDraft] = useState<string | null>(null)
  const row = (label: string, value: number, max: number, set: (v: number) => void) => (
    <label className="cp-value" key={label}>
      <span>{label}</span>
      <input type="range" min={0} max={max} value={Math.round(value)} onChange={(e) => set(Number(e.target.value))} />
      <input className="input" type="number" min={0} max={max} value={Math.round(value)} onChange={(e) => set(Math.min(max, Math.max(0, Number(e.target.value) || 0)))} />
    </label>
  )
  return (
    <div className="cp-values">
      {row('H', hsb[0], 359, (v) => setColor(keep([v, hsb[1], hsb[2]])))}
      {row('S', hsb[1] * 100, 100, (v) => setColor(keep([hsb[0], v / 100, hsb[2]])))}
      {row('B', hsb[2] * 100, 100, (v) => setColor(keep([hsb[0], hsb[1], v / 100])))}
      {row('R', rgb[0], 255, (v) => setColor(rgbToHex([v, rgb[1], rgb[2]])))}
      {row('G', rgb[1], 255, (v) => setColor(rgbToHex([rgb[0], v, rgb[2]])))}
      {row('B ', rgb[2], 255, (v) => setColor(rgbToHex([rgb[0], rgb[1], v])))}
      <label className="cp-value">
        <span>{UI.hex}</span>
        <input
          className="input cp-hex"
          value={draft ?? color}
          onBlur={() => setDraft(null)}
          onChange={(e) => {
            setDraft(e.target.value)
            const ok = parseHexInput(e.target.value)
            if (ok) setColor(ok)
          }}
        />
        <span className="cp-name">{colorName(color)}</span>
      </label>
    </div>
  )
}

/** The palette under the wheel: pick a palette, add the current colour with +, make a new one. Right-click a colour to remove it. */
function QuickPalette({ color, setColor, extra }: { color: string; setColor(c: string): void; extra: string[] }) {
  const pal = usePalettes()
  const palette = pal.palettes.find((x) => x.id === pal.defaultId) ?? pal.palettes[0]
  const addHere = () => {
    if (!palette) {
      pal.setDefault(pal.add(UI.newPaletteName, [{ hex: color }]))
      return
    }
    if (!palette.colors.some((c) => c.hex.toLowerCase() === color.toLowerCase())) pal.update(palette.id, { colors: [...palette.colors, { hex: color }] })
  }
  const newPalette = async () => {
    const name = (await promptDialog(UI.newPaletteTitle, UI.newPaletteName))?.trim()
    if (name) pal.setDefault(pal.add(name, [{ hex: color }]))
  }
  return (
    <>
      <div className="cp-label cp-palette-head">
        <select className="input" value={palette?.id ?? ''} onChange={(e) => pal.setDefault(e.target.value)} title={UI.choosePalette}>
          {pal.palettes.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <button className="icon-btn" title={UI.addToPalette} onClick={addHere}>
          <Plus size={14} />
        </button>
        <button className="icon-btn" title={UI.newPaletteTitle} onClick={() => void newPalette()}>
          <FolderPlus size={14} />
        </button>
      </div>
      <div className="cp-row">
        {[...new Set([...(palette?.colors.map((c) => c.hex) ?? []), ...extra])].map((h) => (
          <button
            key={h}
            className={`sketch-swatch${h === color ? ' is-active' : ''}`}
            style={{ background: h }}
            title={`${colorName(h)} ${h}. ${UI.removeHint}`}
            onClick={() => setColor(h)}
            onContextMenu={(e) => {
              e.preventDefault()
              if (palette) pal.update(palette.id, { colors: palette.colors.filter((c) => c.hex !== h) })
            }}
          />
        ))}
      </div>
    </>
  )
}

/** Read palette files the user picked. */
async function importFiles(files: FileList): Promise<{ palettes: Omit<Palette, 'id'>[]; failed: string[] }> {
  const palettes: Omit<Palette, 'id'>[] = []
  const failed: string[] = []
  for (const f of files) {
    const base = f.name.replace(/\.[^.]+$/, '')
    try {
      const buf = await f.arrayBuffer()
      const ext = f.name.toLowerCase().split('.').pop()
      if (ext === 'swatches') palettes.push(...parseSwatches(new Uint8Array(buf), base))
      else if (ext === 'ase') palettes.push(parseAse(buf, base))
      else if (ext === 'aco') palettes.push(parseAco(buf, base))
      else failed.push(f.name)
    } catch {
      failed.push(f.name)
    }
  }
  return { palettes, failed }
}

function Palettes({ color, setColor }: PickerProps) {
  const pal = usePalettes()
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const fromImage = async (f: File) => {
    const bmp = await createImageBitmap(f)
    const s = Math.min(1, 256 / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(bmp.width * s))
    c.height = Math.max(1, Math.round(bmp.height * s))
    const ctx = c.getContext('2d')!
    ctx.drawImage(bmp, 0, 0, c.width, c.height)
    const colors = extractPalette(ctx.getImageData(0, 0, c.width, c.height).data, 12)
    pal.add(f.name.replace(/\.[^.]+$/, ''), colors.map((hex) => ({ hex, name: colorName(hex) })))
  }

  const exportAs = async (p: Palette, kind: 'ase' | 'swatches') => {
    await saveBinaryFile({
      title: kind === 'ase' ? UI.exportAse : UI.exportSwatches,
      defaultName: `${safeFileName(p.name)}.${kind}`,
      bytes: kind === 'ase' ? writeAse(p) : writeSwatches(p),
      filter: { name: kind === 'ase' ? 'Adobe swatch exchange' : 'Swatches', extensions: [kind] },
    })
  }

  const shown = menu && pal.palettes.find((p) => p.id === menu.id)
  return (
    <div className="cp-palettes">
      <div className="cp-palette-tools">
        <button className="icon-btn" title={UI.newPalette} onClick={() => void promptDialog(UI.paletteName, UI.untitled).then((n) => n?.trim() && pal.add(n.trim(), [{ hex: color, name: colorName(color) }]))}>
          <Plus size={14} />
        </button>
        <button className="icon-btn" title={UI.fromImage} onClick={() => imageInput.current?.click()}>
          <ImagePlus size={14} />
        </button>
        <button className="icon-btn" title={UI.importFile} onClick={() => fileInput.current?.click()}>
          <Upload size={14} />
        </button>
        <span className="sketch-spacer" />
        <button className={`icon-btn${pal.view === 'compact' ? ' is-active' : ''}`} title={UI.compact} onClick={() => pal.setView('compact')}>
          <Rows3 size={14} />
        </button>
        <button className={`icon-btn${pal.view === 'cards' ? ' is-active' : ''}`} title={UI.cards} onClick={() => pal.setView('cards')}>
          <LayoutGrid size={14} />
        </button>
        <input ref={imageInput} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && void fromImage(e.target.files[0]).finally(() => (e.target.value = ''))} />
        <input
          ref={fileInput}
          type="file"
          accept=".swatches,.ase,.aco"
          multiple
          hidden
          onChange={(e) => {
            const files = e.target.files
            if (!files) return
            void importFiles(files).then(({ palettes, failed }) => {
              for (const p of palettes) pal.add(p.name, p.colors)
              setNote(failed.length ? UI.importFailed(failed.join(', ')) : null)
              e.target.value = ''
            })
          }}
        />
      </div>
      {note && <p className="cp-note">{note}</p>}
      {pal.palettes.map((p) => (
        <div key={p.id} className="cp-palette">
          <div className="cp-palette-head">
            <span className="cp-palette-name">{p.name}</span>
            {p.id === pal.defaultId && <Check size={12} aria-label={UI.isDefault} />}
            <button className="icon-btn" title={UI.addColor} onClick={() => pal.update(p.id, { colors: [...p.colors, { hex: color, name: colorName(color) }] })}>
              <Plus size={12} />
            </button>
            <button
              className="icon-btn"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                setMenu({ id: p.id, x: Math.max(8, r.right - 200), y: r.bottom + 2 })
              }}
            >
              <Ellipsis size={13} />
            </button>
          </div>
          <div className={pal.view === 'cards' ? 'cp-cards' : 'cp-row'}>
            {p.colors.map((c, i) => (
              <button
                key={`${c.hex}${i}`}
                className={pal.view === 'cards' ? `cp-card${c.hex === color ? ' is-active' : ''}` : `sketch-swatch${c.hex === color ? ' is-active' : ''}`}
                style={pal.view === 'cards' ? undefined : { background: c.hex }}
                title={`${c.name ?? colorName(c.hex)} ${c.hex}. ${UI.removeColor}`}
                onClick={() => setColor(c.hex)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  pal.update(p.id, { colors: p.colors.filter((_, j) => j !== i) })
                }}
              >
                {pal.view === 'cards' && (
                  <>
                    <span className="cp-card-color" style={{ background: c.hex }} />
                    <span className="cp-card-name">{c.name ?? colorName(c.hex)}</span>
                  </>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
      {shown && (
        <>
          <div className="menu-backdrop" onClick={() => setMenu(null)} />
          <div className="menu" style={{ position: 'fixed', left: menu.x, top: menu.y }}>
            <button onClick={() => (setMenu(null), pal.setDefault(shown.id))}>{UI.setDefault}</button>
            <button onClick={() => (setMenu(null), void promptDialog(UI.rename, shown.name).then((n) => n?.trim() && pal.update(shown.id, { name: n.trim() })))}>{UI.rename}</button>
            <button onClick={() => (setMenu(null), void exportAs(shown, 'swatches'))}>{UI.exportSwatches}</button>
            <button onClick={() => (setMenu(null), void exportAs(shown, 'ase'))}>{UI.exportAse}</button>
            <button className="danger" onClick={() => (setMenu(null), pal.remove(shown.id))}>
              {UI.remove}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/** The chip under the pointer while dragging a colour, and the live fill preview. */
export function ColorDropView({ drop, view }: { drop: ColorDrop; view: View | null }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const pv = drop.preview
  useEffect(() => {
    const c = ref.current
    if (!c || !pv) return
    const s = Math.min(1, 1024 / Math.max(pv.width, pv.height))
    c.width = Math.round(pv.width * s)
    c.height = Math.round(pv.height * s)
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.drawImage(pv, 0, 0, c.width, c.height)
  }, [pv, drop.version])
  return (
    <>
      {pv && view && (
        <canvas ref={ref} className="sketch-sel-mask" style={{ left: 0, top: 0, width: pv.width, height: pv.height, transformOrigin: '0 0', transform: `matrix(${viewMatrix(view).join(',')})` }} />
      )}
      {drop.dragging && (
        <span className="cp-drag-chip" style={{ left: drop.dragging.x, top: drop.dragging.y, background: drop.dragging.color }}>
          {pv && <span className="cp-drag-threshold">{Math.round(drop.threshold * 100)}%</span>}
        </span>
      )}
    </>
  )
}

/** The bar after a ColorDrop: keep filling with clicks, Recolor, threshold. */
export function ColorDropBar({ drop, color }: { drop: ColorDrop; color: string }) {
  if (!drop.continuing && !drop.recolor) return null
  return (
    <div className="sketch-selbar" onPointerDown={(e) => e.stopPropagation()}>
      <span className="cp-bar-swatch" style={{ background: drop.recolor ? color : (drop.continuing ?? color) }} />
      <span>{UI.dropBar}</span>
      <button className={`btn btn-ghost sketch-small${drop.recolor ? ' is-active' : ''}`} title={UI.recolor} onClick={() => drop.patch({ recolor: !drop.recolor, continuing: drop.continuing ?? color })}>
        Recolor
      </button>
      <label className="sketch-selbar-slider">
        {UI.threshold}
        <input type="range" min={0} max={1} step={0.01} value={drop.threshold} onChange={(e) => drop.patch({ threshold: Number(e.target.value) })} />
        <span>{Math.round(drop.threshold * 100)}%</span>
      </label>
      <button className="btn btn-ghost sketch-small" title={UI.doneFilling} onClick={() => drop.stop()}>
        <X size={13} />
      </button>
    </div>
  )
}
