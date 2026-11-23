import { useState } from 'react'
import { localized } from '../i18n'
import { AsciiExtras } from './adjust/AdjustStudio'
import { defaultValues, filterDef, type AdjustValues } from './adjust/filters'
import { ASCII_FORMATS, asciiGridOfImage, exportAscii } from './asciiExport'

const UI = localized(
  {
    title: 'ASCII art',
    hint: 'Every pixel pair (one wide, two tall) becomes a letter.',
    copied: 'Copied',
  },
  {
    title: 'ASCII-Art',
    hint: 'Jedes Pixelpaar (eins breit, zwei hoch) wird ein Zeichen.',
    copied: 'Kopiert',
  },
)

/** Pixel Art (0.35): the frame as letters, copied or saved as text, a web page, terminal colours or a picture. */
export function AsciiQuick({ picture, name }: { picture(): ImageData; name: string }) {
  const [values, setValues] = useState<AdjustValues>(() => {
    const d = defaultValues('ascii', 1, 1)
    return { ...d, v: { ...d.v, look: 2 } }
  })
  const [copied, setCopied] = useState(false)
  const def = filterDef('ascii')
  const pickers = def.params.filter((p) => p.options && ['set', 'colour', 'look'].includes(p.key))
  return (
    <details className="px-adjust">
      <summary>{UI.title}</summary>
      <p className="muted">{UI.hint}</p>
      {pickers.map((p) => (
        <label key={p.key} className="px-row">
          <span className="px-adjust-name">{p.label}</span>
          <select className="input" value={values.v[p.key]} onChange={(e) => setValues((x) => ({ ...x, v: { ...x.v, [p.key]: Number(e.target.value) } }))}>
            {p.options!.map((o, i) => (
              <option key={o} value={i}>
                {o}
              </option>
            ))}
          </select>
        </label>
      ))}
      <AsciiExtras values={values} onChange={setValues} />
      <div className="px-row px-wrap">
        {ASCII_FORMATS.map((f) => (
          <button
            key={f.id}
            className="btn btn-ghost"
            title={f.title}
            onClick={() => void exportAscii(asciiGridOfImage(picture(), values), f.id, name).then((done) => done && f.id === 'copy' && setCopied(true))}
          >
            {f.id === 'copy' && copied ? UI.copied : f.label}
          </button>
        ))}
      </div>
    </details>
  )
}
