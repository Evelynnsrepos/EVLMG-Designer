import { SIGN_PALETTE, type SignMode } from './asciiBrush'

const UI = {
  modes: {
    line: ['Line', 'Signs follow your stroke: - / | \\ _ ( )'],
    shade: ['Shade', 'Each stroke makes the letters one step darker'],
    lighten: ['Subtract', 'Each stroke makes the letters one step lighter, down to nothing'],
    sign: ['Sign', 'Paint the sign picked below'],
    scatter: ['Scatter', 'Random signs, for a glitchy look'],
    auto: ['Auto', 'Give the cells back to the automatic letters'],
  } as Record<SignMode, [string, string]>,
  size: 'Size',
  sizeHint: 'How many cells around the pen are painted',
  other: 'Other',
  otherHint: 'Any other sign (type one)',
  hint: 'Paints on the letter grid of this ASCII layer. Your normal brushes still paint the picture underneath.',
}

export interface SignTool {
  mode: SignMode
  sign: string
  size: number
}

/** The sign brushes' options (tool A, on an ASCII layer). */
export function AsciiBrushPanel({ value, onChange }: { value: SignTool; onChange(next: SignTool): void }) {
  const set = (patch: Partial<SignTool>) => onChange({ ...value, ...patch })
  return (
    <div className="ascii-brush">
      <div className="ascii-brush-modes" role="radiogroup">
        {(Object.keys(UI.modes) as SignMode[]).map((m) => (
          <button key={m} role="radio" aria-checked={value.mode === m} className={`btn btn-ghost sketch-small${value.mode === m ? ' is-active' : ''}`} title={UI.modes[m][1]} onClick={() => set({ mode: m })}>
            {UI.modes[m][0]}
          </button>
        ))}
      </div>
      <label className="sketch-row" title={UI.sizeHint}>
        <span className="adjust-label">{UI.size}</span>
        <input type="range" min={0} max={8} value={value.size} onChange={(e) => set({ size: +e.target.value })} aria-label={UI.size} />
        <span>{value.size + 1}</span>
      </label>
      {value.mode === 'sign' && (
        <div className="ascii-brush-palette">
          {SIGN_PALETTE.map((c) => (
            <button key={c} className={`ascii-brush-sign${value.sign === c ? ' is-active' : ''}`} aria-pressed={value.sign === c} onClick={() => set({ sign: c })}>
              {c}
            </button>
          ))}
          <input className="input ascii-brush-other" maxLength={2} value={SIGN_PALETTE.includes(value.sign) ? '' : value.sign} placeholder={UI.other} title={UI.otherHint} aria-label={UI.otherHint} onChange={(e) => e.target.value.trim() && set({ sign: [...e.target.value.trim()].pop()! })} />
        </div>
      )}
      <p className="ascii-brush-hint">{UI.hint}</p>
    </div>
  )
}
