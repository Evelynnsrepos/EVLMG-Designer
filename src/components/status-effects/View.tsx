import { Trash2 } from 'lucide-react'
import { useMemo, useState, type KeyboardEvent } from 'react'
import type { Enemy } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useProjectStore, useUndoRedoKeys } from '@/core/state'
import { createAbilitiesDoc, type AbilitiesDoc, type Ability } from '@/components/abilities/model'
import { NumberInput } from '@/shared/calculators'
import { promptDialog } from '@/shared/dialogs'
import { ImagePicker } from '@/shared/entityList'
import { localized, useLang } from '@/shared/i18n'
import { Field, ListDetail, useItems } from '@/shared/listDetail'
import { PixelSprite, SpritePicker } from '@/shared/pixel/PixelSprite'
import { ProofTextarea } from '@/shared/spell'
import { allElements, allTags, AURA_SECONDS, BUILTIN_STATS, effectSummary, effectTotal, emptyStatusDoc, exampleStatusDoc, newEffect, newReaction, parseTags, reactionFor, STATUS_DOC, type Reaction, type StatusDoc, type StatusEffect } from './model'
import './status-effects.css'

const UI = localized(
  {
    effects: 'Effects',
    reactions: 'Reactions',
    examples: 'Start with examples',
    examplesTip: 'Nine effects and three reactions to change or delete',
    time: 'Time in',
    seconds: 'Seconds',
    turns: 'Turns',
    timeTip: 'Only changes the words. The Combat Simulator counts turn-based fights in rounds either way.',
    sShort: 's',
    tShort: 'turns',
    newEffect: 'New effect',
    empty: 'No effects yet. Make one with New effect, or start with the examples.',
    name: 'Name',
    it: 'It',
    hurts: 'Hurts (debuff)',
    helps: 'Helps (buff)',
    lasts: 'Lasts',
    element: 'Element',
    elementPh: 'e.g. Fire',
    types: 'Types',
    typesPh: 'e.g. Debuff, Control',
    typesTip: 'Your own words, separated by commas. Other effects can remove or block all effects of a type.',
    stacksUpTo: 'Stacks up to',
    landsAgain: 'Lands again',
    refresh: 'Timer starts over',
    stronger: 'One more stack, timer starts over',
    ignore: 'Nothing happens',
    cantAct: "Can't act",
    cantActTip: 'Stun, freeze, sleep: the target skips its turns',
    overTime: 'Over time',
    overTimeToggle: 'Damages or heals over time',
    damage: 'Damage',
    healing: 'Healing',
    every: 'every',
    perStack: 'per stack',
    stats: 'Stat changes while active (per stack)',
    statsTip: 'Any stat: ATK, DEF, SPD, CRIT, CRITDMG, DMG (damage dealt), TAKEN (damage taken) or a fighter\'s own stat from the Combat Simulator.',
    flat: 'flat',
    addStat: '+ Stat change',
    remove: 'Remove',
    removes: 'Removes these when it lands',
    blocks: 'Blocks these while active (immunity)',
    addPick: 'Add an effect or type…',
    pickEffects: 'Effects',
    pickTypes: 'All of a type',
    allOf: 'All',
    deleted: '(deleted)',
    description: 'Description',
    atStacks: 'at {n} stacks: {t} over {k} ticks',
    ticks: '{k} ticks',
    deleteEffect: 'Delete effect',
    gridHelp: 'What happens when an element hits a target that already carries another one. Rows: on the target. Columns: the hit. Click a cell (or move with the arrow keys and press Enter) to see it; a reaction is made once you change something. Delete clears it.',
    noElements: 'No elements yet. Give abilities an element, or add one here.',
    corner: 'on target ↓ / hit →',
    addElement: '+ Element',
    newElement: 'New element',
    stays: 'An element stays on a target for',
    then: '{a} then {b}',
    damageX: 'Damage ×',
    damageXEffect: 'The hit that lands it counts × (1 = no extra)',
    adds: 'Adds effect',
    none: 'None',
    usesUp: 'Uses up {a}',
    deleteReaction: 'Delete reaction',
    notYet: 'No reaction here yet. Change anything below to make one.',
    effectMeets: 'Effect meets effect',
    effectMeetsHelp: 'When an effect lands on a target that already has another one: Wet then Chill makes Frozen, Charmed then Scared breaks the charm.',
    addEffectMeets: '+ Effect meets effect',
    needEffects: 'Make at least one effect first.',
    onTarget: 'Already on the target',
    landing: 'Lands',
    summary: { per: 'per', total: 'total', cantAct: "can't act", upTo: 'up to {n} stacks' },
  },
  {
    effects: 'Effekte',
    reactions: 'Reaktionen',
    examples: 'Mit Beispielen anfangen',
    examplesTip: 'Neun Effekte und drei Reaktionen zum Ändern oder Löschen',
    time: 'Zeit in',
    seconds: 'Sekunden',
    turns: 'Zügen',
    timeTip: 'Ändert nur die Wörter. Der Kampfsimulator zählt rundenbasierte Kämpfe immer in Runden.',
    sShort: 's',
    tShort: 'Züge',
    newEffect: 'Neuer Effekt',
    empty: 'Noch keine Effekte. Mach einen mit Neuer Effekt oder fang mit den Beispielen an.',
    name: 'Name',
    it: 'Er',
    hurts: 'Schadet (Debuff)',
    helps: 'Hilft (Buff)',
    lasts: 'Dauert',
    element: 'Element',
    elementPh: 'z. B. Feuer',
    types: 'Arten',
    typesPh: 'z. B. Debuff, Kontrolle',
    typesTip: 'Eigene Wörter, mit Kommas getrennt. Andere Effekte können alle Effekte einer Art entfernen oder blocken.',
    stacksUpTo: 'Stapelt bis',
    landsAgain: 'Trifft erneut',
    refresh: 'Zeit startet neu',
    stronger: 'Ein Stapel mehr, Zeit startet neu',
    ignore: 'Nichts passiert',
    cantAct: 'Kann nicht handeln',
    cantActTip: 'Betäubt, eingefroren, schlafend: das Ziel setzt aus',
    overTime: 'Mit der Zeit',
    overTimeToggle: 'Schadet oder heilt mit der Zeit',
    damage: 'Schaden',
    healing: 'Heilung',
    every: 'alle',
    perStack: 'pro Stapel',
    stats: 'Werte, solange er wirkt (pro Stapel)',
    statsTip: 'Jeder Wert: ATK, DEF, SPD, CRIT, CRITDMG, DMG (verursachter Schaden), TAKEN (erlittener Schaden) oder ein eigener Wert eines Kämpfers aus dem Kampfsimulator.',
    flat: 'fest',
    addStat: '+ Wert ändern',
    remove: 'Entfernen',
    removes: 'Entfernt diese, wenn er trifft',
    blocks: 'Blockt diese, solange er wirkt (Immunität)',
    addPick: 'Effekt oder Art hinzufügen…',
    pickEffects: 'Effekte',
    pickTypes: 'Alle einer Art',
    allOf: 'Alle',
    deleted: '(gelöscht)',
    description: 'Beschreibung',
    atStacks: 'bei {n} Stapeln: {t} über {k} Ticks',
    ticks: '{k} Ticks',
    deleteEffect: 'Effekt löschen',
    gridHelp: 'Was passiert, wenn ein Element ein Ziel trifft, das schon ein anderes trägt. Zeilen: auf dem Ziel. Spalten: der Treffer. Klick eine Zelle an (oder geh mit den Pfeiltasten hin und drück Enter), um sie zu sehen; eine Reaktion entsteht, sobald du etwas änderst. Entf löscht sie.',
    noElements: 'Noch keine Elemente. Gib Fähigkeiten ein Element oder füg hier eins hinzu.',
    corner: 'auf dem Ziel ↓ / Treffer →',
    addElement: '+ Element',
    newElement: 'Neues Element',
    stays: 'Ein Element bleibt auf dem Ziel für',
    then: '{a}, dann {b}',
    damageX: 'Schaden ×',
    damageXEffect: 'Der Treffer, der ihn bringt, zählt × (1 = nichts extra)',
    adds: 'Fügt Effekt hinzu',
    none: 'Keinen',
    usesUp: 'Verbraucht {a}',
    deleteReaction: 'Reaktion löschen',
    notYet: 'Hier gibt es noch keine Reaktion. Ändere unten etwas, um eine zu machen.',
    effectMeets: 'Effekt trifft Effekt',
    effectMeetsHelp: 'Wenn ein Effekt auf ein Ziel trifft, das schon einen anderen hat: Nass, dann Kälte ergibt Eingefroren, Bezaubert, dann Angst bricht den Zauber.',
    addEffectMeets: '+ Effekt trifft Effekt',
    needEffects: 'Mach zuerst mindestens einen Effekt.',
    onTarget: 'Schon auf dem Ziel',
    landing: 'Trifft',
    summary: { per: 'pro', total: 'gesamt', cantAct: 'kann nicht handeln', upTo: 'bis {n} Stapel' },
  },
)

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''))
const words = (unit: string) => ({ unit, per: UI.summary.per, total: UI.summary.total, cantAct: UI.summary.cantAct, upTo: UI.summary.upTo })

/** Status Effects & Reactions (missing tools phase 1, made flexible after the 0.35 review). */
export default function View({ active }: PanelProps) {
  useLang()
  const doc = useDocument<StatusDoc>(STATUS_DOC.type, STATUS_DOC.id, emptyStatusDoc)
  const list = useItems<StatusEffect, StatusDoc>(STATUS_DOC.type, STATUS_DOC.id, emptyStatusDoc)
  useUndoRedoKeys(doc, active)
  const abilities = useItems<Ability, AbilitiesDoc>('abilities', 'abilities', createAbilitiesDoc).items
  const enemies = useProjectStore((s) => s.entities.enemy) as Enemy[]
  const [tab, setTab] = useState<'effects' | 'reactions'>('effects')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  if (!doc.data) return null
  const d = doc.data
  const e = list.items.find((x) => x.id === selectedId)
  const isEmpty = !d.items.length && !d.reactions.length
  const extra = [...abilities.map((a) => a.element), ...enemies.flatMap((x) => Object.keys(x.resistances ?? {}))]
  const unit = d.unit === 'turns' ? UI.tShort : UI.sShort
  const stats = [...new Set([...BUILTIN_STATS, ...d.items.flatMap((x) => x.stats.map((s) => s.stat.trim()).filter(Boolean))])]

  const add = () => {
    const n = newEffect()
    list.add(n)
    setSelectedId(n.id)
  }
  const remove = (id: string) => {
    const strip = (ids: string[] | undefined) => ids?.filter((c) => c !== id)
    doc.update((x) => ({
      ...x,
      items: x.items.filter((i) => i.id !== id).map((i) => ({ ...i, cancels: strip(i.cancels)!, blocks: strip(i.blocks) })),
      reactions: x.reactions.filter((r) => r.on !== 'effect' || (r.first !== id && r.second !== id)).map((r) => (r.addsEffectId === id ? { ...r, addsEffectId: null } : r)),
    }))
    setSelectedId(null)
  }

  return (
    <div className="se-wrap">
      <div className="se-tabs">
        <button className={`btn btn-ghost${tab === 'effects' ? ' on' : ''}`} onClick={() => setTab('effects')}>
          {UI.effects}
        </button>
        <button className={`btn btn-ghost${tab === 'reactions' ? ' on' : ''}`} onClick={() => setTab('reactions')}>
          {UI.reactions}
        </button>
        <label className="se-unit" title={UI.timeTip}>
          {UI.time}
          <select className="input" value={d.unit ?? 'seconds'} onChange={(x) => doc.update((y) => ({ ...y, unit: x.target.value as StatusDoc['unit'] }))}>
            <option value="seconds">{UI.seconds}</option>
            <option value="turns">{UI.turns}</option>
          </select>
        </label>
        {isEmpty && (
          <button className="btn btn-primary" title={UI.examplesTip} onClick={() => doc.update((y) => ({ ...exampleStatusDoc(), unit: y.unit }))}>
            {UI.examples}
          </button>
        )}
      </div>
      <datalist id="se-stats">
        {stats.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      {tab === 'effects' ? (
        <ListDetail
          rows={list.items.map((x) => ({ id: x.id, label: x.name, sub: effectSummary(x, words(unit)), color: x.good ? 'var(--accent)' : 'var(--danger)' }))}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onAdd={add}
          addLabel={UI.newEffect}
          empty={UI.empty}
        >
          {e && <EffectPage key={e.id} e={e} all={list.items} tags={allTags(d)} unit={unit} edit={(p) => list.edit(e.id, p)} remove={() => remove(e.id)} />}
        </ListDetail>
      ) : (
        <Reactions d={d} elements={allElements(d, extra)} unit={unit} update={(fn) => doc.update(fn)} />
      )}
    </div>
  )
}

/** Chips for picked effects and types plus one select to add more; used by Removes and Blocks. */
function PickList({ self, all, tags, ids, picked, onChange }: { self: string; all: StatusEffect[]; tags: string[]; ids: string[]; picked: string[]; onChange(ids: string[], tags: string[]): void }) {
  const lower = picked.map((t) => t.toLowerCase())
  return (
    <div className="ld-inline se-picks">
      {ids.map((id) => (
        <button key={id} className="btn btn-ghost se-chip" title={UI.remove} onClick={() => onChange(ids.filter((c) => c !== id), picked)}>
          {all.find((x) => x.id === id)?.name ?? UI.deleted} ×
        </button>
      ))}
      {picked.map((t) => (
        <button key={t} className="btn btn-ghost se-chip" title={UI.remove} onClick={() => onChange(ids, picked.filter((c) => c !== t))}>
          {UI.allOf} {t} ×
        </button>
      ))}
      <select
        className="input"
        value=""
        onChange={(x) => {
          const v = x.target.value
          if (v.startsWith('tag:')) onChange(ids, [...picked, v.slice(4)])
          else if (v) onChange([...ids, v], picked)
        }}
      >
        <option value="">{UI.addPick}</option>
        <optgroup label={UI.pickEffects}>
          {all
            .filter((x) => x.id !== self && !ids.includes(x.id))
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
        </optgroup>
        {tags.some((t) => !lower.includes(t.toLowerCase())) && (
          <optgroup label={UI.pickTypes}>
            {tags
              .filter((t) => !lower.includes(t.toLowerCase()))
              .map((t) => (
                <option key={t} value={`tag:${t}`}>
                  {t}
                </option>
              ))}
          </optgroup>
        )}
      </select>
    </div>
  )
}

function EffectPage({ e, all, tags, unit, edit, remove }: { e: StatusEffect; all: StatusEffect[]; tags: string[]; unit: string; edit(p: Partial<StatusEffect>): void; remove(): void }) {
  const one = effectTotal(e, 1)
  const max = effectTotal(e, e.maxStacks)
  const setStat = (i: number, p: Partial<StatusEffect['stats'][number]>) => edit({ stats: e.stats.map((y, j) => (j === i ? { ...y, ...p } : y)) })
  return (
    <div className="ld-page se-page">
      <div className="wide ld-inline">
        <div style={{ width: 72 }}>
          {e.sprite ? <PixelSprite sprite={e.sprite} size={96} /> : <ImagePicker path={e.image} alt={e.name} onChange={(image) => edit({ image })} />}
          <SpritePicker sprite={e.sprite} onChange={(sprite) => edit({ sprite })} />
        </div>
        <input className="input" style={{ flex: 1, fontSize: 18, fontWeight: 600 }} value={e.name} onChange={(x) => edit({ name: x.target.value })} aria-label={UI.name} />
      </div>
      <Field label={UI.it}>
        <select className="input" value={e.good ? 'good' : 'bad'} onChange={(x) => edit({ good: x.target.value === 'good' })}>
          <option value="bad">{UI.hurts}</option>
          <option value="good">{UI.helps}</option>
        </select>
      </Field>
      <Field label={`${UI.lasts} (${unit})`}>
        <NumberInput value={e.seconds} min={0} onChange={(seconds) => edit({ seconds })} />
      </Field>
      <Field label={UI.element}>
        <input className="input" placeholder={UI.elementPh} value={e.element} onChange={(x) => edit({ element: x.target.value })} />
      </Field>
      <Field label={UI.types}>
        {/* Saved on leaving the box, so typing a comma doesn't get cleaned away mid-word. */}
        <input className="input" title={UI.typesTip} placeholder={UI.typesPh} defaultValue={(e.tags ?? []).join(', ')} onBlur={(x) => edit({ tags: parseTags(x.target.value) })} />
      </Field>
      <Field label={UI.stacksUpTo}>
        <NumberInput value={e.maxStacks} min={1} onChange={(maxStacks) => edit({ maxStacks: Math.max(1, Math.round(maxStacks)) })} />
      </Field>
      <Field label={UI.landsAgain}>
        <select className="input" value={e.stacking} onChange={(x) => edit({ stacking: x.target.value as StatusEffect['stacking'] })}>
          <option value="refresh">{UI.refresh}</option>
          <option value="stronger">{UI.stronger}</option>
          <option value="ignore">{UI.ignore}</option>
        </select>
      </Field>
      <Field label={UI.cantAct}>
        <input type="checkbox" checked={e.stops} onChange={(x) => edit({ stops: x.target.checked })} title={UI.cantActTip} />
      </Field>

      <div className="ld-section">
        <strong>{UI.overTime}</strong>
        <label className="ld-inline">
          <input type="checkbox" checked={!!e.tick} onChange={(x) => edit({ tick: x.target.checked ? { amount: 5, every: 1, heal: e.good } : null })} /> {UI.overTimeToggle}
        </label>
        {e.tick && (
          <div className="ld-inline">
            <select className="input" value={e.tick.heal ? 'heal' : 'dmg'} onChange={(x) => edit({ tick: { ...e.tick!, heal: x.target.value === 'heal' } })}>
              <option value="dmg">{UI.damage}</option>
              <option value="heal">{UI.healing}</option>
            </select>
            <NumberInput value={e.tick.amount} min={0} onChange={(amount) => edit({ tick: { ...e.tick!, amount } })} />
            <span>{UI.every}</span>
            <NumberInput value={e.tick.every} min={0.1} onChange={(every) => edit({ tick: { ...e.tick!, every } })} />
            <span>
              {unit}, {UI.perStack}
            </span>
          </div>
        )}
      </div>

      <div className="ld-section">
        <strong title={UI.statsTip}>{UI.stats}</strong>
        {e.stats.map((s, i) => (
          <div key={i} className="ld-inline">
            <input className="input se-stat" list="se-stats" value={s.stat} title={UI.statsTip} onChange={(x) => setStat(i, { stat: x.target.value })} />
            <NumberInput value={s.percent} onChange={(percent) => setStat(i, { percent })} />
            <span>%</span>
            <NumberInput value={s.flat ?? 0} onChange={(flat) => setStat(i, { flat })} />
            <span>{UI.flat}</span>
            <button className="btn btn-ghost" title={UI.remove} onClick={() => edit({ stats: e.stats.filter((_, j) => j !== i) })}>
              ×
            </button>
          </div>
        ))}
        <button className="btn btn-ghost" onClick={() => edit({ stats: [...e.stats, { stat: 'SPD', percent: -20 }] })}>
          {UI.addStat}
        </button>
      </div>

      <div className="ld-section">
        <strong>{UI.removes}</strong>
        <PickList self={e.id} all={all} tags={tags} ids={e.cancels} picked={e.cancelsTags ?? []} onChange={(cancels, cancelsTags) => edit({ cancels, cancelsTags })} />
      </div>
      <div className="ld-section">
        <strong>{UI.blocks}</strong>
        <PickList self={e.id} all={all} tags={tags} ids={e.blocks ?? []} picked={e.blocksTags ?? []} onChange={(blocks, blocksTags) => edit({ blocks, blocksTags })} />
      </div>

      <Field label={UI.description} wide>
        <ProofTextarea className="input" rows={3} value={e.description} onChange={(x) => edit({ description: x.target.value })} />
      </Field>
      <p className="se-try wide">
        {effectSummary(e, words(unit))}
        {e.tick && e.maxStacks > 1 && ` · ${fill(UI.atStacks, { n: e.maxStacks, t: max.total, k: max.ticks })}`}
        {e.tick && e.maxStacks <= 1 && ` · ${fill(UI.ticks, { k: one.ticks })}`}
      </p>
      <button className="btn btn-danger ld-danger" onClick={remove}>
        <Trash2 size={14} /> {UI.deleteEffect}
      </button>
    </div>
  )
}

/** The fields of one reaction. `saved` false = a draft: the first change saves it. */
function ReactionForm({ r, saved, heading, effects, firstName, edit, remove, pick }: { r: Reaction; saved: boolean; heading: string; effects: StatusEffect[]; firstName: string; edit(p: Partial<Reaction>): void; remove(): void; pick?: boolean }) {
  return (
    <div className="ld-page se-page">
      <h3 className="wide">{heading}</h3>
      {!saved && <p className="muted wide">{UI.notYet}</p>}
      {pick && (
        <>
          <Field label={UI.onTarget}>
            <select className="input" value={r.first} onChange={(x) => edit({ first: x.target.value })}>
              {effects.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={UI.landing}>
            <select className="input" value={r.second} onChange={(x) => edit({ second: x.target.value })}>
              {effects.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
      <Field label={UI.name}>
        <input className="input" value={r.name} onChange={(x) => edit({ name: x.target.value })} />
      </Field>
      <Field label={UI.damageX}>
        <span title={pick ? UI.damageXEffect : undefined}>
          <NumberInput value={r.multiplier} min={0} onChange={(multiplier) => edit({ multiplier })} />
        </span>
      </Field>
      <Field label={UI.adds}>
        <select className="input" value={r.addsEffectId ?? ''} onChange={(x) => edit({ addsEffectId: x.target.value || null })}>
          <option value="">{UI.none}</option>
          {effects.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={fill(UI.usesUp, { a: firstName })}>
        <input type="checkbox" checked={r.consumes} onChange={(x) => edit({ consumes: x.target.checked })} />
      </Field>
      <Field label={UI.description} wide>
        <ProofTextarea className="input" rows={2} value={r.description} onChange={(x) => edit({ description: x.target.value })} />
      </Field>
      {saved && (
        <button className="btn btn-danger ld-danger" onClick={remove}>
          <Trash2 size={14} /> {UI.deleteReaction}
        </button>
      )}
    </div>
  )
}

/** The grid: rows = element already on the target, columns = element of the hit. Arrow keys move, Enter opens, Delete clears. Below it: effect meets effect. */
function Reactions({ d, elements, unit, update }: { d: StatusDoc; elements: string[]; unit: string; update(fn: (d: StatusDoc) => StatusDoc): void }) {
  const [sel, setSel] = useState<{ cell: [string, string] } | { id: string } | null>(null)
  const cell = sel && 'cell' in sel ? sel.cell : null
  const found = cell ? reactionFor(d, cell[0], cell[1]) : undefined
  // A fresh draft per cell; it is only saved once something in it changes.
  const cellKey = cell ? JSON.stringify(cell) : ''
  const draft = useMemo(() => {
    if (!cellKey) return null
    const [a, b] = JSON.parse(cellKey) as [string, string]
    return newReaction(a, b)
  }, [cellKey])
  const effectReactions = d.reactions.filter((r) => r.on === 'effect')
  const picked = sel && 'id' in sel ? effectReactions.find((r) => r.id === sel.id) : undefined
  const nameOf = (id: string) => d.items.find((x) => x.id === id)?.name ?? UI.deleted

  const edit = (id: string, p: Partial<Reaction>) => update((x) => ({ ...x, reactions: x.reactions.map((y) => (y.id === id ? { ...y, ...p } : y)) }))
  const editCell = (p: Partial<Reaction>) => {
    if (found) edit(found.id, p)
    else if (draft) update((x) => ({ ...x, reactions: [...x.reactions, { ...draft, ...p }] }))
  }
  const removeById = (id: string) => update((x) => ({ ...x, reactions: x.reactions.filter((y) => y.id !== id) }))
  const clear = (first: string, second: string) => {
    const r = reactionFor(d, first, second)
    if (r) removeById(r.id)
  }
  const addElement = async () => {
    const name = (await promptDialog(UI.newElement, ''))?.trim()
    if (name && !elements.some((x) => x.toLowerCase() === name.toLowerCase())) update((x) => ({ ...x, elements: [...x.elements, name] }))
  }
  const addEffectReaction = () => {
    const [a, b] = [d.items[0], d.items[1] ?? d.items[0]]
    const r: Reaction = { ...newReaction(a.id, b.id), on: 'effect', name: `${a.name} + ${b.name}` }
    update((x) => ({ ...x, reactions: [...x.reactions, r] }))
    setSel({ id: r.id })
  }
  const onKey = (ev: KeyboardEvent<HTMLButtonElement>, row: number, col: number) => {
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    if (moves[ev.key]) {
      ev.preventDefault()
      const [dr, dc] = moves[ev.key]
      ev.currentTarget.closest('table')?.querySelector<HTMLButtonElement>(`[data-cell="${row + dr}-${col + dc}"]`)?.focus()
    } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault()
      clear(elements[row], elements[col])
    }
  }

  return (
    <div className="se-react">
      <p className="muted">{UI.gridHelp}</p>
      {elements.length === 0 ? (
        <p className="muted">{UI.noElements}</p>
      ) : (
        <div className="se-grid-wrap">
          <table className="se-grid">
            <thead>
              <tr>
                <th>{UI.corner}</th>
                {elements.map((x) => (
                  <th key={x}>{x}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {elements.map((first, row) => (
                <tr key={first}>
                  <th>{first}</th>
                  {elements.map((second, col) => {
                    const r = reactionFor(d, first, second)
                    const on = cell && cell[0] === first && cell[1] === second
                    return (
                      <td key={second}>
                        <button data-cell={`${row}-${col}`} className={`${on ? 'on' : ''}${r ? '' : ' empty'}`} onClick={() => setSel({ cell: [first, second] })} onKeyDown={(ev) => onKey(ev, row, col)} title={fill(UI.then, { a: first, b: second })}>
                          {r ? `${r.name} ×${r.multiplier}` : '·'}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="ld-inline">
        <button className="btn btn-ghost" onClick={addElement}>
          {UI.addElement}
        </button>
        <span className="muted">{UI.stays}</span>
        <NumberInput value={d.auraSeconds ?? AURA_SECONDS} min={0} onChange={(auraSeconds) => update((x) => ({ ...x, auraSeconds }))} />
        <span className="muted">{unit}</span>
      </div>
      {cell && draft && (
        <ReactionForm r={found ?? draft} saved={!!found} heading={fill(UI.then, { a: cell[0], b: cell[1] })} effects={d.items} firstName={cell[0]} edit={editCell} remove={() => clear(cell[0], cell[1])} />
      )}

      <div className="se-meets">
        <strong>{UI.effectMeets}</strong>
        <p className="muted">{UI.effectMeetsHelp}</p>
        <div className="ld-inline se-picks">
          {effectReactions.map((r) => (
            <button key={r.id} className={`btn btn-ghost se-chip${picked?.id === r.id ? ' on' : ''}`} onClick={() => setSel({ id: r.id })}>
              {fill(UI.then, { a: nameOf(r.first), b: nameOf(r.second) })}: {r.name}
            </button>
          ))}
          {d.items.length ? (
            <button className="btn btn-ghost" onClick={addEffectReaction}>
              {UI.addEffectMeets}
            </button>
          ) : (
            <span className="muted">{UI.needEffects}</span>
          )}
        </div>
      </div>
      {picked && (
        <ReactionForm
          pick
          r={picked}
          saved
          heading={fill(UI.then, { a: nameOf(picked.first), b: nameOf(picked.second) })}
          effects={d.items}
          firstName={nameOf(picked.first)}
          edit={(p) => edit(picked.id, p)}
          remove={() => {
            removeById(picked.id)
            setSel(null)
          }}
        />
      )}
    </div>
  )
}
