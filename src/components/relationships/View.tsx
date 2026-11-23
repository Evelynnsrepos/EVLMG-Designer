import { CalendarDays, Flag as FlagIcon, Gift, Link2, ListOrdered, Network, NotebookPen, SlidersHorizontal, Trash2, TriangleAlert, Unlock } from 'lucide-react'
import { useState } from 'react'
import { newId, type Entity, type Id } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useProjectStore, useUndoRedoKeys } from '@/core/state'
import { createFactionsDoc, LEVELS, relation, type FactionsDoc } from '@/components/factions/model'
import { useCalendar } from '@/shared/calendar'
import { LineChart, NumberInput } from '@/shared/calculators'
import { jumpTo } from '@/shared/entityList'
import { toFlagName, useFlags } from '@/shared/flags'
import { localized, useLang } from '@/shared/i18n'
import { pickJumpTarget, targetLabel } from '@/shared/jumps/Jumps'
import { Field, ListDetail, useItems } from '@/shared/listDetail'
import { ProofTextarea } from '@/shared/spell'
import {
  actionPoints,
  BOND_KINDS,
  bondFlagText,
  clampLines,
  createRelationshipsDoc,
  daysPerRank,
  groupMates,
  moodsOf,
  newBond,
  pointsPerDay,
  rankCost,
  rankLadder,
  rankTotals,
  RELATIONSHIPS_DOC,
  withMoods,
  type Bond,
  type MoodDef,
  type RankCurve,
  type RankLine,
  type RelationshipsDoc,
} from './model'
import './relationships.css'

const UI = localized(
  {
    newBond: 'New bond',
    empty: 'No bonds yet. Make one with New bond.',
    emptyNoChars: 'No bonds yet. Add characters in the Character List (or factions in Factions), then make a bond with New bond.',
    rules: 'Points & actions',
    network: 'Network',
    player: 'The player',
    pick: 'Pick a character or faction',
    deleted: '(deleted)',
    untitled: 'Untitled',
    characters: 'Characters',
    factions: 'Factions',
    feels: 'Who feels it',
    towards: 'Towards',
    bond: 'Bond',
    group: 'Pick-one group',
    groupTip: 'Bonds with the same group name shut each other out, e.g. only one romance',
    groupRank: 'Only one can go past rank',
    groupWarn: (names: string) => `Shares its group with ${names}: only one of them can go past the rank set here.`,
    maxIn: (n: number, units: string) => `top in ${n} ${units}`,
    ranksUp: 'Ranks above zero',
    ranksDown: 'Ranks below zero',
    ranksDownTip: '0 = the bond never goes below the start. Set ranks here for dislike, hate or a nemesis.',
    perRank: 'Points per rank',
    flat: 'Same for every rank',
    linear: 'A bit more each rank',
    growing: 'Grows by a percent',
    custom: 'Typed by hand',
    firstRank: 'First rank',
    morePerRank: 'More per rank',
    growsBy: 'Grows by %',
    decay: (unit: string) => `Points lost per ${unit}`,
    decayTip: 'The bond slowly fades when the player does nothing. 0 = never.',
    cap: (unit: string) => `Most points per ${unit}`,
    capTip: '0 = no limit',
    tabRanks: 'Ranks & plan',
    tabGifts: 'Gifts & actions',
    tabUnlocks: 'Unlocks & needs',
    tabSchedule: 'When they’re free',
    tabNotes: 'Flag & notes',
    rank: 'Rank',
    name: 'Name',
    points: 'Points',
    total: 'Total',
    needs: 'Needs',
    unlocks: 'Unlocks',
    start: 'Start',
    plan: 'Plan',
    planText: (per: number, unit: string, top: number) => `${per} points per ${unit} with the actions and gifts under Points & actions: top rank on ${unit} ${top}.`,
    planNone: (unit: string) => `A player gains no points per ${unit} yet: set how often actions happen under Points & actions, or lower the points lost.`,
    gifts: 'Gifts',
    addGift: 'Add an item from the Item List…',
    noItems: 'Add items in the Item List to pick gifts.',
    deletedItem: '(deleted item)',
    ownPoints: 'Points for this bond',
    ownPointsTip: 'Leave empty to use the points under Points & actions',
    unlockTitle: 'What each rank unlocks',
    gateTitle: 'What a player needs before a rank',
    gateHint: 'A quest done, a story point, a flag… The rank stays closed until then.',
    addUnlock: '+ Unlock',
    addGate: '+ Need',
    link: 'Link',
    linkTip: 'Link a quest, dialogue, ability or anything else',
    linkAsk: 'What does this line point at?',
    open: 'Open',
    remove: 'Remove',
    unlocksLabel: 'Unlocks',
    needsLabel: 'Needs',
    addFree: '+ Free time',
    to: 'to',
    from: 'From',
    till: 'To',
    weekdaysFrom: 'Weekdays come from the Calendar tool.',
    flagTitle: 'Flag for dialogues and quests',
    flagHolds: (name: string, example: number, rank: number) => `${name} holds the bond's points. Dialogue Editor and Quests can check it, for example ${name} >= ${example} for rank ${rank}.`,
    makeFlag: 'Make a flag',
    renameFlag: (name: string) => `Rename to ${name}`,
    notes: 'Notes',
    deleteBond: 'Delete bond',
    rulesHint: (unit: string) => `These count for every bond. Per ${unit} is how often a player does it in one ${unit} (0.2 = once every five); it only feeds the plan. A bond can set its own points under Gifts & actions.`,
    unitTitle: 'The plan counts in',
    unitOne: 'One',
    unitMany: 'Many',
    unitTip: 'day / days, mission / missions, turn / turns, hour / hours…',
    actions: 'Actions that raise or lower a bond',
    action: 'Action',
    perUnit: (unit: string) => `Per ${unit}`,
    addAction: '+ Action',
    moods: 'Gift moods',
    moodsHint: 'Your own moods and their points. Add, rename or remove them; gifts that used a removed mood count 0.',
    addMood: '+ Mood',
    newMood: 'New mood',
    moodColor: 'Colour',
    giftsPer: (unit: string) => `Gifts per ${unit}`,
    netHint: 'Lines are bonds (click one to open it). Dashed lines are how factions feel about each other in Factions.',
    netEmpty: 'Make a bond to see who is tied to whom.',
    day: 'day',
    days: 'days',
  },
  {
    newBond: 'Neue Bindung',
    empty: 'Noch keine Bindungen. Leg eine mit Neue Bindung an.',
    emptyNoChars: 'Noch keine Bindungen. Leg Figuren in der Character List an (oder Fraktionen in Factions), dann eine Bindung mit Neue Bindung.',
    rules: 'Punkte & Aktionen',
    network: 'Netz',
    player: 'Der Spieler',
    pick: 'Figur oder Fraktion wählen',
    deleted: '(gelöscht)',
    untitled: 'Ohne Namen',
    characters: 'Figuren',
    factions: 'Fraktionen',
    feels: 'Wer fühlt es',
    towards: 'Gegenüber',
    bond: 'Bindung',
    group: 'Nur-eine-Gruppe',
    groupTip: 'Bindungen mit gleichem Gruppennamen schließen sich aus, z. B. nur eine Romanze',
    groupRank: 'Nur eine kommt über Rang',
    groupWarn: (names: string) => `Teilt die Gruppe mit ${names}: nur eine davon kommt über den hier gesetzten Rang.`,
    maxIn: (n: number, units: string) => `ganz oben in ${n} ${units}`,
    ranksUp: 'Ränge über null',
    ranksDown: 'Ränge unter null',
    ranksDownTip: '0 = die Bindung fällt nie unter den Start. Setz hier Ränge für Abneigung, Hass oder Erzfeinde.',
    perRank: 'Punkte pro Rang',
    flat: 'Gleich für jeden Rang',
    linear: 'Jeder Rang etwas mehr',
    growing: 'Wächst um Prozent',
    custom: 'Von Hand eingetragen',
    firstRank: 'Erster Rang',
    morePerRank: 'Mehr pro Rang',
    growsBy: 'Wächst um %',
    decay: (unit: string) => `Punkte weniger pro ${unit}`,
    decayTip: 'Die Bindung verblasst langsam, wenn der Spieler nichts tut. 0 = nie.',
    cap: (unit: string) => `Höchstens Punkte pro ${unit}`,
    capTip: '0 = keine Grenze',
    tabRanks: 'Ränge & Plan',
    tabGifts: 'Geschenke & Aktionen',
    tabUnlocks: 'Freischaltungen & Bedingungen',
    tabSchedule: 'Wann sie Zeit haben',
    tabNotes: 'Flag & Notizen',
    rank: 'Rang',
    name: 'Name',
    points: 'Punkte',
    total: 'Summe',
    needs: 'Braucht',
    unlocks: 'Schaltet frei',
    start: 'Start',
    plan: 'Plan',
    planText: (per: number, unit: string, top: number) => `${per} Punkte pro ${unit} mit den Aktionen und Geschenken unter Punkte & Aktionen: höchster Rang an ${unit} ${top}.`,
    planNone: (unit: string) => `Noch keine Punkte pro ${unit}: Stell unter Punkte & Aktionen ein, wie oft Aktionen passieren, oder senk den Punkteverlust.`,
    gifts: 'Geschenke',
    addGift: 'Gegenstand aus der Item List hinzufügen…',
    noItems: 'Leg Gegenstände in der Item List an, um Geschenke zu wählen.',
    deletedItem: '(gelöschter Gegenstand)',
    ownPoints: 'Punkte für diese Bindung',
    ownPointsTip: 'Leer lassen für die Punkte unter Punkte & Aktionen',
    unlockTitle: 'Was jeder Rang freischaltet',
    gateTitle: 'Was ein Spieler vor einem Rang braucht',
    gateHint: 'Eine erledigte Quest, ein Story-Punkt, ein Flag… Der Rang bleibt bis dahin zu.',
    addUnlock: '+ Freischaltung',
    addGate: '+ Bedingung',
    link: 'Verknüpfen',
    linkTip: 'Mit einer Quest, einem Dialog, einer Fähigkeit oder etwas anderem verknüpfen',
    linkAsk: 'Worauf zeigt diese Zeile?',
    open: 'Öffnen',
    remove: 'Entfernen',
    unlocksLabel: 'Freischaltung',
    needsLabel: 'Bedingung',
    addFree: '+ Freie Zeit',
    to: 'bis',
    from: 'Von',
    till: 'Bis',
    weekdaysFrom: 'Die Wochentage kommen aus dem Calendar-Werkzeug.',
    flagTitle: 'Flag für Dialoge und Quests',
    flagHolds: (name: string, example: number, rank: number) => `${name} enthält die Punkte der Bindung. Dialogue Editor und Quests können es prüfen, z. B. ${name} >= ${example} für Rang ${rank}.`,
    makeFlag: 'Flag anlegen',
    renameFlag: (name: string) => `Umbenennen in ${name}`,
    notes: 'Notizen',
    deleteBond: 'Bindung löschen',
    rulesHint: (unit: string) => `Das gilt für jede Bindung. Pro ${unit} heißt, wie oft ein Spieler es in einem ${unit} tut (0,2 = einmal in fünf); das zählt nur für den Plan. Eine Bindung kann unter Geschenke & Aktionen eigene Punkte haben.`,
    unitTitle: 'Der Plan zählt in',
    unitOne: 'Einzahl',
    unitMany: 'Mehrzahl',
    unitTip: 'Tag / Tage, Mission / Missionen, Zug / Züge, Stunde / Stunden…',
    actions: 'Aktionen, die eine Bindung heben oder senken',
    action: 'Aktion',
    perUnit: (unit: string) => `Pro ${unit}`,
    addAction: '+ Aktion',
    moods: 'Geschenk-Stimmungen',
    moodsHint: 'Deine eigenen Stimmungen und ihre Punkte. Füg welche hinzu, benenn sie um oder entfern sie; Geschenke mit einer entfernten Stimmung zählen 0.',
    addMood: '+ Stimmung',
    newMood: 'Neue Stimmung',
    moodColor: 'Farbe',
    giftsPer: (unit: string) => `Geschenke pro ${unit}`,
    netHint: 'Linien sind Bindungen (zum Öffnen anklicken). Gestrichelte Linien zeigen, wie Fraktionen in Factions zueinander stehen.',
    netEmpty: 'Leg eine Bindung an, um zu sehen, wer mit wem verbunden ist.',
    day: 'Tag',
    days: 'Tage',
  },
)

/** Bond kinds get steady colours from their name, so rows and network lines tell kinds apart. */
const KIND_COLORS = ['#c2255c', '#1971c2', '#2f9e44', '#f08c00', '#9c36b5', '#0c8599', '#e03131', '#5c940d']
const kindColor = (kind: string) => KIND_COLORS[[...kind.trim().toLowerCase()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % KIND_COLORS.length]

const RULES = '__rules'
const NETWORK = '__network'

type Who = { id: Id; name: string; kind: 'character' | 'faction' }

/** Relationships (missing tools phase 2, review fixes 0.35). */
export default function View({ active }: PanelProps) {
  useLang()
  const doc = useDocument<RelationshipsDoc>(RELATIONSHIPS_DOC.type, RELATIONSHIPS_DOC.id, createRelationshipsDoc)
  const list = useItems<Bond, RelationshipsDoc>(RELATIONSHIPS_DOC.type, RELATIONSHIPS_DOC.id, createRelationshipsDoc)
  const factionsDoc = useDocument<FactionsDoc>('factions', 'factions', createFactionsDoc).data
  useUndoRedoKeys(doc, active)
  const characters = useProjectStore((s) => s.entities.character) as Entity[]
  const items = useProjectStore((s) => s.entities.item) as Entity[]
  const [selectedId, setSelectedId] = useState<string | null>(null)
  if (!doc.data) return null
  const d = doc.data
  const who: Who[] = [...characters.map((c) => ({ id: c.id, name: c.name || UI.untitled, kind: 'character' as const })), ...(factionsDoc?.items ?? []).map((f) => ({ id: f.id, name: f.name || UI.untitled, kind: 'faction' as const }))]
  const whoName = (id: Id | null | undefined, none: string) => (id ? (who.find((w) => w.id === id)?.name ?? UI.deleted) : none)
  const titleOf = (x: Bond) => {
    const to = whoName(x.characterId, UI.pick)
    return x.fromId ? `${whoName(x.fromId, UI.player)} → ${to}` : to
  }
  const b = list.items.find((x) => x.id === selectedId)
  const units = d.units?.trim() || UI.days

  const add = () => {
    const free = characters.find((c) => !d.items.some((x) => x.characterId === c.id && !x.fromId))
    const n = newBond(free?.id ?? null)
    list.add(n)
    setSelectedId(n.id)
  }

  const tab = (id: string, icon: React.ReactNode, label: string) => (
    <button className={`btn btn-ghost${selectedId === id ? ' on' : ''}`} aria-pressed={selectedId === id} onClick={() => setSelectedId(id)}>
      {icon} {label}
    </button>
  )

  return (
    <ListDetail
      rows={list.items.map((x) => {
        const days = daysPerRank(x, d).at(-1)
        const sub = [x.bondKind, x.group?.trim(), days !== undefined && Number.isFinite(days) ? UI.maxIn(days, units) : ''].filter(Boolean).join(' · ')
        return { id: x.id, label: titleOf(x), sub, color: kindColor(x.bondKind) }
      })}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onAdd={add}
      addLabel={UI.newBond}
      empty={who.length ? UI.empty : UI.emptyNoChars}
      toolbar={
        <>
          {tab(RULES, <SlidersHorizontal size={14} />, UI.rules)}
          {tab(NETWORK, <Network size={14} />, UI.network)}
        </>
      }
    >
      {selectedId === RULES ? (
        <Rules d={d} update={(fn) => doc.update(fn)} />
      ) : selectedId === NETWORK ? (
        <NetworkView bonds={d.items} who={who} factions={factionsDoc} titleOf={titleOf} open={setSelectedId} />
      ) : (
        b && <BondPage key={b.id} b={b} d={d} who={who} whoName={whoName} items={items} edit={(p) => list.edit(b.id, p)} remove={() => (list.remove(b.id), setSelectedId(null))} />
      )}
    </ListDetail>
  )
}

function Rules({ d, update }: { d: RelationshipsDoc; update(fn: (d: RelationshipsDoc) => RelationshipsDoc): void }) {
  const unit = d.unit?.trim() || UI.day
  const moods = moodsOf(d)
  const editAction = (id: string, p: Partial<RelationshipsDoc['actions'][number]>) => update((x) => ({ ...x, actions: x.actions.map((a) => (a.id === id ? { ...a, ...p } : a)) }))
  const setMoods = (fn: (m: MoodDef[]) => MoodDef[]) => update((x) => withMoods(x, fn(moodsOf(x))))
  return (
    <div className="ld-page">
      <h3>{UI.rules}</h3>
      <p className="muted wide">{UI.rulesHint(unit)}</p>
      <div className="ld-section">
        <strong>{UI.unitTitle}</strong>
        <div className="ld-inline" title={UI.unitTip}>
          <label className="ld-field rel-num">
            <span>{UI.unitOne}</span>
            <input className="input" value={d.unit ?? ''} placeholder={UI.day} onChange={(e) => update((x) => ({ ...x, unit: e.target.value }))} />
          </label>
          <label className="ld-field rel-num">
            <span>{UI.unitMany}</span>
            <input className="input" value={d.units ?? ''} placeholder={UI.days} onChange={(e) => update((x) => ({ ...x, units: e.target.value }))} />
          </label>
        </div>
      </div>
      <div className="ld-section">
        <strong>{UI.actions}</strong>
        {d.actions.map((a) => (
          <div key={a.id} className="ld-inline">
            <input className="input" value={a.name} onChange={(e) => editAction(a.id, { name: e.target.value })} aria-label={UI.action} />
            <label className="ld-inline">
              {UI.points} <NumberInput value={a.points} onChange={(points) => editAction(a.id, { points })} />
            </label>
            <label className="ld-inline">
              {UI.perUnit(unit)} <NumberInput value={a.perDay} min={0} onChange={(perDay) => editAction(a.id, { perDay })} />
            </label>
            <button className="btn btn-ghost" title={UI.remove} aria-label={UI.remove} onClick={() => update((x) => ({ ...x, actions: x.actions.filter((y) => y.id !== a.id) }))}>
              ×
            </button>
          </div>
        ))}
        <button className="btn btn-ghost" onClick={() => update((x) => ({ ...x, actions: [...x.actions, { id: newId(), name: UI.action, points: 10, perDay: 1 }] }))}>
          {UI.addAction}
        </button>
      </div>
      <div className="ld-section">
        <strong>{UI.moods}</strong>
        <p className="muted">{UI.moodsHint}</p>
        {moods.map((m) => (
          <div key={m.id} className="ld-inline">
            <input className="rel-color" type="color" value={m.color} title={UI.moodColor} aria-label={UI.moodColor} onChange={(e) => setMoods((ms) => ms.map((x) => (x.id === m.id ? { ...x, color: e.target.value } : x)))} />
            <input className="input" value={m.label} aria-label={UI.name} onChange={(e) => setMoods((ms) => ms.map((x) => (x.id === m.id ? { ...x, label: e.target.value } : x)))} />
            <label className="ld-inline">
              {UI.points} <NumberInput value={m.points} onChange={(points) => setMoods((ms) => ms.map((x) => (x.id === m.id ? { ...x, points } : x)))} />
            </label>
            <button className="btn btn-ghost" title={UI.remove} aria-label={UI.remove} onClick={() => setMoods((ms) => ms.filter((x) => x.id !== m.id))}>
              ×
            </button>
          </div>
        ))}
        <button className="btn btn-ghost" onClick={() => setMoods((ms) => [...ms, { id: newId(), label: UI.newMood, points: 0, color: '#868e96' }])}>
          {UI.addMood}
        </button>
        <label className="ld-field rel-num">
          <span>{UI.giftsPer(unit)}</span>
          <NumberInput value={d.giftsPerDay} min={0} onChange={(giftsPerDay) => update((x) => ({ ...x, giftsPerDay }))} />
        </label>
      </div>
    </div>
  )
}

/** Who's tied to whom: everyone in a bond on a circle, bonds as lines, faction feelings from Factions dashed. */
function NetworkView({ bonds, who, factions, titleOf, open }: { bonds: Bond[]; who: Who[]; factions: FactionsDoc | null | undefined; titleOf(b: Bond): string; open(id: string): void }) {
  const ends = (x: Bond) => [x.fromId ?? 'player', x.characterId].filter((v): v is string => !!v)
  const ids = [...new Set(bonds.flatMap(ends))]
  if (!ids.length) return <div className="ld-page"><p className="muted">{UI.netEmpty}</p></div>
  const size = 520
  const r = ids.length === 1 ? 0 : size / 2 - 80
  const pos = Object.fromEntries(ids.map((id, i) => [id, { x: size / 2 + r * Math.cos((2 * Math.PI * i) / ids.length - Math.PI / 2), y: size / 2 + r * Math.sin((2 * Math.PI * i) / ids.length - Math.PI / 2) }]))
  const name = (id: string) => (id === 'player' ? UI.player : (who.find((w) => w.id === id)?.name ?? UI.deleted))
  const fIds = ids.filter((id) => who.find((w) => w.id === id)?.kind === 'faction')
  const fLines = factions ? fIds.flatMap((a, i) => fIds.slice(i + 1).map((b) => ({ a, b, v: relation(factions, a, b) }))).filter((l) => l.v !== 0) : []
  return (
    <div className="ld-page">
      <h3>{UI.network}</h3>
      <p className="muted wide">{UI.netHint}</p>
      <svg className="rel-net wide" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={UI.network}>
        {fLines.map((l) => (
          <g key={`${l.a}|${l.b}`} className="rel-net-faction">
            <line x1={pos[l.a].x} y1={pos[l.a].y} x2={pos[l.b].x} y2={pos[l.b].y} stroke={l.v > 0 ? 'var(--success, #2f9e44)' : 'var(--danger)'} />
            <text x={(pos[l.a].x + pos[l.b].x) / 2} y={(pos[l.a].y + pos[l.b].y) / 2 + 14}>{[...LEVELS].sort((p, q) => Math.abs(p.value - l.v) - Math.abs(q.value - l.v))[0].label}</text>
          </g>
        ))}
        {bonds.map((x) => {
          const [a, c] = ends(x)
          if (!c) return null
          return (
            <g key={x.id} className="rel-net-bond" onClick={() => open(x.id)} role="button" aria-label={titleOf(x)}>
              <title>{`${titleOf(x)}: ${x.bondKind}`}</title>
              <line x1={pos[a].x} y1={pos[a].y} x2={pos[c].x} y2={pos[c].y} stroke={kindColor(x.bondKind)} />
              <text x={(pos[a].x + pos[c].x) / 2} y={(pos[a].y + pos[c].y) / 2 - 4} fill={kindColor(x.bondKind)}>{x.bondKind}</text>
            </g>
          )
        })}
        {ids.map((id) => (
          <g key={id} className={`rel-net-node${id === 'player' ? ' player' : ''}`}>
            <circle cx={pos[id].x} cy={pos[id].y} r={8} />
            <text x={pos[id].x} y={pos[id].y + 24}>{name(id)}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}

type Tab = 'ranks' | 'gifts' | 'unlocks' | 'schedule' | 'notes'

function BondPage({ b, d, who, whoName, items, edit, remove }: { b: Bond; d: RelationshipsDoc; who: Who[]; whoName(id: Id | null | undefined, none: string): string; items: Entity[]; edit(p: Partial<Bond>): void; remove(): void }) {
  const [tab, setTab] = useState<Tab>('ranks')
  const flags = useFlags()
  const calendar = useCalendar().data
  const unit = d.unit?.trim() || UI.day
  const totals = rankTotals(b)
  const ladder = rankLadder(b)
  const days = daysPerRank(b, d)
  const per = pointsPerDay(b, d)
  const moods = moodsOf(d)
  const setCurve = (p: Partial<RankCurve>) => edit({ curve: { ...b.curve, ...p } })
  const setRanks = (p: Pick<Bond, 'ranks'> | Pick<Bond, 'minRanks'>) => edit({ ...p, ...clampLines({ ...b, ...p }) })
  const flag = flags.flags.find((f) => f.id === b.flagId)
  const toName = b.characterId ? (who.find((w) => w.id === b.characterId)?.name ?? null) : null
  const fromName = b.fromId ? (who.find((w) => w.id === b.fromId)?.name ?? null) : null
  const wantFlag = toFlagName(bondFlagText(toName, fromName))
  const mates = groupMates(b, d.items)
  const groups = [...new Set(d.items.map((x) => x.group?.trim()).filter(Boolean))] as string[]
  const weekdays = calendar?.weekdays?.length ? calendar.weekdays : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const lo = -Math.max(0, b.minRanks ?? 0)
  const linesAt = (ls: RankLine[] | undefined, r: number) => (ls ?? []).filter((u) => u.rank === r).map((u) => u.text).join(', ')

  const picker = (value: Id | null | undefined, none: string, onChange: (id: Id | null) => void, label: string, big?: boolean) => (
    <select className={`input${big ? ' rel-who' : ''}`} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} aria-label={label}>
      <option value="">{none}</option>
      {value && !who.some((w) => w.id === value) && <option value={value}>{UI.deleted}</option>}
      {(['character', 'faction'] as const).map((k) => (
        <optgroup key={k} label={k === 'character' ? UI.characters : UI.factions}>
          {who
            .filter((w) => w.kind === k && w.id !== (big ? b.fromId : b.characterId))
            .map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  )

  const tabBtn = (id: Tab, icon: React.ReactNode, label: string) => (
    <button role="tab" aria-selected={tab === id} className={`btn btn-ghost${tab === id ? ' on' : ''}`} onClick={() => setTab(id)}>
      {icon} {label}
    </button>
  )

  return (
    <div className="ld-page">
      <div className="wide ld-inline">{picker(b.characterId, UI.pick, (characterId) => edit({ characterId }), UI.towards, true)}</div>
      <Field label={UI.feels}>{picker(b.fromId, UI.player, (fromId) => edit({ fromId }), UI.feels)}</Field>
      <Field label={UI.bond}>
        <input className="input" list="rel-kinds" value={b.bondKind} onChange={(e) => edit({ bondKind: e.target.value })} />
        <datalist id="rel-kinds">
          {BOND_KINDS.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
      </Field>
      <Field label={UI.group}>
        <input className="input" list="rel-groups" title={UI.groupTip} value={b.group ?? ''} onChange={(e) => edit({ group: e.target.value })} />
        <datalist id="rel-groups">
          {groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
      </Field>
      {!!b.group?.trim() && (
        <Field label={UI.groupRank}>
          <NumberInput value={b.groupRank ?? Math.min(b.ranks, 5)} min={0} max={b.ranks} onChange={(groupRank) => edit({ groupRank: Math.round(groupRank) })} />
        </Field>
      )}
      {mates.length > 0 && (
        <p className="wide rel-warn">
          <TriangleAlert size={14} /> {UI.groupWarn(mates.map((m) => whoName(m.characterId, UI.pick)).join(', '))}
        </p>
      )}

      <div className="wide rel-tabs" role="tablist">
        {tabBtn('ranks', <ListOrdered size={14} />, UI.tabRanks)}
        {tabBtn('gifts', <Gift size={14} />, UI.tabGifts)}
        {tabBtn('unlocks', <Unlock size={14} />, UI.tabUnlocks)}
        {tabBtn('schedule', <CalendarDays size={14} />, UI.tabSchedule)}
        {tabBtn('notes', <NotebookPen size={14} />, UI.tabNotes)}
      </div>

      {tab === 'ranks' && (
        <>
          <Field label={UI.ranksUp}>
            <NumberInput value={b.ranks} min={1} max={100} onChange={(ranks) => setRanks({ ranks: Math.max(1, Math.round(ranks)) })} />
          </Field>
          <Field label={UI.ranksDown}>
            <span title={UI.ranksDownTip}>
              <NumberInput value={b.minRanks ?? 0} min={0} max={100} onChange={(v) => setRanks({ minRanks: Math.max(0, Math.round(v)) })} />
            </span>
          </Field>
          <Field label={UI.perRank}>
            <select className="input" value={b.curve.mode} onChange={(e) => setCurve({ mode: e.target.value as RankCurve['mode'], custom: b.curve.custom.length ? b.curve.custom : totals.map((_, i) => rankCost(b.curve, i + 1)) })}>
              <option value="flat">{UI.flat}</option>
              <option value="linear">{UI.linear}</option>
              <option value="growing">{UI.growing}</option>
              <option value="custom">{UI.custom}</option>
            </select>
          </Field>
          {b.curve.mode !== 'custom' && (
            <Field label={UI.firstRank}>
              <NumberInput value={b.curve.base} min={0} onChange={(base) => setCurve({ base })} />
            </Field>
          )}
          {(b.curve.mode === 'linear' || b.curve.mode === 'growing') && (
            <Field label={b.curve.mode === 'linear' ? UI.morePerRank : UI.growsBy}>
              <NumberInput value={b.curve.step} onChange={(step) => setCurve({ step })} />
            </Field>
          )}
          <Field label={UI.decay(unit)}>
            <span title={UI.decayTip}>
              <NumberInput value={b.decay ?? 0} min={0} onChange={(decay) => edit({ decay })} />
            </span>
          </Field>
          <Field label={UI.cap(unit)}>
            <span title={UI.capTip}>
              <NumberInput value={b.cap ?? 0} min={0} onChange={(cap) => edit({ cap })} />
            </span>
          </Field>

          <div className="ld-section">
            <table className="calc-table rel-ranks">
              <thead>
                <tr>
                  <th>{UI.rank}</th>
                  <th>{UI.name}</th>
                  <th>{UI.points}</th>
                  <th>{UI.total}</th>
                  <th>{unit}</th>
                  <th>{UI.needs}</th>
                  <th>{UI.unlocks}</th>
                </tr>
              </thead>
              <tbody>
                {ladder.map((x) => (
                  <tr key={x.rank} className={x.rank === 0 ? 'rel-zero' : x.rank < 0 ? 'rel-neg' : undefined}>
                    <td>{x.rank}</td>
                    <td>
                      <input
                        className="input"
                        value={b.rankNames?.[x.rank] ?? ''}
                        placeholder={x.rank === 0 ? UI.start : ''}
                        aria-label={`${UI.name} ${x.rank}`}
                        onChange={(e) => edit({ rankNames: { ...b.rankNames, [x.rank]: e.target.value } })}
                      />
                    </td>
                    <td>
                      {x.rank === 0 ? '' : b.curve.mode === 'custom' ? (
                        <NumberInput value={x.cost} min={0} onChange={(v) => setCurve({ custom: Array.from({ length: Math.max(b.ranks, -lo) }, (_, j) => (j === Math.abs(x.rank) - 1 ? v : rankCost(b.curve, j + 1))) })} />
                      ) : (
                        x.cost
                      )}
                    </td>
                    <td>{x.total}</td>
                    <td>{x.rank > 0 && Number.isFinite(days[x.rank - 1]) ? days[x.rank - 1] : '–'}</td>
                    <td className="muted">{linesAt(b.gates, x.rank)}</td>
                    <td className="muted">{linesAt(b.unlocks, x.rank)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ld-section">
            <strong>{UI.plan}</strong>
            <p className="muted">{per > 0 ? UI.planText(Math.round(per * 10) / 10, unit, days.at(-1) ?? 0) : UI.planNone(unit)}</p>
            {per > 0 && totals.length > 1 && <LineChart xs={days.map((x) => (Number.isFinite(x) ? x : 0))} series={[{ name: UI.rank, values: totals.map((_, i) => i + 1) }]} xLabel={d.units?.trim() || UI.days} />}
          </div>
        </>
      )}

      {tab === 'gifts' && (
        <>
          <div className="ld-section">
            <strong>{UI.gifts}</strong>
            {b.gifts.map((g, i) => (
              <div key={g.itemId} className="ld-inline">
                <span className="rel-gift-name">{items.find((x) => x.id === g.itemId)?.name ?? UI.deletedItem}</span>
                <select className="input" value={g.mood} onChange={(e) => edit({ gifts: b.gifts.map((x, j) => (j === i ? { ...x, mood: e.target.value } : x)) })}>
                  {!moods.some((m) => m.id === g.mood) && <option value={g.mood}>{UI.deleted}</option>}
                  {moods.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} ({m.points > 0 ? '+' : ''}
                      {m.points})
                    </option>
                  ))}
                </select>
                <span className="rel-dot" style={{ background: moods.find((m) => m.id === g.mood)?.color }} />
                <button className="btn btn-ghost" title={UI.remove} aria-label={UI.remove} onClick={() => edit({ gifts: b.gifts.filter((_, j) => j !== i) })}>
                  ×
                </button>
              </div>
            ))}
            {items.length ? (
              <select className="input" value="" onChange={(e) => e.target.value && edit({ gifts: [...b.gifts, { itemId: e.target.value, mood: moods.find((m) => m.id === 'like')?.id ?? moods[0]?.id ?? 'neutral' }] })}>
                <option value="">{UI.addGift}</option>
                {items
                  .filter((x) => !b.gifts.some((g) => g.itemId === x.id))
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name || UI.untitled}
                    </option>
                  ))}
              </select>
            ) : (
              <p className="muted">{UI.noItems}</p>
            )}
          </div>
          <div className="ld-section">
            <strong>{UI.ownPoints}</strong>
            {d.actions.map((a) => (
              <label key={a.id} className="ld-inline" title={UI.ownPointsTip}>
                <span className="rel-gift-name">{a.name}</span>
                <input
                  className="input rel-num-input"
                  type="number"
                  value={b.actionPoints?.[a.id] ?? ''}
                  placeholder={String(a.points)}
                  onChange={(e) => {
                    const next = { ...b.actionPoints }
                    if (e.target.value === '' || !Number.isFinite(Number(e.target.value))) delete next[a.id]
                    else next[a.id] = Number(e.target.value)
                    edit({ actionPoints: next })
                  }}
                />
                <span className="muted">= {actionPoints(b, a)}</span>
              </label>
            ))}
          </div>
        </>
      )}

      {tab === 'unlocks' && (
        <>
          <RankLines title={UI.unlockTitle} label={UI.unlocksLabel} addLabel={UI.addUnlock} lines={b.unlocks} lo={lo} hi={b.ranks} onChange={(unlocks) => edit({ unlocks })} />
          <RankLines title={UI.gateTitle} hint={UI.gateHint} label={UI.needsLabel} addLabel={UI.addGate} lines={b.gates ?? []} lo={lo} hi={b.ranks} onChange={(gates) => edit({ gates })} />
        </>
      )}

      {tab === 'schedule' && (
        <div className="ld-section">
          <strong>{UI.tabSchedule}</strong>
          {calendar?.weekdays?.length ? <p className="muted">{UI.weekdaysFrom}</p> : null}
          {b.free.map((f, i) => (
            <div key={f.id} className="ld-inline">
              <select className="input" value={f.day} onChange={(e) => edit({ free: b.free.map((x, j) => (j === i ? { ...x, day: Number(e.target.value) } : x)) })}>
                {f.day >= weekdays.length && <option value={f.day}>{f.day + 1}</option>}
                {weekdays.map((w, k) => (
                  <option key={k} value={k}>
                    {w}
                  </option>
                ))}
              </select>
              <input className="input" type="time" value={f.from} onChange={(e) => edit({ free: b.free.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)) })} aria-label={UI.from} />
              <span>{UI.to}</span>
              <input className="input" type="time" value={f.to} onChange={(e) => edit({ free: b.free.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)) })} aria-label={UI.till} />
              <button className="btn btn-ghost" title={UI.remove} aria-label={UI.remove} onClick={() => edit({ free: b.free.filter((_, j) => j !== i) })}>
                ×
              </button>
            </div>
          ))}
          <button className="btn btn-ghost" onClick={() => edit({ free: [...b.free, { id: newId(), day: 0, from: '18:00', to: '21:00' }] })}>
            {UI.addFree}
          </button>
        </div>
      )}

      {tab === 'notes' && (
        <>
          <div className="ld-section">
            <strong>{UI.flagTitle}</strong>
            {flag ? (
              <>
                <p className="muted">
                  <FlagIcon size={12} /> {UI.flagHolds(flag.name, totals[Math.min(2, totals.length - 1)] ?? 0, Math.min(3, totals.length))}
                </p>
                {flag.name !== wantFlag && (
                  <button className="btn btn-ghost" onClick={() => flags.update(flag.id, { name: wantFlag })}>
                    <FlagIcon size={14} /> {UI.renameFlag(wantFlag)}
                  </button>
                )}
              </>
            ) : (
              <button className="btn btn-ghost" onClick={() => edit({ flagId: flags.add(wantFlag, 'number').id })}>
                <FlagIcon size={14} /> {UI.makeFlag}
              </button>
            )}
          </div>
          <Field label={UI.notes} wide>
            <ProofTextarea className="input" rows={4} value={b.notes} onChange={(e) => edit({ notes: e.target.value })} />
          </Field>
        </>
      )}

      <button className="btn btn-danger ld-danger" onClick={remove}>
        <Trash2 size={14} /> {UI.deleteBond}
      </button>
    </div>
  )
}

/** Unlocks and needs share one list: a rank, a line of text and an optional link. */
function RankLines({ title, hint, label, addLabel, lines, lo, hi, onChange }: { title: string; hint?: string; label: string; addLabel: string; lines: RankLine[]; lo: number; hi: number; onChange(l: RankLine[]): void }) {
  const set = (i: number, p: Partial<RankLine>) => onChange(lines.map((x, j) => (j === i ? { ...x, ...p } : x)))
  return (
    <div className="ld-section">
      <strong>{title}</strong>
      {hint && <p className="muted">{hint}</p>}
      {lines.map((u, i) => (
        <div key={u.id} className="ld-inline">
          <label className="ld-inline">
            {UI.rank} <NumberInput value={u.rank} min={lo} max={hi} onChange={(rank) => set(i, { rank: Math.round(rank) || (rank < 0 ? -1 : 1) })} />
          </label>
          <input className="input rel-grow" value={u.text} onChange={(e) => set(i, { text: e.target.value })} aria-label={label} />
          {u.target ? (
            <button className="btn btn-ghost" title={UI.open} onClick={() => jumpTo(u.target!)}>
              <Link2 size={14} /> {targetLabel(u.target)}
            </button>
          ) : (
            <button
              className="btn btn-ghost"
              title={UI.linkTip}
              onClick={async () => {
                const target = await pickJumpTarget(UI.linkAsk)
                if (target) set(i, { target })
              }}
            >
              <Link2 size={14} /> {UI.link}
            </button>
          )}
          <button className="btn btn-ghost" title={UI.remove} aria-label={UI.remove} onClick={() => onChange(lines.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <button className="btn btn-ghost" onClick={() => onChange([...lines, { id: newId(), rank: Math.min(hi, Math.max(1, (lines.at(-1)?.rank ?? 0) + 1)), text: '', target: null }])}>
        {addLabel}
      </button>
    </div>
  )
}
