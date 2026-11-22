import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { newId } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useUndoRedoKeys } from '@/core/state'
import { LineChart, NumberInput, PresetHeader } from '@/shared/calculators'
import { localized, useLang } from '@/shared/i18n'
import '@/shared/listDetail/listDetail.css'
import { createEconomyDoc, daysFor, DEFAULT_PROFILES, newSink, newSource, questGoldSource, simulateEconomy, type EconomyDoc, type Profile, type Sink, type Source } from './model'
import './economy.css'
import { Markets } from './Markets'
import { Meters } from './Meters'

const ECO_TABS = localized(
  { money: 'Money', meters: 'Meters', metersTip: 'Hunger, stamina, energy: bars that change over time', markets: 'Markets', marketsTip: 'Goods, places, trade routes and crafting: plan a trading economy' },
  { money: 'Geld', meters: 'Leisten', metersTip: 'Hunger, Ausdauer, Energie: Leisten, die sich mit der Zeit ändern', markets: 'Märkte', marketsTip: 'Waren, Orte, Handelsrouten und Herstellen: plane eine Handelswirtschaft' },
)

const UI = localized(
  {
    currencies: 'Currencies',
    startWith: 'start with',
    removeCurrency: 'Remove currency',
    addCurrency: 'Add currency',
    newCurrency: 'Gems',
    sources: 'Sources: where it comes from',
    source: 'Source',
    currency: 'Currency',
    perHour: 'Per hour',
    grows: 'Grows % per hour',
    fromHour: 'From hour',
    orFormula: 'Or a formula',
    formulaTip: 'Optional. Uses t = hours played, n = times paid (sinks). Example: 200 + 50 * floor(t / 5). Replaces the fixed amount.',
    formulaFieldTip: 't = hours played, n = times paid so far',
    formula: 'Formula',
    removeSource: 'Remove source',
    addSource: 'Add source',
    questGold: 'Add quest gold',
    questGoldTip: "Every quest's gold reward added up and spread over the hours of play",
    sinks: 'Sinks: where it goes',
    sink: 'Sink',
    cost: 'Cost',
    howOften: 'How often',
    once: 'Once, when affordable',
    every: 'Every … hours',
    steady: 'Per hour, steadily',
    removeSink: 'Remove sink',
    addSink: 'Add sink',
    simulate: 'Simulate',
    hoursOfPlay: 'hours of play',
    hoursPlayed: 'Hours played',
    players: 'Players:',
    playersTip: 'How long players of each kind take in real days, for the times below',
    playerType: 'Player type',
    perDay: 'h/day',
    atEnd: (c: string) => `${c} at the end`,
    earnedSpent: (e: string, s: string, pct: number) => `earned ${e}, spent ${s} (${pct}%)`,
    notAffordable: (h: number) => `not affordable in ${h} hours`,
    affordable: (h: number, days: string) => `affordable after ${h} hours (${days})`,
    cannotPay: (name: string, h: number) => `The player cannot pay for ${name} at hour ${h}.`,
    inflation: (c: string) => `Players spend less than half of the ${c} they earn, so it piles up and loses meaning (inflation). Add sinks or lower income.`,
    days: 'd',
  },
  {
    currencies: 'Währungen',
    startWith: 'Startwert',
    removeCurrency: 'Währung entfernen',
    addCurrency: 'Währung hinzufügen',
    newCurrency: 'Edelsteine',
    sources: 'Quellen: woher es kommt',
    source: 'Quelle',
    currency: 'Währung',
    perHour: 'Pro Stunde',
    grows: 'Wächst % pro Stunde',
    fromHour: 'Ab Stunde',
    orFormula: 'Oder eine Formel',
    formulaTip: 'Freiwillig. t = gespielte Stunden, n = wie oft schon bezahlt (Ausgaben). Beispiel: 200 + 50 * floor(t / 5). Ersetzt den festen Betrag.',
    formulaFieldTip: 't = gespielte Stunden, n = wie oft schon bezahlt',
    formula: 'Formel',
    removeSource: 'Quelle entfernen',
    addSource: 'Quelle hinzufügen',
    questGold: 'Quest-Gold hinzufügen',
    questGoldTip: 'Das Gold aller Quests zusammengezählt und über die Spielstunden verteilt',
    sinks: 'Ausgaben: wohin es geht',
    sink: 'Ausgabe',
    cost: 'Kosten',
    howOften: 'Wie oft',
    once: 'Einmal, sobald bezahlbar',
    every: 'Alle … Stunden',
    steady: 'Pro Stunde, gleichmäßig',
    removeSink: 'Ausgabe entfernen',
    addSink: 'Ausgabe hinzufügen',
    simulate: 'Simuliere',
    hoursOfPlay: 'Spielstunden',
    hoursPlayed: 'Gespielte Stunden',
    players: 'Spieler:',
    playersTip: 'Wie viele echte Tage jede Art Spieler für die Zeiten unten braucht',
    playerType: 'Spielerart',
    perDay: 'h/Tag',
    atEnd: (c: string) => `${c} am Ende`,
    earnedSpent: (e: string, s: string, pct: number) => `verdient ${e}, ausgegeben ${s} (${pct}%)`,
    notAffordable: (h: number) => `in ${h} Stunden nicht bezahlbar`,
    affordable: (h: number, days: string) => `bezahlbar nach ${h} Stunden (${days})`,
    cannotPay: (name: string, h: number) => `Der Spieler kann ${name} in Stunde ${h} nicht bezahlen.`,
    inflation: (c: string) => `Spieler geben weniger als die Hälfte ihres ${c} aus. Es häuft sich an und verliert seinen Wert (Inflation). Füge Ausgaben hinzu oder senke die Einnahmen.`,
    days: 'T',
  },
)

const fmt = (n: number) => Math.round(n).toLocaleString()

/** Economy simulator (v0.10, overhaul 0.35): currency sources and sinks over hours of play, meters and markets. */
export default function View({ documentId, active }: PanelProps) {
  useLang()
  const doc = useDocument<EconomyDoc>('economy', documentId!, createEconomyDoc)
  useUndoRedoKeys(doc, active)
  const [tab, setTab] = useState<'money' | 'meters' | 'markets'>('money')
  const quests = useDocument<{ quests: { rewardGold: number }[] }>('quests', 'quests', () => ({ quests: [] })).data?.quests ?? []
  if (!doc.data) return null
  const d = doc.data
  const set = (fn: (d: EconomyDoc) => EconomyDoc) => doc.update(fn)
  const r = simulateEconomy(d)
  const profiles = d.profiles ?? DEFAULT_PROFILES
  const editProfile = (id: string, patch: Partial<Profile>) => set((x) => ({ ...x, profiles: (x.profiles ?? DEFAULT_PROFILES).map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
  const days = (hours: number) => profiles.map((p) => `${p.name} ${daysFor(hours, p)} ${UI.days}`).join(' · ')
  const cur = (id: string) => d.currencies.find((c) => c.id === id)?.name ?? '?'
  const editSource = (id: string, patch: Partial<Source>) => set((x) => ({ ...x, sources: x.sources.map((s) => (s.id === id ? { ...s, ...patch } : s)) }))
  const editSink = (id: string, patch: Partial<Sink>) => set((x) => ({ ...x, sinks: x.sinks.map((s) => (s.id === id ? { ...s, ...patch } : s)) }))
  const currencySelect = (value: string, onChange: (v: string) => void) => (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-label={UI.currency}>
      {d.currencies.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  )
  const firstCurrency = d.currencies[0]?.id ?? ''
  const formulaInput = (id: string, value: string | undefined, onChange: (v: string) => void, example: string) => (
    <input className={`input eco-formula${r.formulaErrors[id] ? ' eco-formula-bad' : ''}`} value={value ?? ''} placeholder={example} title={r.formulaErrors[id] ?? UI.formulaFieldTip} aria-label={UI.formula} onChange={(e) => onChange(e.target.value)} />
  )
  const tabButton = (id: typeof tab, label: string, title?: string) => (
    <button role="tab" aria-selected={tab === id} className={`btn btn-ghost${tab === id ? ' on' : ''}`} onClick={() => setTab(id)} title={title}>
      {label}
    </button>
  )

  return (
    <div className="eco">
      <div className="eco-head">
        <PresetHeader documentId={documentId!} kind="Economy" undo={doc.undo} redo={doc.redo} canUndo={doc.canUndo} canRedo={doc.canRedo} />
        <div className="eco-tabs" role="tablist">
          {tabButton('money', ECO_TABS.money)}
          {tabButton('meters', `${ECO_TABS.meters}${d.meters?.length ? ` (${d.meters.length})` : ''}`, ECO_TABS.metersTip)}
          {tabButton('markets', `${ECO_TABS.markets}${d.market?.places.length ? ` (${d.market.places.length})` : ''}`, ECO_TABS.marketsTip)}
        </div>
      </div>
      {tab === 'meters' ? (
        <Meters d={d} set={set} />
      ) : tab === 'markets' ? (
        <Markets d={d} set={set} toMoney={() => setTab('money')} />
      ) : (
        <div className="eco-body">
          <section>
            <h3>{UI.currencies}</h3>
            {d.currencies.map((c) => (
              <div key={c.id} className="ld-inline">
                <input className="input" value={c.name} onChange={(e) => set((x) => ({ ...x, currencies: x.currencies.map((o) => (o.id === c.id ? { ...o, name: e.target.value } : o)) }))} />
                <span className="muted">{UI.startWith}</span>
                <NumberInput value={c.start} min={0} onChange={(start) => set((x) => ({ ...x, currencies: x.currencies.map((o) => (o.id === c.id ? { ...o, start } : o)) }))} />
                {d.currencies.length > 1 && (
                  <button
                    className="icon-btn"
                    aria-label={UI.removeCurrency}
                    onClick={() => set((x) => ({ ...x, currencies: x.currencies.filter((o) => o.id !== c.id), sources: x.sources.filter((s) => s.currencyId !== c.id), sinks: x.sinks.filter((s) => s.currencyId !== c.id) }))}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            ))}
            <button className="btn btn-ghost eco-add" onClick={() => set((x) => ({ ...x, currencies: [...x.currencies, { id: newId(), name: UI.newCurrency, start: 0 }] }))}>
              <Plus size={14} /> {UI.addCurrency}
            </button>
          </section>

          <section>
            <h3>{UI.sources}</h3>
            <div className="eco-scroll">
              <table className="calc-table eco-table">
                <thead>
                  <tr>
                    <th>{UI.source}</th>
                    <th>{UI.currency}</th>
                    <th>{UI.perHour}</th>
                    <th>{UI.grows}</th>
                    <th>{UI.fromHour}</th>
                    <th title={UI.formulaTip}>{UI.orFormula}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {d.sources.map((s) => (
                    <tr key={s.id} className={s.formula?.trim() ? 'eco-uses-formula' : undefined}>
                      <td>
                        <input className="input" value={s.name} onChange={(e) => editSource(s.id, { name: e.target.value })} />
                      </td>
                      <td>{currencySelect(s.currencyId, (currencyId) => editSource(s.id, { currencyId }))}</td>
                      <td className="eco-fixed">
                        <NumberInput value={s.perHour} onChange={(perHour) => editSource(s.id, { perHour })} />
                      </td>
                      <td className="eco-fixed">
                        <NumberInput value={s.growth} onChange={(growth) => editSource(s.id, { growth })} />
                      </td>
                      <td>
                        <NumberInput value={s.fromHour} min={0} onChange={(fromHour) => editSource(s.id, { fromHour })} />
                      </td>
                      <td>{formulaInput(s.id, s.formula, (formula) => editSource(s.id, { formula }), '300 * 1.02 ^ t')}</td>
                      <td>
                        <button className="icon-btn" aria-label={UI.removeSource} onClick={() => set((x) => ({ ...x, sources: x.sources.filter((o) => o.id !== s.id) }))}>
                          <X size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="ld-inline">
              <button className="btn btn-ghost eco-add" onClick={() => set((x) => ({ ...x, sources: [...x.sources, newSource(firstCurrency)] }))}>
                <Plus size={14} /> {UI.addSource}
              </button>
              {quests.length > 0 && (
                <button className="btn btn-ghost eco-add" title={UI.questGoldTip} onClick={() => set((x) => ({ ...x, sources: [...x.sources, questGoldSource(quests, x, firstCurrency)] }))}>
                  <Plus size={14} /> {UI.questGold}
                </button>
              )}
            </div>
          </section>

          <section>
            <h3>{UI.sinks}</h3>
            <div className="eco-scroll">
              <table className="calc-table eco-table">
                <thead>
                  <tr>
                    <th>{UI.sink}</th>
                    <th>{UI.currency}</th>
                    <th>{UI.cost}</th>
                    <th>{UI.howOften}</th>
                    <th>{UI.fromHour}</th>
                    <th title={UI.formulaTip}>{UI.orFormula}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {d.sinks.map((s) => (
                    <tr key={s.id} className={s.formula?.trim() ? 'eco-uses-formula' : undefined}>
                      <td>
                        <input className="input" value={s.name} onChange={(e) => editSink(s.id, { name: e.target.value })} />
                      </td>
                      <td>{currencySelect(s.currencyId, (currencyId) => editSink(s.id, { currencyId }))}</td>
                      <td className="eco-fixed">
                        <NumberInput value={s.cost} min={0} onChange={(cost) => editSink(s.id, { cost })} />
                      </td>
                      <td className="ld-inline">
                        <select className="input" value={s.kind} onChange={(e) => editSink(s.id, { kind: e.target.value as Sink['kind'] })} aria-label={UI.howOften}>
                          <option value="once">{UI.once}</option>
                          <option value="every">{UI.every}</option>
                          <option value="perHour">{UI.steady}</option>
                        </select>
                        {s.kind === 'every' && <NumberInput value={s.hours} min={0.25} onChange={(hours) => editSink(s.id, { hours })} />}
                      </td>
                      <td>
                        <NumberInput value={s.fromHour} min={0} onChange={(fromHour) => editSink(s.id, { fromHour })} />
                      </td>
                      <td>{formulaInput(s.id, s.formula, (formula) => editSink(s.id, { formula }), '100 * 1.15 ^ n')}</td>
                      <td>
                        <button className="icon-btn" aria-label={UI.removeSink} onClick={() => set((x) => ({ ...x, sinks: x.sinks.filter((o) => o.id !== s.id) }))}>
                          <X size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn btn-ghost eco-add" onClick={() => set((x) => ({ ...x, sinks: [...x.sinks, newSink(firstCurrency)] }))}>
              <Plus size={14} /> {UI.addSink}
            </button>
          </section>

          <section>
            <h3 className="ld-inline">
              {UI.simulate}
              <NumberInput value={d.hours} min={1} max={1000} onChange={(hours) => set((x) => ({ ...x, hours: Math.max(1, hours) }))} /> {UI.hoursOfPlay}
            </h3>
            <LineChart xs={r.times} series={d.currencies.map((c) => ({ name: c.name, values: r.balance[c.id] }))} xLabel={UI.hoursPlayed} />
            <p className="ld-inline muted eco-profiles" title={UI.playersTip}>
              {UI.players}
              {profiles.map((p) => (
                <span key={p.id} className="ld-inline">
                  <input className="input" style={{ width: 80 }} value={p.name} onChange={(e) => editProfile(p.id, { name: e.target.value })} aria-label={UI.playerType} />
                  <NumberInput value={p.hoursPerDay} min={0.1} max={24} onChange={(hoursPerDay) => editProfile(p.id, { hoursPerDay })} /> {UI.perDay}
                </span>
              ))}
            </p>
            <div className="ld-result">
              {d.currencies.map((c) => {
                const end = r.balance[c.id][r.balance[c.id].length - 1]
                const ratio = r.earned[c.id] ? r.spent[c.id] / r.earned[c.id] : 0
                return (
                  <div key={c.id} className="ld-stat">
                    <span>{UI.atEnd(c.name)}</span>
                    <strong>{fmt(end)}</strong>
                    <span>{UI.earnedSpent(fmt(r.earned[c.id]), fmt(r.spent[c.id]), Math.round(ratio * 100))}</span>
                  </div>
                )
              })}
            </div>
            {d.sinks
              .filter((s) => s.kind === 'once')
              .map((s) => (
                <p key={s.id}>
                  {s.name} ({fmt(s.cost)} {cur(s.currencyId)}): {r.bought[s.id] === null ? <span className="eco-bad">{UI.notAffordable(d.hours)}</span> : UI.affordable(r.bought[s.id]!, days(r.bought[s.id]!))}
                </p>
              ))}
            {r.shortfalls.map((x) => (
              <p key={x.sinkId} className="eco-bad">
                {UI.cannotPay((d.sinks.find((s) => s.id === x.sinkId) ?? d.meterActions?.find((s) => s.id === x.sinkId))?.name ?? '?', x.hour)}
              </p>
            ))}
            {d.currencies.map((c) =>
              r.earned[c.id] > 0 && r.spent[c.id] / r.earned[c.id] < 0.5 ? (
                <p key={c.id} className="eco-warn">
                  {UI.inflation(c.name)}
                </p>
              ) : null,
            )}
          </section>
        </div>
      )}
    </div>
  )
}
