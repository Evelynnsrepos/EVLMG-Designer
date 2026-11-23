import { Plus, X } from 'lucide-react'
import { newId } from '@/core/model'
import { useDocument } from '@/core/state'
import { emptyStatusDoc, STATUS_DOC, type StatusDoc, type StatusEffect } from '@/components/status-effects/model'
import { LineChart, NumberInput } from '@/shared/calculators'
import { localized } from '@/shared/i18n'
import {
  DEFAULT_PROFILES,
  fuelExample,
  meterProfile,
  meterVar,
  moodExample,
  realHoursToFill,
  refillExample,
  simulateMeters,
  stepsOf,
  survivalExample,
  type EconomyDoc,
  type Meter,
  type MeterAction,
  type MeterThreshold,
} from './model'

const T = localized(
  {
    intro: 'Meters are bars that change over time: hunger or thirst, stamina, mood, stress, heat, fuel, sanity, crowd hype, or energy that refills while the game is closed.',
    examples: 'Start from an example:',
    survival: 'Survival needs',
    mood: 'Mood and stress',
    fuel: 'Fuel tank',
    refill: 'Energy that refills',
    addExample: 'Add an example…',
    addMeter: 'Add a meter',
    meters: 'Meters',
    meter: 'Meter',
    start: 'start',
    max: 'max',
    perHour: 'per hour',
    orFormula: 'or formula',
    formulaTip: (names: string) => `Optional change per hour as a formula, replaces the number. Names: t = hours played, v = this meter, max, and the other meters: ${names}. Example: -2 - 0.05 * Stress`,
    offline: 'also while the game is closed',
    offlineTip: 'Keeps changing between play sessions, like energy that refills over the day',
    offlineNote: (h: number, dir: string, profile: string) => `${dir}: ${h} real hours. Simulated with ${profile} players closing the game after each session.`,
    emptyToFull: 'From empty to full',
    fullToEmpty: 'From full to empty',
    removeMeter: 'Remove meter',
    when: { below: 'below', above: 'above', empty: 'is empty', full: 'is full' },
    name: 'Name',
    noEffect: 'No status effect',
    effectTip: 'A Status Effect it puts on the player while active; shown in the results',
    changes: 'changes',
    noOther: 'no other meter',
    by: 'by',
    removeLevel: 'Remove level',
    addLevel: 'When it…',
    actions: 'Actions that change them',
    action: 'Action',
    change: 'Change',
    howOften: 'When',
    clock: 'every … hours',
    onBelow: 'when below …',
    onAbove: 'when above …',
    atMost: 'at most every',
    hours: 'h',
    costs: 'Costs',
    free: 'free',
    removeAction: 'Remove action',
    addAction: 'Add action',
    costNote: 'An action with a cost is paid from that currency on the Money tab every time it happens.',
    rounded: (h: number) => `The simulation moves in quarter hours, so this happens every ${h} h.`,
    profile: 'Players for the time between sessions:',
    profileTip: 'Offline meters keep changing for the rest of the day after each session of this player type (see Players on the Money tab)',
    perDay: 'h/day',
    over: (h: number) => `Over ${h} hours of play`,
    hoursPlayed: 'Hours played',
    nothing: 'No meter reaches one of its levels.',
    warn: (meter: string, level: string, what: string, hour: number, hours: number, total: number) => `${meter} ${what} (${level}) at hour ${hour} and stays there for ${hours} of ${total} hours.`,
    whatBelow: (n: number) => `falls below ${n}`,
    whatAbove: (n: number) => `rises above ${n}`,
    whatEmpty: 'runs empty',
    whatFull: 'is full',
    effectLine: (name: string, hours: number, what: string) => `Puts ${name} on the player for ${hours} hours${what ? `: ${what}` : ''}.`,
    stops: "can't act",
    ticks: (amount: number, every: number, heal: boolean) => `${heal ? 'heals' : 'deals'} ${amount} every ${every} s`,
    fired: (name: string, n: number) => `${name} happens ${n} times.`,
    newMeter: 'New meter',
    newAction: 'New action',
    low: 'Low',
  },
  {
    intro: 'Leisten sind Balken, die sich mit der Zeit ändern: Hunger oder Durst, Ausdauer, Laune, Stress, Hitze, Treibstoff, Verstand, Stimmung im Publikum oder Energie, die sich auflädt, während das Spiel geschlossen ist.',
    examples: 'Mit einem Beispiel anfangen:',
    survival: 'Überleben',
    mood: 'Laune und Stress',
    fuel: 'Tank',
    refill: 'Energie, die sich auflädt',
    addExample: 'Beispiel hinzufügen …',
    addMeter: 'Leiste hinzufügen',
    meters: 'Leisten',
    meter: 'Leiste',
    start: 'Start',
    max: 'Max',
    perHour: 'pro Stunde',
    orFormula: 'oder Formel',
    formulaTip: (names: string) => `Freiwillig: die Änderung pro Stunde als Formel, ersetzt die Zahl. Namen: t = gespielte Stunden, v = diese Leiste, max und die anderen Leisten: ${names}. Beispiel: -2 - 0.05 * Stress`,
    offline: 'auch bei geschlossenem Spiel',
    offlineTip: 'Ändert sich weiter zwischen den Spielrunden, wie Energie, die sich über den Tag auflädt',
    offlineNote: (h: number, dir: string, profile: string) => `${dir}: ${h} echte Stunden. Simuliert mit Spielern der Art ${profile}, die das Spiel nach jeder Runde schließen.`,
    emptyToFull: 'Von leer bis voll',
    fullToEmpty: 'Von voll bis leer',
    removeMeter: 'Leiste entfernen',
    when: { below: 'unter', above: 'über', empty: 'ist leer', full: 'ist voll' },
    name: 'Name',
    noEffect: 'Kein Zustand',
    effectTip: 'Ein Zustand (Status Effects), den der Spieler bekommt, solange es gilt; steht in den Ergebnissen',
    changes: 'ändert',
    noOther: 'keine andere Leiste',
    by: 'um',
    removeLevel: 'Stufe entfernen',
    addLevel: 'Wenn sie …',
    actions: 'Aktionen, die sie ändern',
    action: 'Aktion',
    change: 'Änderung',
    howOften: 'Wann',
    clock: 'alle … Stunden',
    onBelow: 'wenn unter …',
    onAbove: 'wenn über …',
    atMost: 'höchstens alle',
    hours: 'h',
    costs: 'Kosten',
    free: 'kostenlos',
    removeAction: 'Aktion entfernen',
    addAction: 'Aktion hinzufügen',
    costNote: 'Eine Aktion mit Kosten wird jedes Mal auf dem Geld-Reiter von dieser Währung bezahlt.',
    rounded: (h: number) => `Die Simulation rechnet in Viertelstunden, darum passiert das alle ${h} h.`,
    profile: 'Spieler für die Zeit zwischen den Runden:',
    profileTip: 'Leisten mit „auch bei geschlossenem Spiel“ ändern sich nach jeder Runde dieser Spielerart für den Rest des Tages weiter (siehe Spieler auf dem Geld-Reiter)',
    perDay: 'h/Tag',
    over: (h: number) => `Über ${h} Spielstunden`,
    hoursPlayed: 'Gespielte Stunden',
    nothing: 'Keine Leiste erreicht eine ihrer Stufen.',
    warn: (meter: string, level: string, what: string, hour: number, hours: number, total: number) => `${meter} ${what} (${level}) in Stunde ${hour} und bleibt dort ${hours} von ${total} Stunden.`,
    whatBelow: (n: number) => `fällt unter ${n}`,
    whatAbove: (n: number) => `steigt über ${n}`,
    whatEmpty: 'ist leer',
    whatFull: 'ist voll',
    effectLine: (name: string, hours: number, what: string) => `Gibt dem Spieler ${name} für ${hours} Stunden${what ? `: ${what}` : ''}.`,
    stops: 'kann nicht handeln',
    ticks: (amount: number, every: number, heal: boolean) => `${heal ? 'heilt' : 'macht'} ${amount} alle ${every} s`,
    fired: (name: string, n: number) => `${name} passiert ${n}-mal.`,
    newMeter: 'Neue Leiste',
    newAction: 'Neue Aktion',
    low: 'Niedrig',
  },
)

/** What a Status Effect does, in a few words, for the results. */
const effectSummary = (e: StatusEffect) =>
  [...e.stats.map((s) => `${s.stat} ${s.percent > 0 ? '+' : ''}${s.percent}%`), e.tick ? T.ticks(e.tick.amount, e.tick.every, e.tick.heal) : '', e.stops ? T.stops : ''].filter(Boolean).join(', ')

/** Missing tools phase 3: the Meters tab of the Economy Simulator. */
export function Meters({ d, set }: { d: EconomyDoc; set(fn: (d: EconomyDoc) => EconomyDoc): void }) {
  const effects = useDocument<StatusDoc>(STATUS_DOC.type, STATUS_DOC.id, emptyStatusDoc).data?.items ?? []
  const meters = d.meters ?? []
  const actions = d.meterActions ?? []
  const r = simulateMeters(d)
  const profiles = d.profiles ?? DEFAULT_PROFILES
  const prof = meterProfile(d)
  const editMeter = (id: string, p: Partial<Meter>) => set((x) => ({ ...x, meters: (x.meters ?? []).map((m) => (m.id === id ? { ...m, ...p } : m)) }))
  const editTh = (m: Meter, id: string, p: Partial<MeterThreshold>) => editMeter(m.id, { thresholds: m.thresholds.map((t) => (t.id === id ? { ...t, ...p } : t)) })
  const editAction = (id: string, p: Partial<MeterAction>) => set((x) => ({ ...x, meterActions: (x.meterActions ?? []).map((a) => (a.id === id ? { ...a, ...p } : a)) }))
  const name = (id: string | null) => meters.find((m) => m.id === id)?.name ?? '?'
  const meterSelect = (value: string | null, onChange: (v: string | null) => void, none?: string) => (
    <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} aria-label={T.meter}>
      {none && <option value="">{none}</option>}
      {meters.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  )
  const addMeter = () => set((x) => ({ ...x, meters: [...(x.meters ?? []), { id: newId(), name: T.newMeter, start: 100, max: 100, perHour: -10, offline: false, thresholds: [] }] }))
  const examples = {
    survival: [T.survival, survivalExample],
    mood: [T.mood, moodExample],
    fuel: [T.fuel, () => fuelExample(d.currencies[0]?.id ?? null)],
    refill: [T.refill, refillExample],
  } as const
  // Examples add to what is there, so a designer can combine them.
  const addExample = (k: keyof typeof examples) => {
    const e = examples[k][1]()
    set((x) => ({ ...x, meters: [...(x.meters ?? []), ...(e.meters ?? [])], meterActions: [...(x.meterActions ?? []), ...(e.meterActions ?? [])] }))
  }

  if (!meters.length)
    return (
      <div className="eco-body">
        <p>{T.intro}</p>
        <p className="muted">{T.examples}</p>
        <div className="ld-inline eco-examples">
          {(Object.keys(examples) as (keyof typeof examples)[]).map((k, i) => (
            <button key={k} className={`btn ${i === 0 ? 'btn-primary' : 'btn-ghost'}`} onClick={() => addExample(k)}>
              {examples[k][0]}
            </button>
          ))}
          <button className="btn btn-ghost" onClick={addMeter}>
            <Plus size={14} /> {T.addMeter}
          </button>
        </div>
      </div>
    )

  const whatOf = (t: MeterThreshold) => {
    const w = t.when ?? 'below'
    return w === 'below' ? T.whatBelow(t.below) : w === 'above' ? T.whatAbove(t.below) : w === 'empty' ? T.whatEmpty : T.whatFull
  }
  const warnings = meters.flatMap((m) => m.thresholds.filter((t) => r.firstBelow[t.id] !== null).map((t) => ({ m, t, hour: r.firstBelow[t.id]!, hours: r.hoursBelow[t.id] })))
  const varNames = meters.map((m) => meterVar(m.name)).join(', ')
  const roundedNote = (every: number) => (Math.abs(stepsOf(every) * 0.25 - every) > 1e-9 ? <span className="muted eco-note">{T.rounded(stepsOf(every) * 0.25)}</span> : null)

  return (
    <div className="eco-body">
      <section>
        <h3>{T.meters}</h3>
        {meters.map((m) => (
          <div key={m.id} className="eco-meter">
            <div className="ld-inline">
              <input className="input" value={m.name} onChange={(e) => editMeter(m.id, { name: e.target.value })} aria-label={T.meter} />
              <span className="muted">{T.start}</span>
              <NumberInput value={m.start} min={0} onChange={(start) => editMeter(m.id, { start })} />
              <span className="muted">{T.max}</span>
              <NumberInput value={m.max} min={1} onChange={(max) => editMeter(m.id, { max })} />
              <span className="muted">{T.perHour}</span>
              <NumberInput value={m.perHour} onChange={(perHour) => editMeter(m.id, { perHour })} />
              <span className="muted">{T.orFormula}</span>
              <input
                className={`input eco-formula${r.formulaErrors[m.id] ? ' eco-formula-bad' : ''}`}
                value={m.formula ?? ''}
                placeholder="-2 - 0.05 * v"
                title={r.formulaErrors[m.id] ?? T.formulaTip(varNames)}
                aria-label={T.orFormula}
                onChange={(e) => editMeter(m.id, { formula: e.target.value || undefined })}
              />
              <label className="ld-inline" title={T.offlineTip}>
                <input type="checkbox" checked={m.offline} onChange={(e) => editMeter(m.id, { offline: e.target.checked })} /> {T.offline}
              </label>
              <button
                className="icon-btn"
                aria-label={T.removeMeter}
                title={T.removeMeter}
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
            {r.formulaErrors[m.id] && <span className="eco-warn">{r.formulaErrors[m.id]}</span>}
            {m.offline && realHoursToFill(m) !== null && <span className="muted">{T.offlineNote(realHoursToFill(m)!, m.perHour > 0 ? T.emptyToFull : T.fullToEmpty, prof.name)}</span>}
            {m.thresholds.map((t) => {
              const w = t.when ?? 'below'
              return (
                <div key={t.id} className="ld-inline eco-th">
                  <select className="input eco-when" value={w} onChange={(e) => editTh(m, t.id, { when: e.target.value as MeterThreshold['when'] })} aria-label={T.howOften}>
                    {(['below', 'above', 'empty', 'full'] as const).map((k) => (
                      <option key={k} value={k}>
                        {T.when[k]}
                      </option>
                    ))}
                  </select>
                  {(w === 'below' || w === 'above') && <NumberInput value={t.below} min={0} onChange={(below) => editTh(m, t.id, { below })} />}
                  <input className="input" value={t.name} onChange={(e) => editTh(m, t.id, { name: e.target.value })} aria-label={T.name} />
                  {effects.length > 0 && (
                    <select className="input" value={t.effectId ?? ''} onChange={(e) => editTh(m, t.id, { effectId: e.target.value || null })} title={T.effectTip} aria-label={T.effectTip}>
                      <option value="">{T.noEffect}</option>
                      {effects.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <span className="muted">{T.changes}</span>
                  {meterSelect(t.meterId, (meterId) => editTh(m, t.id, { meterId }), T.noOther)}
                  {t.meterId && (
                    <>
                      <span className="muted">{T.by}</span>
                      <NumberInput value={t.perHour} onChange={(perHour) => editTh(m, t.id, { perHour })} />
                      <span className="muted">{T.perHour}</span>
                    </>
                  )}
                  <button className="icon-btn" aria-label={T.removeLevel} title={T.removeLevel} onClick={() => editMeter(m.id, { thresholds: m.thresholds.filter((x) => x.id !== t.id) })}>
                    <X size={13} />
                  </button>
                </div>
              )
            })}
            <button className="btn btn-ghost eco-add eco-th" onClick={() => editMeter(m.id, { thresholds: [...m.thresholds, { id: newId(), below: Math.round(m.max * 0.2), name: T.low, effectId: null, meterId: null, perHour: 0 }] })}>
              <Plus size={14} /> {T.addLevel}
            </button>
          </div>
        ))}
        <div className="ld-inline">
          <button className="btn btn-ghost eco-add" onClick={addMeter}>
            <Plus size={14} /> {T.addMeter}
          </button>
          <select className="input eco-when" value="" onChange={(e) => e.target.value && addExample(e.target.value as keyof typeof examples)} aria-label={T.addExample}>
            <option value="">{T.addExample}</option>
            {(Object.keys(examples) as (keyof typeof examples)[]).map((k) => (
              <option key={k} value={k}>
                {examples[k][0]}
              </option>
            ))}
          </select>
        </div>
        {meters.some((m) => m.offline) && (
          <div className="ld-inline" title={T.profileTip}>
            <span className="muted">{T.profile}</span>
            <select className="input eco-when" value={prof.id} onChange={(e) => set((x) => ({ ...x, meterProfileId: e.target.value }))} aria-label={T.profile}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.hoursPerDay} {T.perDay})
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      <section>
        <h3>{T.actions}</h3>
        <table className="calc-table eco-table">
          <thead>
            <tr>
              <th>{T.action}</th>
              <th>{T.meter}</th>
              <th>{T.change}</th>
              <th>{T.howOften}</th>
              <th>{T.costs}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {actions.map((a) => {
              const w = a.when ?? 'every'
              return (
                <tr key={a.id}>
                  <td>
                    <input className="input" value={a.name} onChange={(e) => editAction(a.id, { name: e.target.value })} aria-label={T.action} />
                  </td>
                  <td>{meterSelect(a.meterId, (meterId) => meterId && editAction(a.id, { meterId }))}</td>
                  <td>
                    <NumberInput value={a.amount} onChange={(amount) => editAction(a.id, { amount })} />
                  </td>
                  <td>
                    <div className="ld-inline">
                      <select className="input eco-when" value={w} onChange={(e) => editAction(a.id, { when: e.target.value as MeterAction['when'], at: a.at ?? Math.round((meters.find((m) => m.id === a.meterId)?.max ?? 100) * 0.3) })} aria-label={T.howOften}>
                        <option value="every">{T.clock}</option>
                        <option value="below">{T.onBelow}</option>
                        <option value="above">{T.onAbove}</option>
                      </select>
                      {w !== 'every' && (
                        <>
                          <NumberInput value={a.at ?? 0} onChange={(at) => editAction(a.id, { at })} />
                          <span className="muted">{T.atMost}</span>
                        </>
                      )}
                      <NumberInput value={a.every} min={0.25} step={0.25} onChange={(every) => editAction(a.id, { every })} />
                      <span className="muted">{T.hours}</span>
                    </div>
                    {roundedNote(a.every)}
                  </td>
                  <td>
                    <div className="ld-inline">
                      <NumberInput value={a.cost} min={0} onChange={(cost) => editAction(a.id, { cost })} />
                      <select className="input" value={a.costCurrencyId ?? ''} onChange={(e) => editAction(a.id, { costCurrencyId: e.target.value || null })} aria-label={T.costs}>
                        <option value="">{T.free}</option>
                        {d.currencies.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td>
                    <button className="icon-btn" aria-label={T.removeAction} title={T.removeAction} onClick={() => set((x) => ({ ...x, meterActions: (x.meterActions ?? []).filter((o) => o.id !== a.id) }))}>
                      <X size={13} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <button className="btn btn-ghost eco-add" onClick={() => set((x) => ({ ...x, meterActions: [...(x.meterActions ?? []), { id: newId(), name: T.newAction, meterId: meters[0].id, amount: 30, every: 4, costCurrencyId: null, cost: 0 }] }))}>
          <Plus size={14} /> {T.addAction}
        </button>
        <p className="muted">{T.costNote}</p>
      </section>

      <section>
        <h3>{T.over(d.hours)}</h3>
        <LineChart xs={r.times} series={meters.map((m) => ({ name: m.name, values: r.values[m.id] }))} xLabel={T.hoursPlayed} />
        {warnings.length === 0 ? (
          <p className="muted">{T.nothing}</p>
        ) : (
          warnings.map(({ m, t, hour, hours }) => {
            const e = t.effectId ? effects.find((x) => x.id === t.effectId) : undefined
            return (
              <div key={t.id}>
                <p className="eco-warn">{T.warn(name(m.id), t.name, whatOf(t), hour, hours, d.hours)}</p>
                {e && <p className="muted eco-note">{T.effectLine(e.name, hours, effectSummary(e))}</p>}
              </div>
            )
          })
        )}
        {actions.some((a) => (a.when ?? 'every') !== 'every') && (
          <p className="muted">
            {actions
              .filter((a) => (a.when ?? 'every') !== 'every')
              .map((a) => T.fired(a.name, r.fired[a.id]?.length ?? 0))
              .join(' ')}
          </p>
        )}
      </section>
    </div>
  )
}
