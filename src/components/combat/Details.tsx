import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { NumberInput } from '@/shared/calculators'
import { localized } from '@/shared/i18n'
import { newBuff, newPhase, parseResist, resistText, type Buff, type Fighter, type Phase } from './model'

const UI = localized(
  {
    stats: 'Extra stats',
    statsTip: "Your own numbers for formulas, like EM, Level or POWER. Use them in a formula by name; the target's are T_ + the name.",
    newStat: 'New stat, e.g. EM',
    addStat: 'Add stat',
    remove: (k: string) => `Remove ${k}`,
    element: 'Element and wave',
    attackElement: 'Attack element',
    attackElementTip: 'Element of the basic attack, for weaknesses and resistances.',
    none: 'none',
    resist: 'Resistances',
    resistTip: 'How much damage it takes per element: 1 normal, 0.5 half, 1.5 weak, 0 immune. Example: Fire 0.5, Ice 1.5',
    wave: 'Wave',
    waveTip: 'Wave 2 comes in when everyone of wave 1 on this team is down.',
    buffs: 'Gives buffs and debuffs',
    buffsTip: 'Buffs and debuffs this fighter gives while it is standing. Special stats: DMG = damage dealt %, TAKEN = damage taken %.',
    addBuff: 'Buff or debuff',
    buffName: 'Name',
    who: 'Who gets it',
    self: 'itself',
    team: 'its team',
    enemies: 'the enemies',
    stat: 'Stat',
    every: 'every',
    lasts: 'lasts',
    turns: 'turns',
    secs: 's',
    uptime: (pct: number) => `on ${pct}% of the time`,
    always: 'always on',
    removeBuff: 'Remove buff',
    phases: 'Phases',
    phasesTip: 'Boss phases: below a HP percent the fighter changes once.',
    addPhase: 'Phase',
    below: 'Below',
    hp: '% HP',
    phaseName: 'Phase name',
    keepResist: 'Empty = keeps its old resistances',
    sameAbilities: 'same abilities',
    uses: (n: string) => `uses ${n}`,
    removePhase: 'Remove phase',
    nothingYet: 'None yet.',
  },
  {
    stats: 'Extra-Werte',
    statsTip: 'Deine eigenen Zahlen für Formeln, wie EM, Level oder POWER. In der Formel mit Namen benutzen; die des Ziels heißen T_ + Name.',
    newStat: 'Neuer Wert, z. B. EM',
    addStat: 'Wert hinzufügen',
    remove: (k: string) => `${k} entfernen`,
    element: 'Element und Welle',
    attackElement: 'Angriffselement',
    attackElementTip: 'Element des normalen Angriffs, für Schwächen und Resistenzen.',
    none: 'keins',
    resist: 'Resistenzen',
    resistTip: 'Wie viel Schaden pro Element ankommt: 1 normal, 0.5 halb, 1.5 schwach, 0 immun. Beispiel: Feuer 0.5, Eis 1.5',
    wave: 'Welle',
    waveTip: 'Welle 2 kommt, wenn alle aus Welle 1 dieses Teams am Boden sind.',
    buffs: 'Gibt Buffs und Debuffs',
    buffsTip: 'Buffs und Debuffs, die dieser Kämpfer gibt, solange er steht. Besondere Werte: DMG = Schaden %, TAKEN = erlittener Schaden %.',
    addBuff: 'Buff oder Debuff',
    buffName: 'Name',
    who: 'Wer bekommt ihn',
    self: 'sich selbst',
    team: 'sein Team',
    enemies: 'die Gegner',
    stat: 'Wert',
    every: 'alle',
    lasts: 'hält',
    turns: 'Runden',
    secs: 's',
    uptime: (pct: number) => `${pct}% der Zeit aktiv`,
    always: 'immer aktiv',
    removeBuff: 'Buff entfernen',
    phases: 'Phasen',
    phasesTip: 'Boss-Phasen: unter einem HP-Prozentwert ändert sich der Kämpfer einmal.',
    addPhase: 'Phase',
    below: 'Unter',
    hp: '% HP',
    phaseName: 'Name der Phase',
    keepResist: 'Leer = behält die alten Resistenzen',
    sameAbilities: 'gleiche Fähigkeiten',
    uses: (n: string) => `benutzt ${n}`,
    removePhase: 'Phase entfernen',
    nothingYet: 'Noch keine.',
  },
)

/** 0.35: the fold under a fighter, in four small glass boxes: extra stats, element and wave, buffs, phases. */
export function FighterDetails({ f, edit, abilities, turns }: { f: Fighter; edit: (patch: Partial<Fighter>) => void; abilities: { id: string; name: string }[]; turns: boolean }) {
  const [newStat, setNewStat] = useState('')
  const stats = f.stats ?? {}
  const per = turns ? UI.turns : UI.secs
  const editBuff = (id: string, patch: Partial<Buff>) => edit({ buffs: (f.buffs ?? []).map((b) => (b.id === id ? { ...b, ...patch } : b)) })
  const editPhase = (id: string, patch: Partial<Phase>) => edit({ phases: (f.phases ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)) })
  const addStat = () => {
    const name = newStat.trim()
    if (name && !(name in stats)) edit({ stats: { ...stats, [name]: 0 } })
    setNewStat('')
  }

  return (
    <div className="cb-details">
      <div className="cb-box">
        <h5 title={UI.statsTip}>{UI.stats}</h5>
        <div className="cb-drow">
          {Object.entries(stats).map(([k, v]) => (
            <span key={k} className="cb-chip">
              {k}
              <NumberInput value={v} onChange={(x) => edit({ stats: { ...stats, [k]: x } })} aria-label={k} />
              <button className="icon-btn" aria-label={UI.remove(k)} onClick={() => edit({ stats: Object.fromEntries(Object.entries(stats).filter(([n]) => n !== k)) })}>
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
        <div className="cb-drow">
          <input className="input cb-short" placeholder={UI.newStat} value={newStat} onChange={(e) => setNewStat(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addStat()} />
          <button className="icon-btn" onClick={addStat} disabled={!newStat.trim()} aria-label={UI.addStat}>
            <Plus size={13} />
          </button>
        </div>
      </div>

      <div className="cb-box">
        <h5>{UI.element}</h5>
        <label className="cb-field" title={UI.attackElementTip}>
          <span>{UI.attackElement}</span>
          <input className="input" value={f.element ?? ''} placeholder={UI.none} onChange={(e) => edit({ element: e.target.value })} />
        </label>
        <label className="cb-field" title={UI.resistTip}>
          <span>{UI.resist}</span>
          <ResistInput value={f.resist} onChange={(resist) => edit({ resist })} />
        </label>
        <label className="cb-field" title={UI.waveTip}>
          <span>{UI.wave}</span>
          <NumberInput value={f.wave ?? 1} min={1} max={20} onChange={(wave) => edit({ wave })} />
        </label>
      </div>

      <div className="cb-box cb-box-wide">
        <h5 title={UI.buffsTip}>
          {UI.buffs}
          <button className="btn btn-ghost cb-add" onClick={() => edit({ buffs: [...(f.buffs ?? []), newBuff()] })}>
            <Plus size={13} /> {UI.addBuff}
          </button>
        </h5>
        {!f.buffs?.length && <p className="cb-muted">{UI.nothingYet}</p>}
        {(f.buffs ?? []).map((b) => (
          <div key={b.id} className="cb-line">
            <input className="input cb-short" value={b.name} onChange={(e) => editBuff(b.id, { name: e.target.value })} aria-label={UI.buffName} />
            <select className="input" value={b.to} onChange={(e) => editBuff(b.id, { to: e.target.value as Buff['to'] })} aria-label={UI.who}>
              <option value="self">{UI.self}</option>
              <option value="team">{UI.team}</option>
              <option value="enemies">{UI.enemies}</option>
            </select>
            <input className="input cb-tiny" value={b.stat} onChange={(e) => editBuff(b.id, { stat: e.target.value })} aria-label={UI.stat} list="cb-stats" />
            <NumberInput value={b.percent} onChange={(percent) => editBuff(b.id, { percent })} aria-label="%" />%
            <span>+</span>
            <NumberInput value={b.flat} onChange={(flat) => editBuff(b.id, { flat })} aria-label="+" />
            <span>{UI.every}</span>
            <NumberInput value={b.every} min={0} onChange={(every) => editBuff(b.id, { every })} aria-label={UI.every} />
            <span>
              {per}, {UI.lasts}
            </span>
            <NumberInput value={b.lasts} min={0} onChange={(lasts) => editBuff(b.id, { lasts })} aria-label={UI.lasts} />
            <span className="cb-pill-note">{b.every > 0 ? UI.uptime(Math.round(Math.min(1, b.lasts / b.every) * 100)) : UI.always}</span>
            <button className="icon-btn" aria-label={UI.removeBuff} onClick={() => edit({ buffs: f.buffs!.filter((x) => x.id !== b.id) })}>
              <X size={12} />
            </button>
          </div>
        ))}
      </div>

      <div className="cb-box cb-box-wide">
        <h5 title={UI.phasesTip}>
          {UI.phases}
          <button className="btn btn-ghost cb-add" onClick={() => edit({ phases: [...(f.phases ?? []), newPhase()] })}>
            <Plus size={13} /> {UI.addPhase}
          </button>
        </h5>
        {!f.phases?.length && <p className="cb-muted">{UI.nothingYet}</p>}
        {(f.phases ?? []).map((p) => (
          <div key={p.id} className="cb-line">
            <span>{UI.below}</span>
            <NumberInput value={p.below} min={0} max={100} onChange={(below) => editPhase(p.id, { below })} aria-label={UI.below} />
            <span>{UI.hp}</span>
            <input className="input cb-name" value={p.name} onChange={(e) => editPhase(p.id, { name: e.target.value })} aria-label={UI.phaseName} />
            <span>ATK</span>
            <NumberInput value={p.atk} onChange={(atk) => editPhase(p.id, { atk })} aria-label="ATK %" />
            <span>% DEF</span>
            <NumberInput value={p.def} onChange={(def) => editPhase(p.id, { def })} aria-label="DEF %" />
            <span>% SPD</span>
            <NumberInput value={p.speed} onChange={(speed) => editPhase(p.id, { speed })} aria-label="SPD %" />
            <span>%</span>
            <label className="cb-inline" title={UI.keepResist}>
              {UI.resist} <ResistInput value={p.resist ?? undefined} onChange={(r) => editPhase(p.id, { resist: Object.keys(r).length ? r : null })} />
            </label>
            {abilities.length > 0 && (
              <select className="input" value={p.abilities?.[0] ?? ''} onChange={(e) => editPhase(p.id, { abilities: e.target.value ? [e.target.value] : null })} aria-label={UI.sameAbilities}>
                <option value="">{UI.sameAbilities}</option>
                {abilities.map((a) => (
                  <option key={a.id} value={a.id}>
                    {UI.uses(a.name)}
                  </option>
                ))}
              </select>
            )}
            <button className="icon-btn" aria-label={UI.removePhase} onClick={() => edit({ phases: f.phases!.filter((x) => x.id !== p.id) })}>
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
      <datalist id="cb-stats">
        {['ATK', 'DEF', 'SPD', 'CRIT', 'CRITDMG', 'DMG', 'TAKEN', ...Object.keys(stats)].map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
    </div>
  )
}

/** Text field for "Fire 0.5, Ice 1.5"; keeps what is typed and saves on leaving the field. */
function ResistInput({ value, onChange }: { value?: Record<string, number>; onChange: (r: Record<string, number>) => void }) {
  const [text, setText] = useState<string | null>(null)
  return <input className="input cb-resist" placeholder="Fire 0.5, Ice 1.5" value={text ?? resistText(value)} onChange={(e) => setText(e.target.value)} onBlur={() => text !== null && (onChange(parseResist(text)), setText(null))} />
}
