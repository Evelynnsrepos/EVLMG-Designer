import { localized } from '../i18n'
import { SIGN_PALETTE, type SignMode } from './asciiBrush'

const UI = localized(
  {
    modes: {
      line: ['Line', 'Signs follow your stroke: - / | \\ _ ( )'],
      box: ['Box', 'Joined box lines follow your stroke: ─ │ ┌ ┐ └ ┘ ┼ (frames, menus, maps)'],
      shade: ['Shade', 'Each stroke makes the letters one step darker'],
      lighten: ['Subtract', 'Each stroke makes the letters one step lighter, down to nothing'],
      sign: ['Sign', 'Paint the sign picked below'],
      fill: ['Fill', 'Paint the cells\' background in the brush colour'],
      scatter: ['Scatter', 'Random signs, for a glitchy look'],
      auto: ['Auto', 'Give the cells back to the automatic letters (removes signs, shading and fill)'],
    } as Record<SignMode, [string, string]>,
    size: 'Size',
    sizeHint: 'How many cells around the pen are painted',
    other: 'Other',
    otherHint: 'Any other sign (type one)',
    hint: 'Paints on the letter grid of this ASCII layer, in the brush colour. Your normal brushes still paint the picture underneath.',
    ways: 'Other ways to make letters',
    wayList: [
      'Layers, letter button: a new ASCII layer (empty, a copy of a layer, or the whole picture).',
      'Layers, sliders button > ASCII art: shows everything below it as letters.',
      'Adjustments > Effects > ASCII art: turns one layer into letters once.',
      'Brush Studio > Easy > Letter brush: writes a word along your line.',
      'Pixel Art > ASCII art: copy or save a frame as letters.',
    ],
  },
  {
    modes: {
      line: ['Linie', 'Zeichen folgen deinem Strich: - / | \\ _ ( )'],
      box: ['Rahmen', 'Verbundene Rahmenlinien folgen deinem Strich: ─ │ ┌ ┐ └ ┘ ┼ (Rahmen, Menüs, Karten)'],
      shade: ['Dunkler', 'Jeder Strich macht die Zeichen eine Stufe dunkler'],
      lighten: ['Heller', 'Jeder Strich macht die Zeichen eine Stufe heller, bis nichts mehr da ist'],
      sign: ['Zeichen', 'Malt das unten gewählte Zeichen'],
      fill: ['Füllen', 'Malt den Hintergrund der Zellen in der Pinselfarbe'],
      scatter: ['Streuen', 'Zufällige Zeichen, für einen Glitch-Look'],
      auto: ['Auto', 'Gibt die Zellen an die automatischen Zeichen zurück (entfernt Zeichen, Schattierung und Füllung)'],
    },
    size: 'Größe',
    sizeHint: 'Wie viele Zellen um den Stift bemalt werden',
    other: 'Andere',
    otherHint: 'Ein anderes Zeichen (tippe eins)',
    hint: 'Malt auf das Zeichenraster dieser ASCII-Ebene, in der Pinselfarbe. Deine normalen Pinsel malen weiter das Bild darunter.',
    ways: 'Andere Wege zu Zeichen',
    wayList: [
      'Ebenen, Buchstaben-Knopf: eine neue ASCII-Ebene (leer, Kopie einer Ebene oder das ganze Bild).',
      'Ebenen, Regler-Knopf > ASCII-Art: zeigt alles darunter als Zeichen.',
      'Anpassungen > Effekte > ASCII-Art: macht eine Ebene einmal zu Zeichen.',
      'Pinsel-Studio > Einfach > Buchstabenpinsel: schreibt ein Wort entlang deiner Linie.',
      'Pixel Art > ASCII-Art: ein Bild als Zeichen kopieren oder speichern.',
    ],
  },
)

/** Where else ASCII art lives in the app, so the five ways in are explained in one place. */
export function AsciiWays() {
  return (
    <details className="ascii-brush-ways">
      <summary>{UI.ways}</summary>
      <ul>
        {UI.wayList.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </details>
  )
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
      <AsciiWays />
    </div>
  )
}
