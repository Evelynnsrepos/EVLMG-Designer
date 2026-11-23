import { ChevronDown, ChevronRight, Play, Plus, Sparkles, X } from 'lucide-react'
import { Fragment, useState } from 'react'
import type { Enemy } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useProjectStore, useUndoRedoKeys } from '@/core/state'
import { emptyStatusDoc, STATUS_DOC, type StatusDoc } from '@/components/status-effects/model'
import { abilityFormula, createAbilitiesDoc, type AbilitiesDoc, type Ability } from '@/components/abilities/model'
import { NumberInput, PresetHeader, useDamagePresets } from '@/shared/calculators'
import { useItems } from '@/shared/listDetail'
import { FUNCTION_HELP, libraryFor } from '@/shared/formulas'
import { confirmDialog } from '@/shared/dialogs'
import { localized, useLang } from '@/shared/i18n'
import '@/shared/listDetail/listDetail.css'
import { FighterDetails } from './Details'
import { createCombatDoc, CUSTOM_FORMULA, exampleElementalTeam, exampleTurnBoss, newFighter, PRESET_PREFIX, simulateCombat, summary, SUMMARY_WORDS, type CombatDoc, type CombatResult, type Fighter, type SimAbility } from './model'
import './combat.css'

const UI = localized(
  {
    examples: 'Start from an example',
    exElemental: 'Elemental team vs waves',
    exElementalTip: 'Four elemental characters with supports against two waves, 60 seconds to clear (real time)',
    exBoss: 'Turn-based boss with phases',
    exBossTip: 'Four party members against a boss with a weakness and a second phase',
    loadTitle: 'Load example',
    loadMessage: 'This replaces the fighters and settings of this fight. You can undo it.',
    vs: 'vs',
    fighter: 'Fighter',
    count: 'How many',
    speedTurns: 'Speed',
    speedReal: 'Attacks/s',
    speedTurnsTip: 'Who goes first each round',
    speedRealTip: 'Attacks per second',
    crit: 'Crit %',
    critDmg: 'Crit dmg %',
    abilities: 'Abilities',
    abilitiesTip: 'Used whenever one is ready, instead of a basic attack. Resistances come from the Enemy List.',
    details: 'Details',
    detailsTip: 'Extra stats, element, resistances, wave, buffs and phases',
    resistances: 'Resistances',
    addAbility: 'Add ability',
    removeAbility: 'Remove ability',
    removeFighter: 'Remove fighter',
    addFighter: 'Add fighter',
    fromEnemy: 'Add from the Enemy List…',
    untitled: 'Untitled',
    rules: 'How the fight works',
    formula: 'Damage formula of the basic attack',
    writeOwn: 'Write your own…',
    yourPresets: 'Your Damage Calculator presets',
    untitledPreset: 'Untitled preset',
    mode: 'How the fight runs',
    realtime: 'Real time (attacks per second)',
    turnBased: 'Turn based (rounds in speed order)',
    weakTurn: 'Weakness gives one more turn',
    weakTurnTip: 'Hitting a weakness (resistance above 1) gives one more action that round',
    timeLimit: (unit: string) => `Time limit (${unit}, 0 = none)`,
    timeLimitTip: (team: string) => `${team} must win within this time. 0 = no limit.`,
    spread: 'Damage spread ± %',
    fights: 'Fights',
    simulate: 'Simulate',
    yourFormula: 'Your formula',
    formulaHelp:
      "Attacker: ATK, HP, MAXHP, SPD, CRIT and every extra stat by its name. Target: the same with T_ in front (T_DEF, T_HP). DEF alone is the target's DEF. Buffs change these numbers first. To reuse it in other tools, make it a Damage Calculator preset. Functions: ",
    countsAsZero: (list: string) => `These count as 0: ${list}. Add them as extra stats (open a fighter with the arrow).`,
    results: 'Results',
    wins: (team: string) => `${team} win`,
    hpLeft: (pct: number) => `with ${pct}% HP left`,
    avgFight: 'Average fight',
    rounds: 'rounds',
    seconds: 's',
    whoDamage: 'Who does the damage (per fight)',
    effects: 'Status effects per fight',
    effectDamage: 'Damage from effects',
    exampleFight: 'Example fight',
    pressSimulate: 'Press Simulate to play the fight many times.',
    summary: SUMMARY_WORDS,
  },
  {
    examples: 'Mit einem Beispiel anfangen',
    exElemental: 'Element-Team gegen Wellen',
    exElementalTip: 'Vier Charaktere mit Elementen und Unterstützern gegen zwei Wellen, 60 Sekunden Zeit (Echtzeit)',
    exBoss: 'Rundenbasierter Boss mit Phasen',
    exBossTip: 'Vier Gruppenmitglieder gegen einen Boss mit Schwäche und zweiter Phase',
    loadTitle: 'Beispiel laden',
    loadMessage: 'Das ersetzt die Kämpfer und Einstellungen dieses Kampfes. Du kannst es rückgängig machen.',
    vs: 'gegen',
    fighter: 'Kämpfer',
    count: 'Anzahl',
    speedTurns: 'Tempo',
    speedReal: 'Angriffe/s',
    speedTurnsTip: 'Wer in jeder Runde zuerst dran ist',
    speedRealTip: 'Angriffe pro Sekunde',
    crit: 'Krit %',
    critDmg: 'Krit-Schaden %',
    abilities: 'Fähigkeiten',
    abilitiesTip: 'Wird statt eines normalen Angriffs benutzt, sobald sie bereit ist. Resistenzen kommen aus der Gegner-Liste.',
    details: 'Details',
    detailsTip: 'Extra-Werte, Element, Resistenzen, Welle, Buffs und Phasen',
    resistances: 'Resistenzen',
    addAbility: 'Fähigkeit hinzufügen',
    removeAbility: 'Fähigkeit entfernen',
    removeFighter: 'Kämpfer entfernen',
    addFighter: 'Kämpfer hinzufügen',
    fromEnemy: 'Aus der Gegner-Liste hinzufügen…',
    untitled: 'Ohne Namen',
    rules: 'So läuft der Kampf',
    formula: 'Schadensformel des normalen Angriffs',
    writeOwn: 'Eigene Formel schreiben…',
    yourPresets: 'Deine Vorlagen aus dem Schadensrechner',
    untitledPreset: 'Vorlage ohne Namen',
    mode: 'Kampfart',
    realtime: 'Echtzeit (Angriffe pro Sekunde)',
    turnBased: 'Rundenbasiert (Runden nach Tempo)',
    weakTurn: 'Schwäche gibt einen Zug mehr',
    weakTurnTip: 'Wer eine Schwäche trifft (Resistenz über 1), handelt in der Runde noch einmal',
    timeLimit: (unit: string) => `Zeitlimit (${unit}, 0 = keins)`,
    timeLimitTip: (team: string) => `${team} muss in dieser Zeit gewinnen. 0 = kein Limit.`,
    spread: 'Schadensstreuung ± %',
    fights: 'Kämpfe',
    simulate: 'Simulieren',
    yourFormula: 'Deine Formel',
    formulaHelp:
      'Angreifer: ATK, HP, MAXHP, SPD, CRIT und jeder Extra-Wert mit seinem Namen. Ziel: dasselbe mit T_ davor (T_DEF, T_HP). DEF allein ist die DEF des Ziels. Buffs ändern diese Zahlen zuerst. Um sie in anderen Tools zu nutzen, mach eine Vorlage im Schadensrechner daraus. Funktionen: ',
    countsAsZero: (list: string) => `Diese zählen als 0: ${list}. Füge sie als Extra-Werte hinzu (Kämpfer mit dem Pfeil öffnen).`,
    results: 'Ergebnis',
    wins: (team: string) => `${team} gewinnt`,
    hpLeft: (pct: number) => `mit ${pct}% HP übrig`,
    avgFight: 'Kampf im Schnitt',
    rounds: 'Runden',
    seconds: 's',
    whoDamage: 'Wer macht den Schaden (pro Kampf)',
    effects: 'Statuseffekte pro Kampf',
    effectDamage: 'Schaden durch Effekte',
    exampleFight: 'Beispielkampf',
    pressSimulate: 'Drück auf Simulieren, um den Kampf viele Male zu spielen.',
    summary: {
      rounds: ' Runden',
      seconds: ' s',
      win: (team: string, pct: string) => `${team} gewinnt ${pct} der Kämpfe`,
      usually: (mid: string, fast: string, slow: string) => `, meist in ${mid} (am schnellsten ${fast}, am langsamsten ${slow})`,
      otherWin: (team: string, pct: string) => `${team} gewinnt ${pct}.`,
      timeout: (pct: string, limit: string) => `${pct} laufen aus der Zeit (${limit}).`,
      draw: (pct: string) => `${pct} enden ohne Sieger.`,
    },
  },
)

const STAT_KEYS = { hp: ['HP', 'Health', 'Hp', 'hp'], atk: ['ATK', 'Attack', 'atk'], def: ['DEF', 'Defense', 'Defence', 'def'], speed: ['SPD', 'Speed', 'spd'] }
const pick = (stats: Record<string, number>, keys: string[], fallback: number) => {
  for (const k of keys) if (typeof stats[k] === 'number') return stats[k]
  return fallback
}
/** Team colours: the first team in the accent (the set one, never a fixed blue), the second in the danger red. */
const SIDE_COLOR = ['var(--accent)', 'var(--danger)']

/** Combat simulator (v0.10, overhaul 0.35): two teams fight many times; win rates, fight length and damage. */
export default function View({ documentId, active }: PanelProps) {
  useLang()
  const doc = useDocument<CombatDoc>('combat', documentId!, createCombatDoc)
  useUndoRedoKeys(doc, active)
  const enemies = useProjectStore((s) => s.entities.enemy) as Enemy[]
  const [result, setResult] = useState<CombatResult | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  // 0.28: fighters use Abilities & Spells, with their formulas and cooldowns.
  const abilities = useItems<Ability, AbilitiesDoc>('abilities', 'abilities', createAbilitiesDoc).items
  const presets = useDamagePresets()
  const simAbilities: SimAbility[] = abilities.flatMap((a) => {
    const f = abilityFormula(a, presets)
    return f ? [{ id: a.id, name: a.name, element: a.element, cooldown: Math.max(a.cooldown, a.castTime), applies: a.applies, ...f }] : []
  })
  // Missing tools phase 1: status effects and reactions, only when the project has some.
  const status = useDocument<StatusDoc>(STATUS_DOC.type, STATUS_DOC.id, emptyStatusDoc).data
  const hasStatus = !!status && (status.items.length > 0 || status.reactions.length > 0)
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
  const run = () => setResult(simulateCombat(d, Date.now(), simAbilities, hasStatus ? status : undefined, presets))
  const turns = d.mode === 'turns'
  const unit = turns ? UI.rounds : UI.seconds
  const loadExample = async (make: () => CombatDoc) => {
    if (await confirmDialog({ title: UI.loadTitle, message: UI.loadMessage, confirmLabel: UI.loadTitle })) {
      set(() => make())
      setResult(null)
    }
  }
  const damageTotal = result ? Object.values(result.damage).reduce((a, b) => a + b, 0) : 0
  const totalRuns = result ? result.wins[0] + result.wins[1] + result.draws : 0

  const team = (side: 0 | 1) => (
    <section className="cb-card cb-team" style={{ ['--cb-side' as string]: SIDE_COLOR[side] }}>
      <input className="input cb-teamname" value={d.teamNames[side]} onChange={(e) => set((x) => ({ ...x, teamNames: (side === 0 ? [e.target.value, x.teamNames[1]] : [x.teamNames[0], e.target.value]) as [string, string] }))} />
      <div className="cb-scroll">
        <table className="calc-table cb-table">
          <thead>
            <tr>
              <th>{UI.fighter}</th>
              <th title={UI.count}>×</th>
              <th>HP</th>
              <th>ATK</th>
              <th>DEF</th>
              <th title={turns ? UI.speedTurnsTip : UI.speedRealTip}>{turns ? UI.speedTurns : UI.speedReal}</th>
              <th>{UI.crit}</th>
              <th>{UI.critDmg}</th>
              <th title={UI.abilitiesTip}>{UI.abilities}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {d.teams[side].map((f) => (
              <Fragment key={f.id}>
                <tr className={open === f.id ? 'cb-open' : undefined}>
                  <td className="cb-namecell">
                    <button className="icon-btn" aria-label={UI.details} aria-expanded={open === f.id} title={UI.detailsTip} onClick={() => setOpen(open === f.id ? null : f.id)}>
                      {open === f.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </button>
                    <input className="input" value={f.name} onChange={(e) => editFighter(side, f.id, { name: e.target.value })} />
                  </td>
                  {(['count', 'hp', 'atk', 'def', 'speed', 'crit', 'critDamage'] as const).map((k) => (
                    <td key={k}>
                      <NumberInput value={f[k]} min={0} onChange={(v) => editFighter(side, f.id, { [k]: v })} />
                    </td>
                  ))}
                  <td className="cb-abilities" title={f.resist && Object.keys(f.resist).length ? `${UI.resistances}: ${Object.entries(f.resist).map(([k, v]) => `${k} ×${v}`).join(', ')}` : undefined}>
                    {(f.abilities ?? []).map((id) => (
                      <span key={id} className="cb-ability">
                        {abilities.find((a) => a.id === id)?.name ?? '?'}
                        <button className="icon-btn" aria-label={UI.removeAbility} onClick={() => editFighter(side, f.id, { abilities: f.abilities!.filter((x) => x !== id) })}>
                          <X size={10} />
                        </button>
                      </span>
                    ))}
                    {abilities.length > 0 && (
                      <select className="input" value="" aria-label={UI.addAbility} onChange={(e) => e.target.value && editFighter(side, f.id, { abilities: [...(f.abilities ?? []), e.target.value] })}>
                        <option value="">+</option>
                        {abilities
                          .filter((a) => !(f.abilities ?? []).includes(a.id))
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                      </select>
                    )}
                  </td>
                  <td>
                    <button className="icon-btn" aria-label={UI.removeFighter} onClick={() => editTeam(side, (t) => t.filter((o) => o.id !== f.id))}>
                      <X size={13} />
                    </button>
                  </td>
                </tr>
                {open === f.id && (
                  <tr className="cb-detailrow">
                    <td colSpan={10}>
                      <FighterDetails f={f} turns={turns} abilities={abilities} edit={(patch) => editFighter(side, f.id, patch)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ld-inline">
        <button className="btn btn-ghost cb-add" onClick={() => editTeam(side, (t) => [...t, newFighter()])}>
          <Plus size={14} /> {UI.addFighter}
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
            <option value="">{UI.fromEnemy}</option>
            {enemies.map((en) => (
              <option key={en.id} value={en.id}>
                {en.name || UI.untitled}
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
        <div className="cb-examples">
          <span className="cb-muted">
            <Sparkles size={13} /> {UI.examples}
          </span>
          <button className="btn cb-pill" onClick={() => loadExample(exampleElementalTeam)} title={UI.exElementalTip}>
            {UI.exElemental}
          </button>
          <button className="btn cb-pill" onClick={() => loadExample(exampleTurnBoss)} title={UI.exBossTip}>
            {UI.exBoss}
          </button>
        </div>
        {team(0)}
        <div className="cb-vs">{UI.vs}</div>
        {team(1)}

        <section className="cb-card">
          <h3>{UI.rules}</h3>
          <div className="cb-settings">
            <label className="ld-field cb-wide">
              <span>{UI.formula}</span>
              <select className="input" value={d.formulaId} onChange={(e) => set((x) => ({ ...x, formulaId: e.target.value }))}>
                <option value={CUSTOM_FORMULA}>{UI.writeOwn}</option>
                {presets.length > 0 && (
                  <optgroup label={UI.yourPresets}>
                    {presets.map((p) => (
                      <option key={p.id} value={PRESET_PREFIX + p.id}>
                        {p.title || UI.untitledPreset}
                      </option>
                    ))}
                  </optgroup>
                )}
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
            <label className="ld-field cb-wide">
              <span>{UI.mode}</span>
              <select className="input" value={d.mode ?? 'realtime'} onChange={(e) => set((x) => ({ ...x, mode: e.target.value as CombatDoc['mode'] }))}>
                <option value="realtime">{UI.realtime}</option>
                <option value="turns">{UI.turnBased}</option>
              </select>
            </label>
            <label className="ld-field" title={UI.timeLimitTip(d.teamNames[0])}>
              <span>{UI.timeLimit(unit)}</span>
              <NumberInput value={d.timeLimit ?? 0} min={0} onChange={(timeLimit) => set((x) => ({ ...x, timeLimit }))} />
            </label>
            <label className="ld-field">
              <span>{UI.spread}</span>
              <NumberInput value={d.spread} min={0} max={100} onChange={(spread) => set((x) => ({ ...x, spread }))} />
            </label>
            <label className="ld-field">
              <span>{UI.fights}</span>
              <NumberInput value={d.runs} min={1} max={20000} onChange={(runs) => set((x) => ({ ...x, runs }))} />
            </label>
          </div>
          {turns && (
            <label className="cb-check" title={UI.weakTurnTip}>
              <input type="checkbox" checked={!!d.weaknessTurn} onChange={(e) => set((x) => ({ ...x, weaknessTurn: e.target.checked }))} /> {UI.weakTurn}
            </label>
          )}
          {d.formulaId === CUSTOM_FORMULA && (
            <div className="cb-formula">
              <input className="input" value={d.expression ?? ''} placeholder="ATK * 2 - T_DEF" onChange={(e) => set((x) => ({ ...x, expression: e.target.value }))} aria-label={UI.yourFormula} />
              <p className="cb-muted">
                {UI.formulaHelp}
                {FUNCTION_HELP.map((f) => f.name).join(', ')}.
              </p>
            </div>
          )}
          <button className="btn btn-primary cb-run" onClick={run}>
            <Play size={15} /> {UI.simulate}
          </button>
        </section>

        <section className="cb-card">
          <h3>{UI.results}</h3>
          {!result && <p className="cb-muted">{UI.pressSimulate}</p>}
          {result?.error && <p className="cb-bad">{result.error}</p>}
          {result?.missing && <p className="cb-bad">{UI.countsAsZero(result.missing.join('; '))}</p>}
          {result && !result.error && (
            <>
              <p className="cb-summary">{summary(d, result, UI.summary)}</p>
              <div className="cb-winbar">
                {result.wins[0] > 0 && <div style={{ flex: result.wins[0], background: SIDE_COLOR[0] }}>{Math.round((result.wins[0] / totalRuns) * 100)}%</div>}
                {result.draws > 0 && <div style={{ flex: result.draws, background: 'var(--text-muted)' }}>{Math.round((result.draws / totalRuns) * 100)}%</div>}
                {result.wins[1] > 0 && <div style={{ flex: result.wins[1], background: SIDE_COLOR[1] }}>{Math.round((result.wins[1] / totalRuns) * 100)}%</div>}
              </div>
              <div className="ld-result cb-stats">
                {([0, 1] as const).map((side) => (
                  <div key={side} className="ld-stat">
                    <span>{UI.wins(d.teamNames[side])}</span>
                    <strong>{Math.round((result.wins[side] / totalRuns) * 1000) / 10}%</strong>
                    {result.wins[side] > 0 && <span>{UI.hpLeft(Math.round(result.avgHpLeft[side] * 100))}</span>}
                  </div>
                ))}
                <div className="ld-stat">
                  <span>{UI.avgFight}</span>
                  <strong>
                    {turns ? Math.round(result.avgSeconds) : result.avgSeconds.toFixed(1)} {unit}
                  </strong>
                </div>
              </div>
              <h4>{UI.whoDamage}</h4>
              {d.teams.map((t, side) => (
                <div key={side} className="cb-share">
                  {t.map((f) => {
                    const v = result.damage[f.id] ?? 0
                    return (
                      <div key={f.id} className="cb-share-row">
                        <span>{f.name}</span>
                        <div className="cb-share-bar">
                          <div style={{ width: `${damageTotal ? (v / damageTotal) * 100 : 0}%`, background: SIDE_COLOR[side] }} />
                        </div>
                        <strong>{Math.round(v).toLocaleString()}</strong>
                        <span className="cb-muted">{damageTotal ? Math.round((v / damageTotal) * 100) : 0}%</span>
                      </div>
                    )
                  })}
                </div>
              ))}
              {result.effects && (
                <>
                  <h4>{UI.effects}</h4>
                  <div className="ld-result cb-stats">
                    <div className="ld-stat">
                      <span>{UI.effectDamage}</span>
                      <strong>{Math.round(result.effects.damage)}</strong>
                    </div>
                    {Object.entries(result.effects.reactions).map(([name, n]) => (
                      <div key={name} className="ld-stat">
                        <span>{name}</span>
                        <strong>{n.toFixed(1)}×</strong>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <h4>{UI.exampleFight}</h4>
              <pre className="cb-log">{result.log.join('\n')}</pre>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
