import { Code2, Skull } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Id } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useProjectStore, useUndoRedoKeys, type UseDocumentResult } from '@/core/state'
import {
  createDamagePresetDoc,
  enemyTargetValues,
  LineChart,
  normalizeDamagePresetDoc,
  NumberInput,
  PresetHeader,
  TARGET_VARIABLES,
  useEditSession,
  type DamagePresetDoc,
} from '@/shared/calculators'
import { formatNumber, FUNCTION_HELP, libraryFor } from '@/shared/formulas'
import { activeFormula, evaluateDoc, filledValues, rangeRows, switchFormula, withRangeVariable } from './logic'
import { ScoreSection, TtkSection } from './ExtrasPanel'
import './damage-calculator.css'

const T = {
  kind: 'Damage preset',
  library: 'Formula library',
  custom: 'Custom formula',
  customHint: 'Write your own',
  inputs: 'Inputs',
  noInputs: 'This formula has no variables.',
  result: 'Result',
  formula: 'Formula',
  customLabel: 'Your formula',
  functions: 'Functions you can use',
  enemyTitle: 'Target from the Enemy List',
  enemyNone: 'Add enemies in the Enemy List to use them as targets here.',
  enemyPick: 'Enemy',
  enemyChoose: 'Choose an enemy…',
  enemyLevel: 'at level',
  enemyUse: 'Use its stats',
  enemyHelp: (names: string) => `Fills ${names} from the enemy's stats at that level.`,
  range: 'Across a range',
  rangeVar: 'Change',
  rangeFrom: 'from',
  rangeTo: 'to',
  rangeStep: 'step',
  table: 'Table',
  chart: 'Chart',
  rangeEmpty: 'Fix the formula to see the range.',
  presetNote: 'This preset is saved in your project. The Level Calculator can use it for damage per level.',
}

export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<DamagePresetDoc>('damage-calculator', documentId!, createDamagePresetDoc)
  useUndoRedoKeys(doc, active)
  if (!doc.data) return null
  return <DamageCalculator documentId={documentId!} doc={doc} />
}

export function DamageCalculator({ documentId, doc: raw }: { documentId: Id; doc: UseDocumentResult<DamagePresetDoc> }) {
  const data = useMemo(() => normalizeDamagePresetDoc(raw.data), [raw.data])
  const update = (fn: (d: DamagePresetDoc) => DamagePresetDoc, options?: { undoable?: boolean }) =>
    raw.update((d) => fn(normalizeDamagePresetDoc(d)), options)
  const session = useEditSession(raw)
  const f = activeFormula(data)
  const values = filledValues(data, f)
  const result = evaluateDoc(data)
  const groups = libraryFor('damage')

  const setValue = (name: string, value: number) => update((d) => ({ ...d, values: { ...d.values, [name]: value } }))

  return (
    <div className="calc-root dmg-root">
      <PresetHeader documentId={documentId} kind={T.kind} undo={raw.undo} redo={raw.redo} canUndo={raw.canUndo} canRedo={raw.canRedo} />
      <div className="dmg-body">
        <nav className="dmg-library" aria-label={T.library}>
          {groups.map((g) => (
            <section key={g.id} className="dmg-group">
              <h4>{g.name}</h4>
              <p>{g.gameTypes}</p>
              {g.formulas.map((lf) => (
                <button
                  key={lf.id}
                  className={`dmg-formula${data.formulaId === lf.id ? ' on' : ''}`}
                  aria-pressed={data.formulaId === lf.id}
                  onClick={() => update((d) => switchFormula(d, lf.id))}
                >
                  {lf.name}
                </button>
              ))}
            </section>
          ))}
          <section className="dmg-group">
            <h4>{T.custom}</h4>
            <button className={`dmg-formula${data.formulaId === null ? ' on' : ''}`} aria-pressed={data.formulaId === null} onClick={() => update((d) => switchFormula(d, null))}>
              <Code2 size={14} /> {T.customHint}
            </button>
          </section>
        </nav>

        <div className="calc-scroll">
          <section className="calc-section">
            <h3>{f.name}</h3>
            {f.isCustom ? (
              <label className="calc-field">
                <span>{T.customLabel}</span>
                <textarea
                  className="input dmg-expression"
                  rows={2}
                  spellCheck={false}
                  value={data.expression}
                  onFocus={session.begin}
                  onBlur={session.end}
                  onChange={(e) => {
                    const expression = e.target.value
                    session.change((d) => withRangeVariable({ ...normalizeDamagePresetDoc(d), expression }))
                  }}
                />
              </label>
            ) : (
              <div className="calc-code" aria-label={T.formula}>
                {f.writtenForm}
              </div>
            )}
            <p className="calc-muted dmg-desc">{f.description}</p>
            {f.error && <div className="calc-error">{f.error}</div>}
            {f.isCustom && (
              <details className="dmg-help">
                <summary>{T.functions}</summary>
                <ul>
                  {FUNCTION_HELP.map((h) => (
                    <li key={h.name}>
                      <code>{h.help}</code>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>

          <section className="calc-section">
            <h3>{T.inputs}</h3>
            {f.variables.length === 0 && <p className="calc-muted">{T.noInputs}</p>}
            <div className="dmg-inputs">
              {f.variables.map((v) => (
                <label key={v.name} className="dmg-input">
                  <span className="dmg-input-label">
                    {v.label}
                    {v.label !== v.name && <code>{v.name}</code>}
                  </span>
                  <span className="dmg-input-field">
                    <NumberInput value={values[v.name]} min={v.min} max={v.max} onChange={(n) => setValue(v.name, n)} />
                    {v.unit && <span className="calc-muted">{v.unit}</span>}
                  </span>
                  {v.help && <span className="calc-muted dmg-input-help">{v.help}</span>}
                </label>
              ))}
            </div>
            <EnemyTarget variables={f.variables.map((v) => v.name)} onApply={(vals) => update((d) => ({ ...d, values: { ...d.values, ...vals } }))} />
          </section>

          <section className="calc-section dmg-result" aria-live="polite">
            <h3>{T.result}</h3>
            {result === null ? null : result.ok ? (
              <div>
                <span className="calc-muted">{f.resultLabel} = </span>
                <span className="calc-big">{formatNumber(result.value)}</span>
                {f.resultUnit && <span className="calc-muted"> {f.resultUnit}</span>}
              </div>
            ) : (
              <div className="calc-error">{result.error.message}</div>
            )}
            <p className="calc-muted">{T.presetNote}</p>
          </section>

          <RangeSection data={data} update={update} resultLabel={f.resultLabel} variables={f.variables.map((v) => ({ name: v.name, label: v.label }))} />
          <TtkSection data={data} update={update} />
          <ScoreSection data={data} update={update} />
        </div>
      </div>
    </div>
  )
}

function EnemyTarget({ variables, onApply }: { variables: string[]; onApply: (values: Record<string, number>) => void }) {
  const enemies = useProjectStore((s) => s.entities.enemy)
  const [enemyId, setEnemyId] = useState<Id | ''>('')
  const [level, setLevel] = useState(1)
  const used = TARGET_VARIABLES.filter((n) => variables.includes(n))
  if (used.length === 0) return null
  const enemy = enemies.find((e) => e.id === enemyId)
  return (
    <div className="dmg-enemy">
      <div className="dmg-enemy-title">
        <Skull size={14} /> {T.enemyTitle}
      </div>
      {enemies.length === 0 ? (
        <p className="calc-muted">{T.enemyNone}</p>
      ) : (
        <>
          <div className="calc-row">
            <select
              className="input calc-select"
              aria-label={T.enemyPick}
              value={enemyId}
              onChange={(e) => {
                setEnemyId(e.target.value)
                const picked = enemies.find((x) => x.id === e.target.value)
                if (picked) setLevel(picked.levelMin || 1)
              }}
            >
              <option value="">{T.enemyChoose}</option>
              {enemies.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <span className="calc-muted">{T.enemyLevel}</span>
            <NumberInput value={level} min={1} onChange={setLevel} aria-label={T.enemyLevel} />
            <button className="btn" disabled={!enemy} onClick={() => enemy && onApply(pick(enemyTargetValues(enemy, level), variables))}>
              {T.enemyUse}
            </button>
          </div>
          <p className="calc-muted">{T.enemyHelp(used.join(', '))}</p>
        </>
      )}
    </div>
  )
}

function pick(values: Record<string, number>, names: string[]) {
  return Object.fromEntries(Object.entries(values).filter(([k]) => names.includes(k)))
}

function RangeSection({
  data,
  update,
  resultLabel,
  variables,
}: {
  data: DamagePresetDoc
  update: (fn: (d: DamagePresetDoc) => DamagePresetDoc) => void
  resultLabel: string
  variables: Array<{ name: string; label: string }>
}) {
  const rows = useMemo(() => rangeRows(data), [data])
  if (variables.length === 0) return null
  const r = data.range
  const setRange = (patch: Partial<DamagePresetDoc['range']>) => update((d) => ({ ...d, range: { ...d.range, ...patch } }))
  const label = variables.find((v) => v.name === r.variable)?.label ?? r.variable
  return (
    <section className="calc-section">
      <h3>
        {T.range}
        <span className="calc-spacer" />
        <span className="calc-segmented">
          <button className={r.mode === 'table' ? 'on' : ''} onClick={() => setRange({ mode: 'table' })}>
            {T.table}
          </button>
          <button className={r.mode === 'chart' ? 'on' : ''} onClick={() => setRange({ mode: 'chart' })}>
            {T.chart}
          </button>
        </span>
      </h3>
      <div className="calc-row">
        <span className="calc-muted">{T.rangeVar}</span>
        <select className="input calc-select" value={r.variable} onChange={(e) => setRange({ variable: e.target.value })} aria-label={T.rangeVar}>
          {variables.map((v) => (
            <option key={v.name} value={v.name}>
              {v.label}
            </option>
          ))}
        </select>
        <span className="calc-muted">{T.rangeFrom}</span>
        <NumberInput value={r.from} onChange={(from) => setRange({ from })} aria-label={T.rangeFrom} />
        <span className="calc-muted">{T.rangeTo}</span>
        <NumberInput value={r.to} onChange={(to) => setRange({ to })} aria-label={T.rangeTo} />
        <span className="calc-muted">{T.rangeStep}</span>
        <NumberInput value={r.step} min={0} onChange={(step) => setRange({ step })} aria-label={T.rangeStep} />
      </div>
      {rows.length === 0 ? (
        <p className="calc-muted">{T.rangeEmpty}</p>
      ) : r.mode === 'chart' ? (
        <LineChart xs={rows.map((x) => x.x)} series={[{ name: resultLabel, values: rows.map((x) => x.value) }]} xLabel={label} />
      ) : (
        <div className="calc-table-wrap">
          <table className="calc-table">
            <thead>
              <tr>
                <th>{label}</th>
                <th>{resultLabel}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.x}>
                  <td>{formatNumber(row.x)}</td>
                  <td title={row.error}>{row.value === null ? '—' : formatNumber(row.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
