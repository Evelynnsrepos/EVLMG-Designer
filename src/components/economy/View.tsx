import { Plus, X } from 'lucide-react'
import { newId } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useUndoRedoKeys } from '@/core/state'
import { LineChart, NumberInput, PresetHeader } from '@/shared/calculators'
import '@/shared/listDetail/listDetail.css'
import { createEconomyDoc, daysFor, DEFAULT_PROFILES, newSink, newSource, questGoldSource, simulateEconomy, type EconomyDoc, type Profile, type Sink, type Source } from './model'
import './economy.css'

const fmt = (n: number) => Math.round(n).toLocaleString()

/** Economy simulator (v0.10): currency sources and sinks over hours of play. */
export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<EconomyDoc>('economy', documentId!, createEconomyDoc)
  useUndoRedoKeys(doc, active)
  const quests = useDocument<{ quests: { rewardGold: number }[] }>('quests', 'quests', () => ({ quests: [] })).data?.quests ?? []
  if (!doc.data) return null
  const d = doc.data
  const set = (fn: (d: EconomyDoc) => EconomyDoc) => doc.update(fn)
  const r = simulateEconomy(d)
  const profiles = d.profiles ?? DEFAULT_PROFILES
  const editProfile = (id: string, patch: Partial<Profile>) => set((x) => ({ ...x, profiles: (x.profiles ?? DEFAULT_PROFILES).map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
  const days = (hours: number) => profiles.map((p) => `${p.name} ${daysFor(hours, p)} d`).join(' · ')
  const cur = (id: string) => d.currencies.find((c) => c.id === id)?.name ?? '?'
  const editSource = (id: string, patch: Partial<Source>) => set((x) => ({ ...x, sources: x.sources.map((s) => (s.id === id ? { ...s, ...patch } : s)) }))
  const editSink = (id: string, patch: Partial<Sink>) => set((x) => ({ ...x, sinks: x.sinks.map((s) => (s.id === id ? { ...s, ...patch } : s)) }))
  const currencySelect = (value: string, onChange: (v: string) => void) => (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      {d.currencies.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  )
  const firstCurrency = d.currencies[0]?.id ?? ''

  return (
    <div className="eco">
      <div className="eco-head">
        <PresetHeader documentId={documentId!} kind="Economy" undo={doc.undo} redo={doc.redo} canUndo={doc.canUndo} canRedo={doc.canRedo} />
      </div>
      <div className="eco-body">
        <section>
          <h3>Currencies</h3>
          {d.currencies.map((c) => (
            <div key={c.id} className="ld-inline">
              <input className="input" value={c.name} onChange={(e) => set((x) => ({ ...x, currencies: x.currencies.map((o) => (o.id === c.id ? { ...o, name: e.target.value } : o)) }))} />
              <span className="muted">start with</span>
              <NumberInput value={c.start} min={0} onChange={(start) => set((x) => ({ ...x, currencies: x.currencies.map((o) => (o.id === c.id ? { ...o, start } : o)) }))} />
              {d.currencies.length > 1 && (
                <button
                  className="icon-btn"
                  aria-label="Remove currency"
                  onClick={() => set((x) => ({ ...x, currencies: x.currencies.filter((o) => o.id !== c.id), sources: x.sources.filter((s) => s.currencyId !== c.id), sinks: x.sinks.filter((s) => s.currencyId !== c.id) }))}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
          <button className="btn btn-ghost eco-add" onClick={() => set((x) => ({ ...x, currencies: [...x.currencies, { id: newId(), name: 'Gems', start: 0 }] }))}>
            <Plus size={14} /> Add currency
          </button>
        </section>

        <section>
          <h3>Sources: where it comes from</h3>
          <table className="calc-table eco-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Currency</th>
                <th>Per hour</th>
                <th>Grows % per hour</th>
                <th>From hour</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.sources.map((s) => (
                <tr key={s.id}>
                  <td>
                    <input className="input" value={s.name} onChange={(e) => editSource(s.id, { name: e.target.value })} />
                  </td>
                  <td>{currencySelect(s.currencyId, (currencyId) => editSource(s.id, { currencyId }))}</td>
                  <td>
                    <NumberInput value={s.perHour} onChange={(perHour) => editSource(s.id, { perHour })} />
                  </td>
                  <td>
                    <NumberInput value={s.growth} onChange={(growth) => editSource(s.id, { growth })} />
                  </td>
                  <td>
                    <NumberInput value={s.fromHour} min={0} onChange={(fromHour) => editSource(s.id, { fromHour })} />
                  </td>
                  <td>
                    <button className="icon-btn" aria-label="Remove source" onClick={() => set((x) => ({ ...x, sources: x.sources.filter((o) => o.id !== s.id) }))}>
                      <X size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn btn-ghost eco-add" onClick={() => set((x) => ({ ...x, sources: [...x.sources, newSource(firstCurrency)] }))}>
            <Plus size={14} /> Add source
          </button>
          {quests.length > 0 && (
            <button className="btn btn-ghost eco-add" title="Every quest's gold reward added up and spread over the hours of play" onClick={() => set((x) => ({ ...x, sources: [...x.sources, questGoldSource(quests, x, firstCurrency)] }))}>
              <Plus size={14} /> Add quest gold
            </button>
          )}
        </section>

        <section>
          <h3>Sinks: where it goes</h3>
          <table className="calc-table eco-table">
            <thead>
              <tr>
                <th>Sink</th>
                <th>Currency</th>
                <th>Cost</th>
                <th>How often</th>
                <th>From hour</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.sinks.map((s) => (
                <tr key={s.id}>
                  <td>
                    <input className="input" value={s.name} onChange={(e) => editSink(s.id, { name: e.target.value })} />
                  </td>
                  <td>{currencySelect(s.currencyId, (currencyId) => editSink(s.id, { currencyId }))}</td>
                  <td>
                    <NumberInput value={s.cost} min={0} onChange={(cost) => editSink(s.id, { cost })} />
                  </td>
                  <td className="ld-inline">
                    <select className="input" value={s.kind} onChange={(e) => editSink(s.id, { kind: e.target.value as Sink['kind'] })}>
                      <option value="once">Once, when affordable</option>
                      <option value="every">Every … hours</option>
                      <option value="perHour">Per hour, steadily</option>
                    </select>
                    {s.kind === 'every' && <NumberInput value={s.hours} min={0.25} onChange={(hours) => editSink(s.id, { hours })} />}
                  </td>
                  <td>
                    <NumberInput value={s.fromHour} min={0} onChange={(fromHour) => editSink(s.id, { fromHour })} />
                  </td>
                  <td>
                    <button className="icon-btn" aria-label="Remove sink" onClick={() => set((x) => ({ ...x, sinks: x.sinks.filter((o) => o.id !== s.id) }))}>
                      <X size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn btn-ghost eco-add" onClick={() => set((x) => ({ ...x, sinks: [...x.sinks, newSink(firstCurrency)] }))}>
            <Plus size={14} /> Add sink
          </button>
        </section>

        <section>
          <h3 className="ld-inline">
            Simulate
            <NumberInput value={d.hours} min={1} max={1000} onChange={(hours) => set((x) => ({ ...x, hours: Math.max(1, hours) }))} /> hours of play
          </h3>
          <LineChart xs={r.times} series={d.currencies.map((c) => ({ name: c.name, values: r.balance[c.id] }))} xLabel="Hours played" />
          <p className="ld-inline muted eco-profiles" title="How long players of each kind take in real days, for the times below">
            Players:
            {profiles.map((p) => (
              <span key={p.id} className="ld-inline">
                <input className="input" style={{ width: 80 }} value={p.name} onChange={(e) => editProfile(p.id, { name: e.target.value })} aria-label="Player type" />
                <NumberInput value={p.hoursPerDay} min={0.1} max={24} onChange={(hoursPerDay) => editProfile(p.id, { hoursPerDay })} /> h/day
              </span>
            ))}
          </p>
          <div className="ld-result">
            {d.currencies.map((c) => {
              const end = r.balance[c.id][r.balance[c.id].length - 1]
              const ratio = r.earned[c.id] ? r.spent[c.id] / r.earned[c.id] : 0
              return (
                <div key={c.id} className="ld-stat">
                  <span>{c.name} at the end</span>
                  <strong>{fmt(end)}</strong>
                  <span>
                    earned {fmt(r.earned[c.id])}, spent {fmt(r.spent[c.id])} ({Math.round(ratio * 100)}%)
                  </span>
                </div>
              )
            })}
          </div>
          {d.sinks
            .filter((s) => s.kind === 'once')
            .map((s) => (
              <p key={s.id}>
                {s.name} ({fmt(s.cost)} {cur(s.currencyId)}): {r.bought[s.id] === null ? <span className="eco-bad">not affordable in {d.hours} hours</span> : `affordable after ${r.bought[s.id]} hours (${days(r.bought[s.id]!)})`}
              </p>
            ))}
          {r.shortfalls.map((x) => (
            <p key={x.sinkId} className="eco-bad">
              The player cannot pay for {d.sinks.find((s) => s.id === x.sinkId)?.name} at hour {x.hour}.
            </p>
          ))}
          {d.currencies.map((c) =>
            r.earned[c.id] > 0 && r.spent[c.id] / r.earned[c.id] < 0.5 ? (
              <p key={c.id} className="eco-warn">
                Players spend less than half of the {c.name} they earn, so it piles up and loses meaning (inflation). Add sinks or lower income.
              </p>
            ) : null,
          )}
        </section>
      </div>
    </div>
  )
}
