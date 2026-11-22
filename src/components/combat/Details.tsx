import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { NumberInput } from '@/shared/calculators'
import { newBuff, newPhase, parseResist, resistText, type Buff, type Fighter, type Phase } from './model'

/** 0.35: the fold under a fighter: extra stats, element, resistances, wave, buffs, phases. */
export function FighterDetails({ f, edit, abilities, turns }: { f: Fighter; edit: (patch: Partial<Fighter>) => void; abilities: { id: string; name: string }[]; turns: boolean }) {
  const [newStat, setNewStat] = useState('')
  const stats = f.stats ?? {}
  const per = turns ? 'turns' : 's'
  const editBuff = (id: string, patch: Partial<Buff>) => edit({ buffs: (f.buffs ?? []).map((b) => (b.id === id ? { ...b, ...patch } : b)) })
  const editPhase = (id: string, patch: Partial<Phase>) => edit({ phases: (f.phases ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)) })
  const addStat = () => {
    const name = newStat.trim()
    if (name && !(name in stats)) edit({ stats: { ...stats, [name]: 0 } })
    setNewStat('')
  }

  return (
    <div className="cb-details">
      <div className="cb-drow">
        <b title="Your own numbers for formulas, like EM, Level or POWER. Use them in a formula by name; the target's are T_ + the name.">Extra stats</b>
        {Object.entries(stats).map(([k, v]) => (
          <span key={k} className="cb-chip">
            {k}
            <NumberInput value={v} onChange={(x) => edit({ stats: { ...stats, [k]: x } })} aria-label={k} />
            <button className="icon-btn" aria-label={`Remove ${k}`} onClick={() => edit({ stats: Object.fromEntries(Object.entries(stats).filter(([n]) => n !== k)) })}>
              <X size={10} />
            </button>
          </span>
        ))}
        <input className="input cb-short" placeholder="New stat name" value={newStat} onChange={(e) => setNewStat(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addStat()} />
        <button className="btn btn-ghost" onClick={addStat} disabled={!newStat.trim()}>
          <Plus size={13} />
        </button>
      </div>
      <div className="cb-drow">
        <label title="Element of the basic attack, for weaknesses and resistances.">
          Attack element <input className="input cb-short" value={f.element ?? ''} placeholder="none" onChange={(e) => edit({ element: e.target.value })} />
        </label>
        <label title="How much damage it takes per element: 1 normal, 0.5 half, 1.5 weak, 0 immune. Example: Fire 0.5, Ice 1.5">
          Resistances <ResistInput value={f.resist} onChange={(resist) => edit({ resist })} />
        </label>
        <label title="Wave 2 comes in when everyone of wave 1 on this team is down.">
          Wave <NumberInput value={f.wave ?? 1} min={1} max={20} onChange={(wave) => edit({ wave })} />
        </label>
      </div>

      <div className="cb-drow">
        <b title="Buffs and debuffs this fighter gives while it is standing. Special stats: DMG = damage dealt %, TAKEN = damage taken %.">Gives buffs</b>
        <button className="btn btn-ghost cb-add" onClick={() => edit({ buffs: [...(f.buffs ?? []), newBuff()] })}>
          <Plus size={13} /> Buff or debuff
        </button>
      </div>
      {(f.buffs ?? []).map((b) => (
        <div key={b.id} className="cb-drow cb-sub">
          <input className="input cb-short" value={b.name} onChange={(e) => editBuff(b.id, { name: e.target.value })} aria-label="Buff name" />
          <select className="input" value={b.to} onChange={(e) => editBuff(b.id, { to: e.target.value as Buff['to'] })} aria-label="Who gets it">
            <option value="self">itself</option>
            <option value="team">its team</option>
            <option value="enemies">the enemies</option>
          </select>
          <input className="input cb-tiny" value={b.stat} onChange={(e) => editBuff(b.id, { stat: e.target.value })} aria-label="Stat" list="cb-stats" />
          <NumberInput value={b.percent} onChange={(percent) => editBuff(b.id, { percent })} aria-label="Percent" />%
          +<NumberInput value={b.flat} onChange={(flat) => editBuff(b.id, { flat })} aria-label="Flat" />
          <span>every</span>
          <NumberInput value={b.every} min={0} onChange={(every) => editBuff(b.id, { every })} aria-label="Every" />
          <span>{per}, lasts</span>
          <NumberInput value={b.lasts} min={0} onChange={(lasts) => editBuff(b.id, { lasts })} aria-label="Lasts" />
          <span className="cb-muted">{b.every > 0 ? `on ${Math.round(Math.min(1, b.lasts / b.every) * 100)}% of the time` : 'always on'}</span>
          <button className="icon-btn" aria-label="Remove buff" onClick={() => edit({ buffs: f.buffs!.filter((x) => x.id !== b.id) })}>
            <X size={12} />
          </button>
        </div>
      ))}

      <div className="cb-drow">
        <b title="Boss phases: below a HP percent the fighter changes once.">Phases</b>
        <button className="btn btn-ghost cb-add" onClick={() => edit({ phases: [...(f.phases ?? []), newPhase()] })}>
          <Plus size={13} /> Phase
        </button>
      </div>
      {(f.phases ?? []).map((p) => (
        <div key={p.id} className="cb-drow cb-sub">
          <span>Below</span>
          <NumberInput value={p.below} min={0} max={100} onChange={(below) => editPhase(p.id, { below })} aria-label="Below HP percent" />
          <span>% HP:</span>
          <input className="input cb-short" value={p.name} onChange={(e) => editPhase(p.id, { name: e.target.value })} aria-label="Phase name" />
          ATK <NumberInput value={p.atk} onChange={(atk) => editPhase(p.id, { atk })} aria-label="ATK percent" />% DEF <NumberInput value={p.def} onChange={(def) => editPhase(p.id, { def })} aria-label="DEF percent" />% Speed{' '}
          <NumberInput value={p.speed} onChange={(speed) => editPhase(p.id, { speed })} aria-label="Speed percent" />%
          <label title="Empty = keeps its old resistances">
            Resistances <ResistInput value={p.resist ?? undefined} onChange={(r) => editPhase(p.id, { resist: Object.keys(r).length ? r : null })} />
          </label>
          {abilities.length > 0 && (
            <select className="input" value={p.abilities?.[0] ?? ''} onChange={(e) => editPhase(p.id, { abilities: e.target.value ? [e.target.value] : null })} aria-label="Ability in this phase">
              <option value="">same abilities</option>
              {abilities.map((a) => (
                <option key={a.id} value={a.id}>
                  uses {a.name}
                </option>
              ))}
            </select>
          )}
          <button className="icon-btn" aria-label="Remove phase" onClick={() => edit({ phases: f.phases!.filter((x) => x.id !== p.id) })}>
            <X size={12} />
          </button>
        </div>
      ))}
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
