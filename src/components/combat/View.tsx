import { Play, Plus, X } from 'lucide-react'
import { useState } from 'react'
import type { Enemy } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useProjectStore, useUndoRedoKeys } from '@/core/state'
import { abilityFormula, createAbilitiesDoc, type AbilitiesDoc, type Ability } from '@/components/abilities/model'
import { NumberInput, PresetHeader, useDamagePresets } from '@/shared/calculators'
import { useItems } from '@/shared/listDetail'
import { libraryFor } from '@/shared/formulas'
import '@/shared/listDetail/listDetail.css'
import { createCombatDoc, newFighter, simulateCombat, type CombatDoc, type CombatResult, type Fighter, type SimAbility } from './model'
import './combat.css'

const STAT_KEYS = { hp: ['HP', 'Health', 'Hp', 'hp'], atk: ['ATK', 'Attack', 'atk'], def: ['DEF', 'Defense', 'Defence', 'def'], speed: ['SPD', 'Speed', 'spd'] }
const pick = (stats: Record<string, number>, keys: string[], fallback: number) => {
  for (const k of keys) if (typeof stats[k] === 'number') return stats[k]
  return fallback
}

/** Combat simulator (v0.10): two teams fight many times; win rates, fight length and damage. */
export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<CombatDoc>('combat', documentId!, createCombatDoc)
  useUndoRedoKeys(doc, active)
  const enemies = useProjectStore((s) => s.entities.enemy) as Enemy[]
  const [result, setResult] = useState<CombatResult | null>(null)
  // 0.28: fighters use Abilities & Spells, with their formulas and cooldowns.
  const abilities = useItems<Ability, AbilitiesDoc>('abilities', 'abilities', createAbilitiesDoc).items
  const presets = useDamagePresets()
  const simAbilities: SimAbility[] = abilities.flatMap((a) => {
    const f = abilityFormula(a, presets)
    return f ? [{ id: a.id, name: a.name, element: a.element, cooldown: Math.max(a.cooldown, a.castTime), ...f }] : []
  })
  if (!doc.data) return null
  const d = doc.data
  const set = (fn: (d: CombatDoc) => CombatDoc) => doc.update(fn)
  const editTeam = (side: 0 | 1, fn: (team: Fighter[]) => Fighter[]) => set((x) => ({ ...x, teams: (side === 0 ? [fn(x.teams[0]), x.teams[1]] : [x.teams[0], fn(x.teams[1])]) as CombatDoc['teams'] }))
  const editFighter = (side: 0 | 1, id: string, patch: Partial<Fighter>) => editTeam(side, (t) => t.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  const fromEnemy = (e: Enemy): Fighter => ({
    ...newFighter(e.name || 'Enemy'),
    sourceId: e.id,
    hp: pick(e.stats, STAT_KEYS.hp, 100),
    atk: pick(e.stats, STAT_KEYS.atk, 10),
    def: pick(e.stats, STAT_KEYS.def, 0),
    speed: pick(e.stats, STAT_KEYS.speed, 1),
    resist: e.resistances,
    abilities: abilities.filter((a) => a.users.includes(e.id)).map((a) => a.id),
  })
  const run = () => setResult(simulateCombat(d, Date.now(), simAbilities))
  const totalRuns = result ? result.wins[0] + result.wins[1] + result.draws : 0

  const team = (side: 0 | 1) => (
    <section className="cb-team">
      <input className="input cb-teamname" value={d.teamNames[side]} onChange={(e) => set((x) => ({ ...x, teamNames: (side === 0 ? [e.target.value, x.teamNames[1]] : [x.teamNames[0], e.target.value]) as [string, string] }))} />
      <table className="calc-table cb-table">
        <thead>
          <tr>
            <th>Fighter</th>
            <th>×</th>
            <th>HP</th>
            <th>ATK</th>
            <th>DEF</th>
            <th>Attacks/s</th>
            <th>Crit %</th>
            <th>Crit dmg %</th>
            <th title="Used whenever one is ready, instead of a basic attack. Resistances come from the Enemy List.">Abilities</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {d.teams[side].map((f) => (
            <tr key={f.id}>
              <td>
                <input className="input" value={f.name} onChange={(e) => editFighter(side, f.id, { name: e.target.value })} />
              </td>
              {(['count', 'hp', 'atk', 'def', 'speed', 'crit', 'critDamage'] as const).map((k) => (
                <td key={k}>
                  <NumberInput value={f[k]} min={0} onChange={(v) => editFighter(side, f.id, { [k]: v })} />
                </td>
              ))}
              <td className="cb-abilities" title={f.resist && Object.keys(f.resist).length ? `Resistances: ${Object.entries(f.resist).map(([k, v]) => `${k} ×${v}`).join(', ')}` : undefined}>
                {(f.abilities ?? []).map((id) => (
                  <span key={id} className="cb-ability">
                    {abilities.find((a) => a.id === id)?.name ?? '?'}
                    <button className="icon-btn" aria-label="Remove ability" onClick={() => editFighter(side, f.id, { abilities: f.abilities!.filter((x) => x !== id) })}>
                      <X size={10} />
                    </button>
                  </span>
                ))}
                {abilities.length > 0 && (
                  <select className="input" value="" aria-label="Add ability" onChange={(e) => e.target.value && editFighter(side, f.id, { abilities: [...(f.abilities ?? []), e.target.value] })}>
                    <option value="">+</option>
                    {abilities.filter((a) => !(f.abilities ?? []).includes(a.id)).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                )}
              </td>
              <td>
                <button className="icon-btn" aria-label="Remove fighter" onClick={() => editTeam(side, (t) => t.filter((o) => o.id !== f.id))}>
                  <X size={13} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ld-inline">
        <button className="btn btn-ghost cb-add" onClick={() => editTeam(side, (t) => [...t, newFighter()])}>
          <Plus size={14} /> Add fighter
        </button>
        {enemies.length > 0 && (
          <select
            className="input"
            value=""
            onChange={(e) => {
              const en = enemies.find((x) => x.id === e.target.value)
              if (en) editTeam(side, (t) => [...t, fromEnemy(en)])
            }}
          >
            <option value="">Add from the Enemy List…</option>
            {enemies.map((en) => (
              <option key={en.id} value={en.id}>
                {en.name || 'Untitled'}
              </option>
            ))}
          </select>
        )}
      </div>
    </section>
  )

  return (
    <div className="cb">
      <div className="cb-head">
        <PresetHeader documentId={documentId!} kind="Combat" undo={doc.undo} redo={doc.redo} canUndo={doc.canUndo} canRedo={doc.canRedo} />
      </div>
      <div className="cb-body">
        {team(0)}
        <div className="cb-vs">vs</div>
        {team(1)}
        <section className="ld-inline cb-settings">
          <label className="ld-field">
            <span>Damage formula (ATK of the attacker, DEF of the target)</span>
            <select className="input" value={d.formulaId} onChange={(e) => set((x) => ({ ...x, formulaId: e.target.value }))}>
              {libraryFor('damage').map((g) => (
                <optgroup key={g.id} label={g.name}>
                  {g.formulas.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="ld-field">
            <span>Damage spread ± %</span>
            <NumberInput value={d.spread} min={0} max={100} onChange={(spread) => set((x) => ({ ...x, spread }))} />
          </label>
          <label className="ld-field">
            <span>Fights</span>
            <NumberInput value={d.runs} min={1} max={20000} onChange={(runs) => set((x) => ({ ...x, runs }))} />
          </label>
          <button className="btn btn-primary cb-add" onClick={run}>
            <Play size={14} /> Simulate
          </button>
        </section>

        {result?.error && <p className="cb-bad">{result.error}</p>}
        {result && !result.error && (
          <section>
            <div className="cb-bar">
              {result.wins[0] > 0 && <div style={{ flex: result.wins[0], background: '#3e8ef7' }}>{Math.round((result.wins[0] / totalRuns) * 100)}%</div>}
              {result.draws > 0 && <div style={{ flex: result.draws, background: 'var(--text-muted)' }}>{Math.round((result.draws / totalRuns) * 100)}%</div>}
              {result.wins[1] > 0 && <div style={{ flex: result.wins[1], background: '#e03131' }}>{Math.round((result.wins[1] / totalRuns) * 100)}%</div>}
            </div>
            <div className="ld-result">
              <div className="ld-stat">
                <span>{d.teamNames[0]} win</span>
                <strong>{Math.round((result.wins[0] / totalRuns) * 1000) / 10}%</strong>
                {result.wins[0] > 0 && <span>with {Math.round(result.avgHpLeft[0] * 100)}% HP left</span>}
              </div>
              <div className="ld-stat">
                <span>{d.teamNames[1]} win</span>
                <strong>{Math.round((result.wins[1] / totalRuns) * 1000) / 10}%</strong>
                {result.wins[1] > 0 && <span>with {Math.round(result.avgHpLeft[1] * 100)}% HP left</span>}
              </div>
              <div className="ld-stat">
                <span>Average fight</span>
                <strong>{result.avgSeconds.toFixed(1)} s</strong>
              </div>
            </div>
            <h4>Damage per fight</h4>
            <div className="ld-result">
              {[...d.teams[0], ...d.teams[1]].map((f) => (
                <div key={f.id} className="ld-stat">
                  <span>{f.name}</span>
                  <strong>{Math.round(result.damage[f.id] ?? 0)}</strong>
                </div>
              ))}
            </div>
            <h4>Example fight</h4>
            <pre className="cb-log">{result.log.join('\n')}</pre>
          </section>
        )}
      </div>
    </div>
  )
}
