import { useEffect, useRef, useState } from 'react'
import { localized } from '../i18n'
import { Modal } from '../ui'
import { defaultOutline, MAX_OUTLINE, outlineCpu, type OutlineSettings } from './outline'

const UI = localized(
  {
    layerTitle: 'Outline layer',
    layerIntro: 'Everything on this layer (or in this group) gets an outline that follows as you draw, erase or add pictures. Crossing strokes share one outline. Your drawing itself is never changed, and the canvas shows each change right away. For a fixed outline on a layer of its own, use the Outliner in the toolbar.',
    toolTitle: 'Outliner',
    toolIntro: 'Draws an outline around the selection or the drawing on this layer, onto a new layer. Your drawing is not changed. For an outline that keeps following as you draw, use an Outline layer (Layers panel).',
    presets: 'Quick looks',
    size: 'Size',
    color: 'Colour',
    gradient: 'Fade to',
    opacity: 'Opacity',
    second: 'Second line',
    secondSize: 'Second size',
    secondColor: 'Second line colour',
    where: 'Where',
    wheres: { outside: 'Outside', center: 'On the edge', inside: 'Inside' } as Record<OutlineSettings['where'], string>,
    sharpness: 'Sharpness',
    roundness: 'Roundness',
    source: 'Outline',
    sources: { selection: 'The selection', drawing: 'The drawing on this layer' },
    ok: 'OK',
    apply: 'Draw outline',
    cancel: 'Cancel',
    off: 'Turn outline off',
    rasterize: 'Paint it in',
    rasterizeHint: 'Paint the outline into the layer: it becomes a normal layer again (Rasterize)',
  },
  {
    layerTitle: 'Umriss-Ebene',
    layerIntro: 'Alles auf dieser Ebene (oder in dieser Gruppe) bekommt einen Umriss, der mitgeht, wenn du malst, radierst oder Bilder einfügst. Sich kreuzende Striche teilen sich einen Umriss. Deine Zeichnung selbst bleibt unverändert, und die Leinwand zeigt jede Änderung sofort. Für einen festen Umriss auf einer eigenen Ebene nimm den Umrisser in der Werkzeugleiste.',
    toolTitle: 'Umrisser',
    toolIntro: 'Zeichnet einen Umriss um die Auswahl oder die Zeichnung auf dieser Ebene, auf eine neue Ebene. Deine Zeichnung bleibt unverändert. Für einen Umriss, der beim Weitermalen mitgeht, nimm eine Umriss-Ebene (Ebenen-Leiste).',
    presets: 'Schnelle Looks',
    size: 'Größe',
    color: 'Farbe',
    gradient: 'Übergang zu',
    opacity: 'Deckkraft',
    second: 'Zweite Linie',
    secondSize: 'Zweite Größe',
    secondColor: 'Farbe der zweiten Linie',
    where: 'Wo',
    wheres: { outside: 'Außen', center: 'Auf der Kante', inside: 'Innen' },
    sharpness: 'Schärfe',
    roundness: 'Rundung',
    source: 'Umriss um',
    sources: { selection: 'Die Auswahl', drawing: 'Die Zeichnung auf dieser Ebene' },
    ok: 'OK',
    apply: 'Umriss zeichnen',
    cancel: 'Abbrechen',
    off: 'Umriss ausschalten',
    rasterize: 'Einmalen',
    rasterizeHint: 'Den Umriss in die Ebene malen: sie wird wieder eine normale Ebene (Rastern)',
  },
)

const PRESETS: { name: string; o: Partial<OutlineSettings> }[] = [
  { name: 'Sticker', o: { size: 14, color: '#ffffff', color2: null, where: 'outside', sharpness: 1, roundness: 1, second: { size: 3, color: '#111111' } } },
  { name: 'Comic', o: { size: 5, color: '#111111', color2: null, where: 'outside', sharpness: 1, roundness: 1 } },
  { name: 'Glow', o: { size: 24, color: '#ffe066', color2: '#ff3fa0', where: 'outside', sharpness: 0, roundness: 1 } },
  { name: 'Pixel', o: { size: 1, color: '#111111', color2: null, where: 'outside', sharpness: 1, roundness: 0 } },
  { name: 'Inner line', o: { size: 4, color: '#111111', color2: null, where: 'inside', sharpness: 1, roundness: 1 } },
]

/** The settings of an outline with a live preview on a bit of text and a circle; used by the Outline layer and the Outliner. */
export function OutlineDialog({
  initial,
  mode,
  hasSelection = false,
  onOk,
  onClose,
  onOff,
  onRasterize,
  onChange,
}: {
  initial?: OutlineSettings
  mode: 'layer' | 'tool'
  hasSelection?: boolean
  onOk: (o: OutlineSettings, source: 'selection' | 'drawing') => void
  onClose: () => void
  onOff?: () => void
  onRasterize?: () => void
  /** Every change while the dialog is open, so the canvas can show it right away. */
  onChange?: (o: OutlineSettings, source: 'selection' | 'drawing') => void
}) {
  const [o, setO] = useState<OutlineSettings>(initial ?? lastUsed ?? defaultOutline())
  const [source, setSource] = useState<'selection' | 'drawing'>(hasSelection ? 'selection' : 'drawing')
  const set = (p: Partial<OutlineSettings>) => {
    const next = { ...o, ...p }
    setO(next)
    onChange?.(next, source)
  }
  const pick = (s: 'selection' | 'drawing') => {
    setSource(s)
    onChange?.(o, s)
  }
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const g = c.getContext('2d', { willReadFrequently: true })!
    g.clearRect(0, 0, c.width, c.height)
    g.fillStyle = '#e8a040'
    g.font = 'bold 76px sans-serif'
    g.textBaseline = 'middle'
    g.fillText('Aa', 34, c.height / 2 + 4)
    g.beginPath()
    g.arc(c.width - 70, c.height / 2, 34, 0, Math.PI * 2)
    g.fill()
    g.putImageData(outlineCpu(g.getImageData(0, 0, c.width, c.height), o), 0, 0)
  }, [o])
  const ok = () => {
    lastUsed = o
    onOk(o, source)
  }
  const slider = (label: string, value: number, min: number, max: number, step: number, show: string, on: (v: number) => void) => (
    <label className="sketch-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => on(Number(e.target.value))} />
      <span className="sketch-slider-value">{show}</span>
    </label>
  )
  return (
    <Modal onClose={onClose}>
      <div className="sketch-outline-dialog">
        <h3>{mode === 'layer' ? UI.layerTitle : UI.toolTitle}</h3>
        <p className="sketch-outline-intro">{mode === 'layer' ? UI.layerIntro : UI.toolIntro}</p>
        <canvas ref={ref} width={300} height={130} className="sketch-outline-preview" />
        <div className="sketch-outline-presets" aria-label={UI.presets}>
          {PRESETS.map((p) => (
            <button key={p.name} className="btn btn-ghost sketch-small" onClick={() => set({ second: null, opacity: 1, ...p.o })}>
              {p.name}
            </button>
          ))}
        </div>
        {slider(UI.size, o.size, 1, MAX_OUTLINE, 1, `${o.size} px`, (size) => set({ size }))}
        <div className="sketch-outline-row">
          <span>{UI.color}</span>
          <input type="color" value={o.color} onChange={(e) => set({ color: e.target.value })} aria-label={UI.color} />
          <label>
            <input type="checkbox" checked={!!o.color2} onChange={(e) => set({ color2: e.target.checked ? '#ffffff' : null })} /> {UI.gradient}
          </label>
          {o.color2 && <input type="color" value={o.color2} onChange={(e) => set({ color2: e.target.value })} aria-label={UI.gradient} />}
        </div>
        {slider(UI.opacity, o.opacity ?? 1, 0, 1, 0.01, `${Math.round((o.opacity ?? 1) * 100)}%`, (opacity) => set({ opacity }))}
        <div className="sketch-outline-row">
          <label>
            <input type="checkbox" checked={!!o.second} onChange={(e) => set({ second: e.target.checked ? { size: Math.max(2, Math.round(o.size / 3)), color: o.color === '#ffffff' ? '#111111' : '#ffffff' } : null })} /> {UI.second}
          </label>
          {o.second && <input type="color" value={o.second.color} onChange={(e) => set({ second: { ...o.second!, color: e.target.value } })} aria-label={UI.secondColor} />}
        </div>
        {o.second && slider(UI.secondSize, o.second.size, 1, MAX_OUTLINE, 1, `${o.second.size} px`, (size) => set({ second: { ...o.second!, size } }))}
        <div className="sketch-outline-row" role="radiogroup" aria-label={UI.where}>
          <span>{UI.where}</span>
          {(['outside', 'center', 'inside'] as const).map((w) => (
            <button key={w} role="radio" aria-checked={o.where === w} className={`btn btn-ghost sketch-small${o.where === w ? ' is-active' : ''}`} onClick={() => set({ where: w })}>
              {UI.wheres[w]}
            </button>
          ))}
        </div>
        {slider(UI.sharpness, o.sharpness, 0, 1, 0.01, `${Math.round(o.sharpness * 100)}%`, (sharpness) => set({ sharpness }))}
        {slider(UI.roundness, o.roundness, 0, 1, 0.01, `${Math.round(o.roundness * 100)}%`, (roundness) => set({ roundness }))}
        {mode === 'tool' && hasSelection && (
          <div className="sketch-outline-row" role="radiogroup" aria-label={UI.source}>
            <span>{UI.source}</span>
            {(['selection', 'drawing'] as const).map((s) => (
              <button key={s} role="radio" aria-checked={source === s} className={`btn btn-ghost sketch-small${source === s ? ' is-active' : ''}`} onClick={() => pick(s)}>
                {UI.sources[s]}
              </button>
            ))}
          </div>
        )}
        <div className="modal-actions">
          {onOff && (
            <button className="btn" onClick={onOff}>
              {UI.off}
            </button>
          )}
          {onRasterize && (
            <button className="btn" title={UI.rasterizeHint} onClick={onRasterize}>
              {UI.rasterize}
            </button>
          )}
          <span className="sketch-spacer" />
          <button className="btn" onClick={onClose}>
            {UI.cancel}
          </button>
          <button className="btn btn-primary" onClick={ok} autoFocus>
            {mode === 'layer' ? UI.ok : UI.apply}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** The last settings picked, so the next outline starts from them. */
let lastUsed: OutlineSettings | null = null
