import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { LineChart, NumberInput, type DamagePresetDoc, type ScoreStack, type ScoreStep, type TtkSettings, type TtkWeapon } from '@/shared/calculators'
import { formatNumber } from '@/shared/formulas'
import { createStack, createTtk, newStep, newWeapon, runStack, ttkAt } from './extras'

type Update = (fn: (d: DamagePresetDoc) => DamagePresetDoc) => void

const OPS: { id: ScoreStep['op']; label: (s: ScoreStack) => string }[] = [
  { id: 'add-a', label: (s) => `+ ${s.aName}` },
  { id: 'add-b', label: (s) => `+ ${s.bName}` },
  { id: 'mul-a', label: (s) => `× ${s.aName}` },
  { id: 'mul-b', label: (s) => `× ${s.bName}` },
]

/** Missing tools 6b: weapons compared by time to kill over distance (shooters). */
export function TtkSection({ data, update }: { data: DamagePresetDoc; update: Update }) {
  const t = data.ttk
  const set = (p: Partial<TtkSettings>) => update((d) => ({ ...d, ttk: { ...(d.ttk ?? createTtk()), ...p } }))
  const setW = (id: string, p: Partial<TtkWeapon>) => set({ weapons: t!.weapons.map((w) => (w.id === id ? { ...w, ...p } : w)) })
  return (
    <details className="calc-section dmg-extra" open={!!t}>
      <summary>
        <h3>Time to kill</h3>
        <span className="calc-muted">Shooters: how fast each weapon takes down a target, near and far.</span>
      </summary>
      {!t ? (
        <button className="btn btn-ghost" onClick={() => set({})}>
          <Plus size={14} /> Compare weapons
        </button>
      ) : (
        <>
          <div className="dmg-ttk-row">
            <label className="calc-field">
              <span>Target health</span>
              <NumberInput value={t.hp} min={1} onChange={(hp) => set({ hp })} />
            </label>
            <label className="calc-field">
              <span>Armour</span>
              <NumberInput value={t.armor} min={0} onChange={(armor) => set({ armor })} />
            </label>
            <label className="calc-field">
              <span>Chart up to (m)</span>
              <NumberInput value={t.maxRange} min={5} onChange={(maxRange) => set({ maxRange })} />
            </label>
          </div>
          <div className="dmg-ttk-wrap"><table className="calc-table dmg-ttk">
            <thead>
              <tr>
                <th>Weapon</th>
                <th>Damage</th>
                <th>Shots / min</th>
                <th>Falls off from (m)</th>
                <th>to (m)</th>
                <th>down to %</th>
                <th>Shots</th>
                <th>Time to kill</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {t.weapons.map((w) => {
                const near = ttkAt(w, t, 0)
                const far = ttkAt(w, t, t.maxRange)
                return (
                  <tr key={w.id}>
                    <td>
                      <input className="input" value={w.name} onChange={(e) => setW(w.id, { name: e.target.value })} />
                    </td>
                    <td>
                      <NumberInput value={w.damage} min={0} onChange={(damage) => setW(w.id, { damage })} />
                    </td>
                    <td>
                      <NumberInput value={w.rpm} min={1} onChange={(rpm) => setW(w.id, { rpm })} />
                    </td>
                    <td>
                      <NumberInput value={w.falloffStart} min={0} onChange={(falloffStart) => setW(w.id, { falloffStart })} />
                    </td>
                    <td>
                      <NumberInput value={w.falloffEnd} min={0} onChange={(falloffEnd) => setW(w.id, { falloffEnd })} />
                    </td>
                    <td>
                      <NumberInput value={w.minPercent} min={0} max={100} onChange={(minPercent) => setW(w.id, { minPercent })} />
                    </td>
                    <td>{near.shots === far.shots ? near.shots : `${near.shots}–${far.shots}`}</td>
                    <td>
                      {Number.isFinite(near.seconds) ? `${formatNumber(Math.round(near.seconds * 1000))} ms` : '–'}
                      {far.seconds !== near.seconds && Number.isFinite(far.seconds) && <span className="calc-muted"> → {formatNumber(Math.round(far.seconds * 1000))} ms</span>}
                    </td>
                    <td>
                      <button className="icon-btn" aria-label="Remove" onClick={() => set({ weapons: t.weapons.filter((x) => x.id !== w.id) })}>
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table></div>
          <div className="dmg-ttk-row">
            <button className="btn btn-ghost" onClick={() => set({ weapons: [...t.weapons, newWeapon('New weapon')] })}>
              <Plus size={14} /> Weapon
            </button>
            <button className="btn btn-ghost" onClick={() => update((d) => ({ ...d, ttk: undefined }))}>
              Remove
            </button>
          </div>
          {t.weapons.length > 0 &&
            (() => {
              const xs = Array.from({ length: 31 }, (_, i) => Math.round((t.maxRange * i) / 30))
              return <LineChart xs={xs} series={t.weapons.slice(0, 4).map((w) => ({ name: `${w.name} (ms)`, values: xs.map((x) => { const s = ttkAt(w, t, x).seconds; return Number.isFinite(s) ? Math.round(s * 1000) : null }) }))} xLabel="Distance (m)" />
            })()}
          <p className="calc-muted">The first shot lands at 0 ms, so time to kill is the time between the first and the last shot. Armour is added to health. The chart shows the first four weapons.</p>
        </>
      )}
    </details>
  )
}

/** Missing tools 6c: two numbers changed by steps in order, then multiplied (chips × mult). */
export function ScoreSection({ data, update }: { data: DamagePresetDoc; update: Update }) {
  const s = data.stack
  const set = (p: Partial<ScoreStack>) => update((d) => ({ ...d, stack: { ...(d.stack ?? createStack()), ...p } }))
  const setStep = (id: string, p: Partial<ScoreStep>) => set({ steps: s!.steps.map((x) => (x.id === id ? { ...x, ...p } : x)) })
  const move = (i: number, by: number) => {
    const steps = [...s!.steps]
    const [x] = steps.splice(i, 1)
    steps.splice(Math.max(0, Math.min(steps.length, i + by)), 0, x)
    set({ steps })
  }
  const r = s ? runStack(s) : null
  return (
    <details className="calc-section dmg-extra" open={!!s}>
      <summary>
        <h3>Score stack</h3>
        <span className="calc-muted">Card and roguelite scoring: two numbers changed step by step in order, then multiplied.</span>
      </summary>
      {!s || !r ? (
        <button className="btn btn-ghost" onClick={() => set({})}>
          <Plus size={14} /> Build a score stack
        </button>
      ) : (
        <>
          <div className="dmg-ttk-row">
            <label className="calc-field">
              <span>First number</span>
              <input className="input" value={s.aName} onChange={(e) => set({ aName: e.target.value })} />
            </label>
            <label className="calc-field">
              <span>starts at</span>
              <NumberInput value={s.a} onChange={(a) => set({ a })} />
            </label>
            <label className="calc-field">
              <span>Second number</span>
              <input className="input" value={s.bName} onChange={(e) => set({ bName: e.target.value })} />
            </label>
            <label className="calc-field">
              <span>starts at</span>
              <NumberInput value={s.b} onChange={(b) => set({ b })} />
            </label>
          </div>
          <div className="dmg-ttk-wrap"><table className="calc-table dmg-ttk">
            <thead>
              <tr>
                <th>On</th>
                <th>Step</th>
                <th>Does</th>
                <th>Amount</th>
                <th>Times</th>
                <th>
                  {s.aName} × {s.bName} after
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {s.steps.map((st, i) => (
                <tr key={st.id} className={st.on ? '' : 'calc-muted'}>
                  <td>
                    <input type="checkbox" checked={st.on} onChange={(e) => setStep(st.id, { on: e.target.checked })} aria-label="On" title="Off = this step doesn't happen (the hand isn't a flush, the joker isn't owned)" />
                  </td>
                  <td>
                    <input className="input" value={st.name} onChange={(e) => setStep(st.id, { name: e.target.value })} />
                  </td>
                  <td>
                    <select className="input" value={st.op} onChange={(e) => setStep(st.id, { op: e.target.value as ScoreStep['op'] })}>
                      {OPS.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label(s)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <NumberInput value={st.amount} onChange={(amount) => setStep(st.id, { amount })} />
                  </td>
                  <td>
                    <NumberInput value={st.times} min={0} onChange={(times) => setStep(st.id, { times })} />
                  </td>
                  <td>
                    {formatNumber(r.after[i].a)} × {formatNumber(r.after[i].b)}
                  </td>
                  <td>
                    <button className="icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp size={13} />
                    </button>
                    <button className="icon-btn" aria-label="Move down" disabled={i === s.steps.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown size={13} />
                    </button>
                    <button className="icon-btn" aria-label="Remove" onClick={() => set({ steps: s.steps.filter((x) => x.id !== st.id) })}>
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <div className="dmg-ttk-row">
            <button className="btn btn-ghost" onClick={() => set({ steps: [...s.steps, newStep()] })}>
              <Plus size={14} /> Step
            </button>
            <button className="btn btn-ghost" onClick={() => update((d) => ({ ...d, stack: undefined }))}>
              Remove
            </button>
          </div>
          <div>
            <span className="calc-muted">Score = </span>
            <span className="calc-big">{formatNumber(r.score)}</span>
          </div>
          <p className="calc-muted">Steps run from top to bottom: adding before multiplying gives more. Move a step up or down to see why order matters.</p>
        </>
      )}
    </details>
  )
}
