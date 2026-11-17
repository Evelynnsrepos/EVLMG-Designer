import { Plus, X } from 'lucide-react'
import { newId } from '@/core/model'
import { useDocument } from '@/core/state'
import { emptyStatusDoc, STATUS_DOC, type StatusDoc } from '@/components/status-effects/model'
import { LineChart, NumberInput } from '@/shared/calculators'
import { realHoursToFill, simulateMeters, survivalExample, type EconomyDoc, type Meter, type MeterAction, type MeterThreshold } from './model'

/** Missing tools phase 3: the Meters tab of the Economy Simulator. */
export function Meters({ d, set }: { d: EconomyDoc; set(fn: (d: EconomyDoc) => EconomyDoc): void }) {
  const effects = useDocument<StatusDoc>(STATUS_DOC.type, STATUS_DOC.id, emptyStatusDoc).data?.items ?? []
  const meters = d.meters ?? []
  const actions = d.meterActions ?? []
  const r = simulateMeters(d)
  const editMeter = (id: string, p: Partial<Meter>) => set((x) => ({ ...x, meters: (x.meters ?? []).map((m) => (m.id === id ? { ...m, ...p } : m)) }))
  const editTh = (m: Meter, id: string, p: Partial<MeterThreshold>) => editMeter(m.id, { thresholds: m.thresholds.map((t) => (t.id === id ? { ...t, ...p } : t)) })
  const editAction = (id: string, p: Partial<MeterAction>) => set((x) => ({ ...x, meterActions: (x.meterActions ?? []).map((a) => (a.id === id ? { ...a, ...p } : a)) }))
  const name = (id: string | null) => meters.find((m) => m.id === id)?.name ?? '?'
  const meterSelect = (value: string | null, onChange: (v: string | null) => void, none?: string) => (
    <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {none && <option value="">{none}</option>}
      {meters.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  )
  const addMeter = () => set((x) => ({ ...x, meters: [...(x.meters ?? []), { id: newId(), name: 'Stamina', start: 100, max: 100, perHour: -10, offline: false, thresholds: [] }] }))

  if (!meters.length)
    return (
      <div className="eco-body">
        <p>Meters are bars that change over time: hunger and thirst in a survival game, stamina, mood, or energy that refills while the game is closed.</p>
        <div className="ld-inline">
          <button className="btn btn-primary" onClick={() => set((x) => ({ ...x, ...survivalExample() }))}>
            Add survival example
          </button>
          <button className="btn btn-ghost" onClick={addMeter}>
            <Plus size={14} /> Add a meter
          </button>
        </div>
      </div>
    )

  const warnings = meters.flatMap((m) => m.thresholds.filter((t) => r.firstBelow[t.id] !== null).map((t) => ({ m, t, hour: r.firstBelow[t.id]!, hours: r.hoursBelow[t.id] })))

  return (
    <div className="eco-body">
      <section>
        <h3>Meters</h3>
        {meters.map((m) => (
          <div key={m.id} className="eco-meter">
            <div className="ld-inline">
              <input className="input" value={m.name} onChange={(e) => editMeter(m.id, { name: e.target.value })} aria-label="Meter" />
              <span className="muted">start</span>
              <NumberInput value={m.start} min={0} onChange={(start) => editMeter(m.id, { start })} />
              <span className="muted">max</span>
              <NumberInput value={m.max} min={1} onChange={(max) => editMeter(m.id, { max })} />
              <span className="muted">per hour</span>
              <NumberInput value={m.perHour} onChange={(perHour) => editMeter(m.id, { perHour })} />
              <label className="ld-inline" title="Keeps changing while the game is closed, like resin or energy refills">
                <input type="checkbox" checked={m.offline} onChange={(e) => editMeter(m.id, { offline: e.target.checked })} /> also while offline
              </label>
              <button
                className="icon-btn"
                aria-label="Remove meter"
                onClick={() =>
                  set((x) => ({
                    ...x,
                    meters: (x.meters ?? []).filter((o) => o.id !== m.id).map((o) => ({ ...o, thresholds: o.thresholds.map((t) => (t.meterId === m.id ? { ...t, meterId: null } : t)) })),
                    meterActions: (x.meterActions ?? []).filter((a) => a.meterId !== m.id),
                  }))
                }
              >
                <X size={13} />
              </button>
            </div>
            {m.offline && realHoursToFill(m) !== null && <span className="muted">From {m.perHour > 0 ? 'empty to full' : 'full to empty'}: {realHoursToFill(m)} real hours.</span>}
            {m.thresholds.map((t) => (
              <div key={t.id} className="ld-inline eco-th">
                <span className="muted">below</span>
                <NumberInput value={t.below} min={0} onChange={(below) => editTh(m, t.id, { below })} />
                <input className="input" value={t.name} onChange={(e) => editTh(m, t.id, { name: e.target.value })} aria-label="Name" />
                {effects.length > 0 && (
                  <select className="input" value={t.effectId ?? ''} onChange={(e) => editTh(m, t.id, { effectId: e.target.value || null })} title="A Status Effect it puts on the player">
                    <option value="">No status effect</option>
                    {effects.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                )}
                <span className="muted">changes</span>
                {meterSelect(t.meterId, (meterId) => editTh(m, t.id, { meterId }), 'no other meter')}
                {t.meterId && (
                  <>
                    <span className="muted">by</span>
                    <NumberInput value={t.perHour} onChange={(perHour) => editTh(m, t.id, { perHour })} />
                    <span className="muted">per hour</span>
                  </>
                )}
                <button className="icon-btn" aria-label="Remove level" onClick={() => editMeter(m.id, { thresholds: m.thresholds.filter((x) => x.id !== t.id) })}>
                  <X size={13} />
                </button>
              </div>
            ))}
            <button className="btn btn-ghost eco-add eco-th" onClick={() => editMeter(m.id, { thresholds: [...m.thresholds, { id: newId(), below: Math.round(m.max * 0.2), name: 'Low', effectId: null, meterId: null, perHour: 0 }] })}>
              <Plus size={14} /> When it falls below…
            </button>
          </div>
        ))}
        <button className="btn btn-ghost eco-add" onClick={addMeter}>
          <Plus size={14} /> Add a meter
        </button>
      </section>

      <section>
        <h3>Actions that change them</h3>
        <table className="calc-table eco-table">
          <thead>
            <tr>
              <th>Action</th>
              <th>Meter</th>
              <th>Change</th>
              <th>Every hours</th>
              <th>Costs</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {actions.map((a) => (
              <tr key={a.id}>
                <td>
                  <input className="input" value={a.name} onChange={(e) => editAction(a.id, { name: e.target.value })} />
                </td>
                <td>{meterSelect(a.meterId, (meterId) => meterId && editAction(a.id, { meterId }))}</td>
                <td>
                  <NumberInput value={a.amount} onChange={(amount) => editAction(a.id, { amount })} />
                </td>
                <td>
                  <NumberInput value={a.every} min={0.25} onChange={(every) => editAction(a.id, { every })} />
                </td>
                <td>
                  <div className="ld-inline">
                    <NumberInput value={a.cost} min={0} onChange={(cost) => editAction(a.id, { cost })} />
                    <select className="input" value={a.costCurrencyId ?? ''} onChange={(e) => editAction(a.id, { costCurrencyId: e.target.value || null })}>
                      <option value="">free</option>
                      {d.currencies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </td>
                <td>
                  <button className="icon-btn" aria-label="Remove action" onClick={() => set((x) => ({ ...x, meterActions: (x.meterActions ?? []).filter((o) => o.id !== a.id) }))}>
                    <X size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="btn btn-ghost eco-add" onClick={() => set((x) => ({ ...x, meterActions: [...(x.meterActions ?? []), { id: newId(), name: 'Rest', meterId: meters[0].id, amount: 30, every: 4, costCurrencyId: null, cost: 0 }] }))}>
          <Plus size={14} /> Add action
        </button>
        <p className="muted">An action with a cost is paid from that currency on the Money tab every time it happens.</p>
      </section>

      <section>
        <h3>Over {d.hours} hours of play</h3>
        <LineChart xs={r.times} series={meters.map((m) => ({ name: m.name, values: r.values[m.id] }))} xLabel="Hours played" />
        {warnings.length === 0 ? (
          <p className="muted">No meter falls below one of its levels.</p>
        ) : (
          warnings.map(({ m, t, hour, hours }) => (
            <p key={t.id} className="eco-warn">
              {name(m.id)} falls below {t.below} ({t.name}) at hour {hour} and stays there for {hours} of {d.hours} hours.
            </p>
          ))
        )}
      </section>
    </div>
  )
}
