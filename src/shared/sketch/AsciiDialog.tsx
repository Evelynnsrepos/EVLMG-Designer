import { X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { localized } from '../i18n'
import { Modal } from '../ui'
import { FilterControls } from './adjust/AdjustStudio'
import { defaultValues, type AdjustValues } from './adjust/filters'
import { loadAsciiFont, renderAscii } from './ascii'
import { ASCII_FORMATS, type AsciiFormat } from './asciiExport'

const UI = localized(
  {
    newTitle: 'ASCII layer',
    editTitle: 'ASCII layer',
    intro: 'Everything on this layer is shown as letters, while you paint with any brush. Your paint is kept, so you can change the letters any time.',
    looks: 'Quick looks',
    yourLooks: 'Your looks',
    saveLook: 'Save this look',
    saveLookHint: 'Keep these settings as a look of your own, for every drawing',
    lookName: (n: number) => `My look ${n}`,
    removeLook: 'Remove this look',
    start: 'Start with',
    starts: { empty: 'An empty layer to paint on', layer: 'A copy of this layer', picture: 'The whole picture' },
    export: 'Export',
    exported: 'Copied',
    ok: 'OK',
    cancel: 'Cancel',
    off: 'Turn letters off',
    offHint: 'Show the paint again (a normal layer)',
    rasterize: 'Rasterize',
    rasterizeHint: 'Paint the letters into the layer: it becomes a normal layer again',
    looksNames: {} as Record<string, string>,
  },
  {
    newTitle: 'ASCII-Ebene',
    editTitle: 'ASCII-Ebene',
    intro: 'Alles auf dieser Ebene wird als Zeichen gezeigt, während du mit jedem Pinsel malst. Deine Farbe bleibt erhalten, du kannst die Zeichen also jederzeit ändern.',
    looks: 'Schnelle Looks',
    yourLooks: 'Deine Looks',
    saveLook: 'Diesen Look speichern',
    saveLookHint: 'Diese Einstellungen als eigenen Look behalten, für jede Zeichnung',
    lookName: (n: number) => `Mein Look ${n}`,
    removeLook: 'Diesen Look entfernen',
    start: 'Beginnen mit',
    starts: { empty: 'Einer leeren Ebene zum Malen', layer: 'Einer Kopie dieser Ebene', picture: 'Dem ganzen Bild' },
    export: 'Exportieren',
    exported: 'Kopiert',
    ok: 'OK',
    cancel: 'Abbrechen',
    off: 'Zeichen ausschalten',
    offHint: 'Die Farbe wieder zeigen (eine normale Ebene)',
    rasterize: 'Rastern',
    rasterizeHint: 'Die Zeichen in die Ebene malen: sie wird wieder eine normale Ebene',
    looksNames: { Classic: 'Klassisch', Newspaper: 'Zeitung', Blocks: 'Blöcke', 'Line art': 'Strichzeichnung', 'Lines only': 'Nur Linien', 'Box lines': 'Rahmenlinien' },
  },
)

export type AsciiStart = 'empty' | 'layer' | 'picture'

interface Look {
  name: string
  v: Record<string, number>
  ascii?: AdjustValues['ascii']
}

/** Quick looks: one tap for a whole style. */
const LOOKS: Look[] = [
  { name: 'Classic', v: { set: 0, colour: 0, paper: 0, edges: 0, dither: 0 } },
  { name: 'Newspaper', v: { set: 1, colour: 1, paper: 1, edges: 0.5, dither: 1 }, ascii: { ink: '#111111', paper: '#f4f1e8' } },
  { name: 'Terminal', v: { set: 0, colour: 1, paper: 1, edges: 0, dither: 0 }, ascii: { ink: '#33ff66', paper: '#0b0f0b' } },
  { name: 'Amber', v: { set: 0, colour: 1, paper: 1, edges: 0, dither: 2 }, ascii: { ink: '#ffb000', paper: '#140c00' } },
  { name: 'Blocks', v: { set: 2, colour: 0, paper: 0, edges: 0, dither: 0 } },
  { name: 'Line art', v: { set: 0, colour: 0, paper: 0, edges: 0.9, dither: 0 } },
  { name: 'Lines only', v: { set: 5, colour: 0, paper: 0, edges: 0.8, dither: 0 } },
  { name: 'Box lines', v: { set: 7, colour: 0, paper: 0, edges: 0.8, dither: 0 } },
  { name: 'Braille', v: { set: 4, colour: 0, paper: 0, edges: 0, dither: 0 } },
  { name: 'Code', v: { set: 6, colour: 0, paper: 0, edges: 0, dither: 0 } },
]

const LAST_KEY = 'egd.ascii.last'
const LOOKS_KEY = 'egd.ascii.looks'

function read<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key)
    return s ? (JSON.parse(s) as T) : null
  } catch {
    return null
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Settings stay for this session only.
  }
}

/** New ASCII layers start from these: letters on what is painted. */
export function defaultAscii(w: number, h: number): AdjustValues {
  const d = defaultValues('ascii', w, h)
  return { ...d, v: { ...d.v, look: 2 }, ascii: { ink: '#111111', paper: '#ffffff' } }
}

/** The settings picked last (kept after a restart), else the defaults; hand-painted signs never carry over. */
export function rememberedAscii(w: number, h: number): AdjustValues {
  const last = read<AdjustValues>(LAST_KEY)
  if (!last?.v) return defaultAscii(w, h)
  const d = defaultAscii(w, h)
  const { marks: _, ...ascii } = last.ascii ?? {}
  return { ...d, v: { ...d.v, ...last.v }, ascii: { ...d.ascii, ...ascii } }
}

/** True when the settings already have this look. */
const isLook = (values: AdjustValues, l: Look) => Object.entries(l.v).every(([k, v]) => (values.v[k] ?? 0) === v) && Object.entries(l.ascii ?? {}).every(([k, v]) => values.ascii?.[k as 'ink'] === v)

/** A sample to show the letters on: a shaded ball and a word, see-through around them. */
function drawSample(g: CanvasRenderingContext2D, w: number, h: number) {
  const r = h * 0.37
  const ball = g.createRadialGradient(w - r * 1.8, h / 2 - r * 0.35, 4, w - r * 1.5, h / 2, r)
  ball.addColorStop(0, '#ffd27a')
  ball.addColorStop(0.6, '#d0603a')
  ball.addColorStop(1, '#5a1e3a')
  g.fillStyle = ball
  g.beginPath()
  g.arc(w - r * 1.5, h / 2, r, 0, Math.PI * 2)
  g.fill()
  g.fillStyle = '#3070c0'
  g.font = `bold ${Math.round(h * 0.61)}px sans-serif`
  g.textBaseline = 'middle'
  g.fillText('Aa', h * 0.13, h / 2 + h * 0.04)
}

/** The art to preview (yours when there is any, else the sample) at w×h, and how much smaller than the drawing it is. */
function previewArt(w: number, h: number, art: HTMLCanvasElement | null): { img: ImageData; scale: number } {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d', { willReadFrequently: true })!
  if (!art || !art.width || !art.height) {
    drawSample(g, w, h)
    return { img: g.getImageData(0, 0, w, h), scale: 1 }
  }
  const scale = Math.min(w / art.width, h / art.height)
  g.drawImage(art, (w - art.width * scale) / 2, (h - art.height * scale) / 2, art.width * scale, art.height * scale)
  const img = g.getImageData(0, 0, w, h)
  // Nothing painted yet: show the sample instead of an empty preview.
  if (!img.data.some((v, i) => i % 4 === 3 && v > 0)) return previewArt(w, h, null)
  return { img, scale }
}

/** The letters for a preview: letter size shrinks with the picture, so the preview looks like the real layer. */
const shrink = (values: AdjustValues, scale: number): AdjustValues => (scale === 1 ? values : { ...values, v: { ...values.v, cell: Math.max(3, Math.round((values.v.cell ?? 8) * scale)) } })

/** A look's small preview. */
function LookThumb({ art, values }: { art: { img: ImageData; scale: number }; values: AdjustValues }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const g = ref.current?.getContext('2d')
    if (g) g.putImageData(renderAscii(art.img, shrink(values, art.scale)), 0, 0)
  }, [art, values])
  return <canvas ref={ref} width={art.img.width} height={art.img.height} className="sketch-ascii-thumb" aria-hidden />
}

/** The ASCII layer's settings with a live preview; for a new ASCII layer (from empty, a layer or the picture) or an existing one. */
export function AsciiDialog({
  initial,
  canCopyLayer,
  art,
  onOk,
  onClose,
  onOff,
  onRasterize,
  onExport,
}: {
  /** Settings of an existing ASCII layer; missing = a new one. */
  initial?: AdjustValues
  canCopyLayer?: boolean
  /** The pixels the letters will be made from (the layer, or what "Start with" picks); null = a sample. */
  art?(start: AsciiStart): HTMLCanvasElement | null
  onOk(values: AdjustValues, start: AsciiStart): void
  onClose(): void
  onOff?(): void
  onRasterize?(): void
  onExport?(format: AsciiFormat, values: AdjustValues): Promise<boolean>
}) {
  const [values, setValues] = useState<AdjustValues>(() => initial ?? rememberedAscii(1, 1))
  const [start, setStart] = useState<AsciiStart>('empty')
  const [copied, setCopied] = useState(false)
  const [fontTick, setFontTick] = useState(0)
  const [own, setOwn] = useState<Look[]>(() => read<Look[]>(LOOKS_KEY) ?? [])
  useEffect(() => void loadAsciiFont().then(() => setFontTick((n) => n + 1)), [])
  // The art is read once per "Start with" choice (reading the whole picture is not cheap).
  const src = useMemo(() => art?.(initial ? 'layer' : start) ?? null, [start, initial]) // eslint-disable-line react-hooks/exhaustive-deps
  // fontTick: the sample's word is drawn again once the font is there.
  const big = useMemo(() => previewArt(320, 140, src), [src, fontTick]) // eslint-disable-line react-hooks/exhaustive-deps
  const small = useMemo(() => previewArt(96, 42, src), [src, fontTick]) // eslint-disable-line react-hooks/exhaustive-deps
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const g = ref.current?.getContext('2d')
    if (g) g.putImageData(renderAscii(big.img, shrink(values, big.scale)), 0, 0)
  }, [values, big])
  const apply = (l: Look) => setValues((x) => ({ ...x, v: { ...x.v, ...l.v }, ascii: { ...x.ascii, ...l.ascii } }))
  const saveOwn = (next: Look[]) => {
    setOwn(next)
    write(LOOKS_KEY, next)
  }
  const ok = () => {
    write(LAST_KEY, { ...values, ascii: { ...values.ascii, marks: undefined } })
    // A picture to turn into letters: letters go on its dark parts, not just where it is painted.
    onOk(start !== 'empty' && !initial && values.v.look === 2 ? { ...values, v: { ...values.v, look: 0 } } : values, start)
  }
  const lookButton = (l: Look, i: number, mine: boolean) => {
    const on = isLook(values, l)
    return (
      <span key={`${mine}${i}`} className={`sketch-ascii-look${on ? ' is-active' : ''}`}>
        <button className="btn btn-ghost sketch-small" aria-pressed={on} onClick={() => apply(l)}>
          <LookThumb art={small} values={{ ...values, v: { ...values.v, ...l.v }, ascii: { ...values.ascii, ...l.ascii } }} />
          <span>{mine ? l.name : (UI.looksNames[l.name] ?? l.name)}</span>
        </button>
        {mine && (
          <button className="icon-btn sketch-ascii-look-x" title={UI.removeLook} aria-label={UI.removeLook} onClick={() => saveOwn(own.filter((_, j) => j !== i))}>
            <X size={12} />
          </button>
        )}
      </span>
    )
  }
  return (
    <Modal onClose={onClose}>
      <div className="sketch-outline-dialog sketch-ascii-dialog">
        <h3>{initial ? UI.editTitle : UI.newTitle}</h3>
        <p className="sketch-outline-intro">{UI.intro}</p>
        {!initial && (
          <div className="sketch-outline-row" role="radiogroup" aria-label={UI.start}>
            <span>{UI.start}</span>
            {(['empty', 'layer', 'picture'] as const)
              .filter((s) => s !== 'layer' || canCopyLayer)
              .map((s) => (
                <button key={s} role="radio" aria-checked={start === s} className={`btn btn-ghost sketch-small${start === s ? ' is-active' : ''}`} onClick={() => setStart(s)}>
                  {UI.starts[s]}
                </button>
              ))}
          </div>
        )}
        <canvas ref={ref} width={320} height={140} className="sketch-outline-preview" />
        <div className="sketch-ascii-looks" aria-label={UI.looks}>
          {LOOKS.map((l, i) => lookButton(l, i, false))}
        </div>
        <div className="sketch-ascii-looks" aria-label={UI.yourLooks}>
          {own.map((l, i) => lookButton(l, i, true))}
          <button
            className="btn btn-ghost sketch-small"
            title={UI.saveLookHint}
            onClick={() => {
              const { marks: _, ...ascii } = values.ascii ?? {}
              saveOwn([...own, { name: UI.lookName(own.length + 1), v: { ...values.v }, ascii }])
            }}
          >
            {UI.saveLook}
          </button>
        </div>
        <FilterControls id="ascii" values={values} onChange={setValues} />
        {onExport && (
          <div className="sketch-outline-row" aria-label={UI.export}>
            <span>{UI.export}</span>
            {ASCII_FORMATS.map((f) => (
              <button
                key={f.id}
                className="btn btn-ghost sketch-small"
                title={f.title}
                onClick={() =>
                  void onExport(f.id, values).then((done) => {
                    if (done && f.id === 'copy') setCopied(true)
                  })
                }
              >
                {f.id === 'copy' && copied ? UI.exported : f.label}
              </button>
            ))}
          </div>
        )}
        <div className="modal-actions">
          {onOff && (
            <button className="btn" title={UI.offHint} onClick={onOff}>
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
            {UI.ok}
          </button>
        </div>
      </div>
    </Modal>
  )
}
