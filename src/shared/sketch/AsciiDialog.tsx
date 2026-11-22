import { useEffect, useRef, useState } from 'react'
import { Modal } from '../ui'
import { FilterControls } from './adjust/AdjustStudio'
import { defaultValues, type AdjustValues } from './adjust/filters'
import { loadAsciiFont, renderAscii } from './ascii'
import { ASCII_FORMATS, type AsciiFormat } from './asciiExport'

const UI = {
  newTitle: 'ASCII layer',
  editTitle: 'ASCII layer',
  intro: 'Everything on this layer is shown as letters, while you paint with any brush. Your paint is kept, so you can change the letters any time.',
  looks: 'Quick looks',
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
}

export type AsciiStart = 'empty' | 'layer' | 'picture'

/** Quick looks: one tap for a whole style. */
const LOOKS: { name: string; v: Record<string, number>; ascii?: AdjustValues['ascii'] }[] = [
  { name: 'Classic', v: { set: 0, colour: 0, paper: 0, edges: 0, dither: 0 } },
  { name: 'Newspaper', v: { set: 1, colour: 1, paper: 1, edges: 0.5, dither: 1 }, ascii: { ink: '#111111', paper: '#f4f1e8' } },
  { name: 'Terminal', v: { set: 0, colour: 1, paper: 1, edges: 0, dither: 0 }, ascii: { ink: '#33ff66', paper: '#0b0f0b' } },
  { name: 'Amber', v: { set: 0, colour: 1, paper: 1, edges: 0, dither: 2 }, ascii: { ink: '#ffb000', paper: '#140c00' } },
  { name: 'Blocks', v: { set: 2, colour: 0, paper: 0, edges: 0, dither: 0 } },
  { name: 'Line art', v: { set: 0, colour: 0, paper: 0, edges: 0.9, dither: 0 } },
]

/** New ASCII layers start from these: letters on what is painted. */
export function defaultAscii(w: number, h: number): AdjustValues {
  const d = defaultValues('ascii', w, h)
  return { ...d, v: { ...d.v, look: 2 }, ascii: { ink: '#111111', paper: '#ffffff' } }
}

/** The ASCII layer's settings with a live preview; for a new ASCII layer (from empty, a layer or the picture) or an existing one. */
export function AsciiDialog({
  initial,
  canCopyLayer,
  onOk,
  onClose,
  onOff,
  onRasterize,
  onExport,
}: {
  /** Settings of an existing ASCII layer; missing = a new one. */
  initial?: AdjustValues
  canCopyLayer?: boolean
  onOk(values: AdjustValues, start: AsciiStart): void
  onClose(): void
  onOff?(): void
  onRasterize?(): void
  onExport?(format: AsciiFormat, values: AdjustValues): Promise<boolean>
}) {
  const [values, setValues] = useState<AdjustValues>(() => initial ?? lastUsed ?? defaultAscii(1, 1))
  const [start, setStart] = useState<AsciiStart>('empty')
  const [copied, setCopied] = useState(false)
  const [fontTick, setFontTick] = useState(0)
  useEffect(() => void loadAsciiFont().then(() => setFontTick((n) => n + 1)), [])
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const g = c.getContext('2d', { willReadFrequently: true })!
    g.clearRect(0, 0, c.width, c.height)
    // A sample: a shaded ball and a word, see-through around them.
    const ball = g.createRadialGradient(c.width - 95, c.height / 2 - 18, 4, c.width - 80, c.height / 2, 52)
    ball.addColorStop(0, '#ffd27a')
    ball.addColorStop(0.6, '#d0603a')
    ball.addColorStop(1, '#5a1e3a')
    g.fillStyle = ball
    g.beginPath()
    g.arc(c.width - 80, c.height / 2, 52, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#3070c0'
    g.font = 'bold 86px sans-serif'
    g.textBaseline = 'middle'
    g.fillText('Aa', 18, c.height / 2 + 6)
    g.putImageData(renderAscii(g.getImageData(0, 0, c.width, c.height), values), 0, 0)
  }, [values, fontTick])
  const ok = () => {
    lastUsed = values
    // A picture to turn into letters: letters go on its dark parts, not just where it is painted.
    onOk(start !== 'empty' && !initial && values.v.look === 2 ? { ...values, v: { ...values.v, look: 0 } } : values, start)
  }
  return (
    <Modal onClose={onClose}>
      <div className="sketch-outline-dialog sketch-ascii-dialog">
        <h3>{initial ? UI.editTitle : UI.newTitle}</h3>
        <p className="sketch-outline-intro">{UI.intro}</p>
        <canvas ref={ref} width={320} height={140} className="sketch-outline-preview" />
        <div className="sketch-outline-presets" aria-label={UI.looks}>
          {LOOKS.map((l) => (
            <button key={l.name} className="btn btn-ghost sketch-small" onClick={() => setValues((x) => ({ ...x, v: { ...x.v, ...l.v }, ascii: { ...x.ascii, ...l.ascii } }))}>
              {l.name}
            </button>
          ))}
        </div>
        <FilterControls id="ascii" values={values} onChange={setValues} />
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

/** The last settings picked, so the next ASCII layer starts from them. */
let lastUsed: AdjustValues | null = null
