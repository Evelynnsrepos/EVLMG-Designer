import { Flag, Link2, Plus, Sparkles, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type WheelEvent as ReactWheelEvent } from 'react'
import { newId, type Entity, type Id, type LinkTarget } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useProjectStore, useUndoRedoKeys } from '@/core/state'
import { createTasksDoc, type TasksDoc } from '@/components/tasks/model'
import { NumberInput, PresetHeader } from '@/shared/calculators'
import { useEditSession } from '@/shared/calculators/editSession'
import { promptDialog } from '@/shared/dialogs'
import { jumpTo } from '@/shared/entityList'
import { localized, useLang } from '@/shared/i18n'
import { pickJumpTarget, targetLabel } from '@/shared/jumps/Jumps'
import {
  BANNER_COLOR,
  createLiveOpsDoc,
  DEFAULT_PROFILES,
  exampleLiveOpsDoc,
  lanes,
  newPass,
  PASS_COLOR,
  passDays,
  passesOf,
  passPerVersion,
  rerunWarnings,
  shiftWeeks,
  STORE_COLOR,
  totalWeeks,
  VERSION_COLORS,
  versionMilestones,
  versionStarts,
  weekDate,
  withPasses,
  type BattlePass,
  type CustomItem,
  type CustomRow,
  type LiveBanner,
  type LiveEvent,
  type LiveOpsDoc,
  type StoreSlot,
  type Version,
} from './model'
import '@/shared/listDetail/listDetail.css'
import './live-ops.css'

const UI = localized(
  {
    tabs: { plan: 'Weeks', list: 'List', pass: 'Battle pass', store: 'Store' } as Record<Tab, string>,
    launchDay: 'Launch day',
    launchTip: 'The day version 1 comes out. Every week in the plan counts from it.',
    ownRow: 'Add your own row',
    ownRowAsk: 'Name your row (for example Collabs, Sales or Maintenance)',
    untitledRow: 'Untitled row',
    newItem: (row: string) => `New ${row.toLowerCase() || 'item'}`,
    removeRow: 'Remove this row and everything on it',
    rowName: 'Row name',
    add: 'Add',
    milestones: 'Make milestones',
    milestonesTip: 'One Task Board milestone per version, so the production plan matches. Run it again after changes: renamed versions rename their milestone.',
    milestonesNoDate: 'Set a Launch date to give the milestones dates.',
    zoomOut: 'Zoom out (Ctrl + mouse wheel)',
    zoomIn: 'Zoom in (Ctrl + mouse wheel)',
    rerun: (who: string, weeks: number, first: string, again: string, limit: number) => `${who} is featured again ${weeks} weeks after ${first}, sooner than ${limit} weeks (${again}).`,
    rows: { version: 'Versions', event: 'Events', banner: 'Featured', pass: 'Passes', store: 'Store' } as Record<RowKind, string>,
    rowTips: {
      version: 'Versions, seasons, updates or expansions. They follow each other.',
      event: 'Events: anything that runs for some days, like a festival, a double-XP weekend, a tournament or a sale.',
      banner: 'What is featured when: a banner, a spotlight, a rotation, a map or mode of the week.',
      pass: 'Battle passes, season passes or reward tracks. One per season if you like.',
      store: 'Store items on sale from a week on.',
    } as Record<RowKind, string>,
    addTo: (row: string) => `Add to ${row}`,
    addRow: 'Add a row:',
    empty: 'This plan is empty apart from the first version. Add rows below, or start from an example and change everything in it.',
    example: 'Fill with an example',
    hint: 'Click a bar to edit it below. Drag a bar to move it, drag its right edge to make it longer. Versions follow each other: drag a version\'s right edge and everything after it moves. Zoom in far enough and bars snap to days instead of weeks.',
    newVersion: (n: number) => `Version ${n}`,
    newEvent: 'New event',
    newBanner: (n: number) => `Featured ${n}`,
    newStore: 'New item',
    pass: 'Pass',
    name: 'Name',
    colour: 'Colour',
    weeks: 'Weeks',
    days: 'Days',
    startDay: 'Starts on day',
    starts: 'Starts',
    notes: 'Notes',
    rewards: 'Rewards',
    link: 'Link',
    linkTip: 'Link a quest, achievement or anything else',
    linkAsk: 'What belongs to this event?',
    gacha: 'Rates',
    noGacha: 'No Gacha & Loot document',
    gachaTip: 'Rates from a Gacha & Loot document',
    open: 'Open',
    featureChar: 'Feature a character…',
    featureAny: 'Feature anything else',
    featureAsk: 'What is featured? An item, a skin, a map, a mode or anything else',
    featured: 'Featured',
    remove: 'Remove',
    delete: 'Delete',
    close: 'Close',
    week: 'Week',
    price: 'Price',
    currency: 'Currency',
    passTab: 'Open on the Battle pass tab',
    picked: (n: number) => `${n} picked:`,
    pickHint: 'Tick rows to move them together.',
    moveBy: 'Move by',
    weeksWord: 'weeks',
    move: 'Move',
    warnWithin: 'Warn when featured again within',
    events: 'Events',
    banners: 'Featured',
    versions: 'Versions',
    addPass: 'Add a pass',
    perVersion: 'One pass per version',
    perVersionTip: 'Adds a pass for every version that has none, starting and ending with it',
    noPass: 'No pass yet. A pass is a reward track that runs for some weeks: a battle pass, season pass or event track.',
    tiers: 'Tiers',
    xpPerTier: 'XP per tier',
    xpPerHour: 'XP per hour played',
    runsFor: 'Runs for weeks',
    startWeek: 'Starts in week',
    profiles: 'Players',
    profilesTip: 'How long each kind of player plays a day. The pass maths uses these.',
    hoursADay: 'hours a day',
    addProfile: 'Player type',
    newProfile: 'New player',
    finishes: 'finishes in time',
    misses: (d: number) => `misses it (${d} days)`,
    never: 'never',
    daysN: (n: number) => `${n} days`,
    tier: 'Tier',
    free: 'Free',
    paid: 'Paid',
    reward: 'Reward',
    removePass: 'Remove this pass',
    storeIntro: 'What is on sale which week. Store items also show on the Weeks ruler.',
    storeItem: 'Store item',
    deleted: '(deleted)',
    untitled: 'Untitled',
  },
  {
    tabs: { plan: 'Wochen', list: 'Liste', pass: 'Battle Pass', store: 'Shop' },
    launchDay: 'Starttag',
    launchTip: 'Der Tag, an dem Version 1 erscheint. Jede Woche im Plan zählt ab da.',
    ownRow: 'Eigene Zeile hinzufügen',
    ownRowAsk: 'Benenne deine Zeile (z. B. Kollabs, Sales oder Wartung)',
    untitledRow: 'Zeile ohne Namen',
    newItem: (row) => `Neu: ${row || 'Eintrag'}`,
    removeRow: 'Diese Zeile mit allem darauf entfernen',
    rowName: 'Name der Zeile',
    add: 'Hinzufügen',
    milestones: 'Meilensteine machen',
    milestonesTip: 'Ein Meilenstein auf dem Task Board pro Version, damit der Produktionsplan passt. Nach Änderungen nochmal klicken: umbenannte Versionen benennen ihren Meilenstein mit um.',
    milestonesNoDate: 'Setze ein Startdatum, damit die Meilensteine Daten bekommen.',
    zoomOut: 'Herauszoomen (Strg + Mausrad)',
    zoomIn: 'Hineinzoomen (Strg + Mausrad)',
    rerun: (who, weeks, first, again, limit) => `${who} kommt ${weeks} Wochen nach ${first} wieder, früher als ${limit} Wochen (${again}).`,
    rows: { version: 'Versionen', event: 'Events', banner: 'Im Fokus', pass: 'Pässe', store: 'Shop' },
    rowTips: {
      version: 'Versionen, Seasons, Updates oder Erweiterungen. Sie folgen aufeinander.',
      event: 'Events: alles, was ein paar Tage läuft, z. B. ein Fest, ein Doppel-XP-Wochenende, ein Turnier oder ein Sale.',
      banner: 'Was wann im Fokus steht: ein Banner, ein Spotlight, eine Rotation, eine Karte oder ein Modus der Woche.',
      pass: 'Battle Pässe, Season Pässe oder Belohnungsleisten. Gern einer pro Season.',
      store: 'Shop-Artikel, die ab einer Woche im Angebot sind.',
    },
    addTo: (row) => `Zu ${row} hinzufügen`,
    addRow: 'Zeile hinzufügen:',
    empty: 'Dieser Plan ist bis auf die erste Version leer. Füge unten Zeilen hinzu oder starte mit einem Beispiel und ändere alles darin.',
    example: 'Mit Beispiel füllen',
    hint: 'Klicke auf einen Balken, um ihn unten zu bearbeiten. Zieh einen Balken, um ihn zu verschieben, zieh seine rechte Kante, um ihn länger zu machen. Versionen folgen aufeinander: zieh die rechte Kante einer Version, und alles danach rückt mit. Weit genug hineingezoomt rasten Balken auf Tage statt Wochen ein.',
    newVersion: (n) => `Version ${n}`,
    newEvent: 'Neues Event',
    newBanner: (n) => `Im Fokus ${n}`,
    newStore: 'Neuer Artikel',
    pass: 'Pass',
    name: 'Name',
    colour: 'Farbe',
    weeks: 'Wochen',
    days: 'Tage',
    startDay: 'Beginnt an Tag',
    starts: 'Beginnt',
    notes: 'Notizen',
    rewards: 'Belohnungen',
    link: 'Verknüpfen',
    linkTip: 'Eine Quest, einen Erfolg oder etwas anderes verknüpfen',
    linkAsk: 'Was gehört zu diesem Event?',
    gacha: 'Raten',
    noGacha: 'Kein Gacha-&-Loot-Dokument',
    gachaTip: 'Raten aus einem Gacha-&-Loot-Dokument',
    open: 'Öffnen',
    featureChar: 'Charakter in den Fokus…',
    featureAny: 'Etwas anderes in den Fokus',
    featureAsk: 'Was steht im Fokus? Ein Item, ein Skin, eine Karte, ein Modus oder etwas anderes',
    featured: 'Im Fokus',
    remove: 'Entfernen',
    delete: 'Löschen',
    close: 'Schließen',
    week: 'Woche',
    price: 'Preis',
    currency: 'Währung',
    passTab: 'Im Tab Battle Pass öffnen',
    picked: (n) => `${n} ausgewählt:`,
    pickHint: 'Hake Zeilen an, um sie zusammen zu verschieben.',
    moveBy: 'Verschieben um',
    weeksWord: 'Wochen',
    move: 'Verschieben',
    warnWithin: 'Warnen, wenn etwas wieder im Fokus ist innerhalb von',
    events: 'Events',
    banners: 'Im Fokus',
    versions: 'Versionen',
    addPass: 'Pass hinzufügen',
    perVersion: 'Ein Pass pro Version',
    perVersionTip: 'Fügt jeder Version ohne Pass einen hinzu, der mit ihr beginnt und endet',
    noPass: 'Noch kein Pass. Ein Pass ist eine Belohnungsleiste, die ein paar Wochen läuft: Battle Pass, Season Pass oder Event-Leiste.',
    tiers: 'Stufen',
    xpPerTier: 'XP pro Stufe',
    xpPerHour: 'XP pro Spielstunde',
    runsFor: 'Läuft Wochen',
    startWeek: 'Beginnt in Woche',
    profiles: 'Spieler',
    profilesTip: 'Wie lange jede Art Spieler am Tag spielt. Die Pass-Rechnung nutzt diese Werte.',
    hoursADay: 'Stunden am Tag',
    addProfile: 'Spielertyp',
    newProfile: 'Neuer Spieler',
    finishes: 'schafft es rechtzeitig',
    misses: (d) => `schafft es nicht (${d} Tage)`,
    never: 'nie',
    daysN: (n) => `${n} Tage`,
    tier: 'Stufe',
    free: 'Gratis',
    paid: 'Bezahlt',
    reward: 'Belohnung',
    removePass: 'Diesen Pass entfernen',
    storeIntro: 'Was in welcher Woche im Angebot ist. Shop-Artikel stehen auch auf dem Wochen-Lineal.',
    storeItem: 'Shop-Artikel',
    deleted: '(gelöscht)',
    untitled: 'Ohne Titel',
  },
)

type Tab = 'plan' | 'list' | 'pass' | 'store'
type RowKind = 'version' | 'event' | 'banner' | 'pass' | 'store'
type Kind = RowKind | 'custom'
type Drag = { kind: Kind; id: Id; mode: 'move' | 'size'; x0: number; orig: LiveOpsDoc; moved: boolean }
type Sel = { kind: Kind; id: Id } | null

const ZOOM_KEY = 'egd-liveops-zoom'
const MIN_ZOOM = 14
const MAX_ZOOM = 224
/** From this many pixels per week on, drags snap to days. */
const DAY_SNAP = 84
const LANE = 30

function initialZoom(): number {
  try {
    const z = Number(localStorage.getItem(ZOOM_KEY))
    return z >= MIN_ZOOM && z <= MAX_ZOOM ? z : 56
  } catch {
    return 56
  }
}

/** "W3" or "W3 + 2d" for a start that is a fraction of a week. */
const weekText = (w: number) => {
  const days = Math.round(w * 7)
  return days % 7 ? `W${Math.floor(days / 7)} + ${days % 7}d` : `W${days / 7}`
}

/** Live-Service Planner (missing tools phase 4). */
export default function View({ documentId, active }: PanelProps) {
  useLang()
  const doc = useDocument<LiveOpsDoc>('live-ops', documentId!, createLiveOpsDoc)
  useUndoRedoKeys(doc, active)
  const session = useEditSession(doc)
  const tasks = useDocument<TasksDoc>('tasks', 'tasks', createTasksDoc)
  const characters = useProjectStore((s) => s.entities.character) as Entity[]
  const gachaDocs = useProjectStore((s) => s.meta?.documents ?? []).filter((x) => x.type === 'gacha')
  const [tab, setTab] = useState<Tab>('plan')
  const [picked, setPicked] = useState<Set<Id>>(new Set())
  const [sel, setSel] = useState<Sel>(null)
  const [passId, setPassId] = useState<Id | null>(null)
  const [moveBy, setMoveBy] = useState(1)
  const [WEEK, setZoom] = useState(initialZoom)
  const drag = useRef<Drag | null>(null)
  if (!doc.data) return null
  const d = doc.data
  const set = (fn: (d: LiveOpsDoc) => LiveOpsDoc) => doc.update(fn)
  const weeks = totalWeeks(d) + 2
  const starts = versionStarts(d)
  const warnings = rerunWarnings(d)
  const passes = passesOf(d)
  const profiles = d.profiles ?? DEFAULT_PROFILES
  const charName = (id: Id) => characters.find((c) => c.id === id)?.name || UI.deleted
  const bannerName = (id: Id) => d.banners.find((b) => b.id === id)?.name ?? '?'
  const label = (w: number) => weekDate(d.start, w) || weekText(w)
  const step = WEEK >= DAY_SNAP ? 1 / 7 : 1
  const snap = (w: number) => Math.round(w / step) * step
  const labelEvery = WEEK < 28 ? 4 : WEEK < 56 ? 2 : 1

  const zoom = (f: number) =>
    setZoom((z) => {
      const n = Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * f)))
      try {
        localStorage.setItem(ZOOM_KEY, String(n))
      } catch {
        // ignore
      }
      return n
    })
  const wheel = (e: ReactWheelEvent) => {
    if (!e.ctrlKey) return
    e.preventDefault()
    zoom(e.deltaY < 0 ? 1.25 : 0.8)
  }

  // Edits by kind, shared by the bars, the details panel and the List tab.
  const editVersion = (id: Id, p: Partial<Version>) => set((x) => ({ ...x, versions: x.versions.map((o) => (o.id === id ? { ...o, ...p } : o)) }))
  const editEvent = (id: Id, p: Partial<LiveEvent>) => set((x) => ({ ...x, events: x.events.map((o) => (o.id === id ? { ...o, ...p } : o)) }))
  const editBanner = (id: Id, p: Partial<LiveBanner>) => set((x) => ({ ...x, banners: x.banners.map((o) => (o.id === id ? { ...o, ...p } : o)) }))
  const editStore = (id: Id, p: Partial<StoreSlot>) => set((x) => ({ ...x, store: x.store.map((o) => (o.id === id ? { ...o, ...p } : o)) }))
  const rows = d.rows ?? []
  const editRow = (id: Id, fn: (r: CustomRow) => CustomRow) => set((x) => ({ ...x, rows: (x.rows ?? []).map((r) => (r.id === id ? fn(r) : r)) }))
  const editItem = (id: Id, p: Partial<CustomItem>) => set((x) => ({ ...x, rows: (x.rows ?? []).map((r) => ({ ...r, items: r.items.map((i) => (i.id === id ? { ...i, ...p } : i)) })) }))
  const addItem = (r: CustomRow) => {
    const id = newId()
    editRow(r.id, (o) => ({ ...o, items: [...o.items, { id, name: UI.newItem(o.name), startWeek: Math.max(0, ...o.items.map((i) => i.startWeek + i.weeks)), weeks: 1, notes: '' }] }))
    setSel({ kind: 'custom', id })
  }
  const addRow = async () => {
    const name = (await promptDialog(UI.ownRowAsk, ''))?.trim()
    if (name) set((x) => ({ ...x, rows: [...(x.rows ?? []), { id: newId(), name, color: VERSION_COLORS[(x.rows?.length ?? 0) % VERSION_COLORS.length], items: [] }] }))
  }
  const editPass = (id: Id, p: Partial<BattlePass>) => set((x) => withPasses(x, passesOf(x).map((o) => (o.id === id ? { ...o, ...p } : o))))
  const remove = (kind: Kind, id: Id) => {
    if (sel?.id === id) setSel(null)
    set((x) => {
      if (kind === 'version') return { ...x, versions: x.versions.filter((o) => o.id !== id) }
      if (kind === 'event') return { ...x, events: x.events.filter((o) => o.id !== id) }
      if (kind === 'banner') return { ...x, banners: x.banners.filter((o) => o.id !== id) }
      if (kind === 'store') return { ...x, store: x.store.filter((o) => o.id !== id) }
      if (kind === 'custom') return { ...x, rows: (x.rows ?? []).map((r) => ({ ...r, items: r.items.filter((o) => o.id !== id) })) }
      return withPasses(x, passesOf(x).filter((o) => o.id !== id))
    })
  }
  const add = (kind: RowKind) => {
    const id = newId()
    set((x) => {
      if (kind === 'version') return { ...x, versions: [...x.versions, { id, name: UI.newVersion(x.versions.length + 1), weeks: 6, color: VERSION_COLORS[x.versions.length % VERSION_COLORS.length], notes: '' }] }
      if (kind === 'event') return { ...x, events: [...x.events, { id, name: UI.newEvent, startWeek: 0, days: 7, rewards: '', target: null, color: '#f5a623' }] }
      if (kind === 'banner') return { ...x, banners: [...x.banners, { id, name: UI.newBanner(x.banners.length + 1), startWeek: Math.max(0, ...x.banners.map((b) => b.startWeek + b.weeks)), weeks: 3, gachaDocId: null, featured: [] }] }
      if (kind === 'store') return { ...x, store: [...x.store, { id, week: 0, name: UI.newStore, price: 5, currency: '€' }] }
      const ps = passesOf(x)
      const at = Math.max(0, ...ps.map((p) => p.startWeek + p.weeks))
      return withPasses(x, [...ps, { ...newPass(at, 6, `${UI.pass} ${ps.length + 1}`), id }])
    })
    setSel({ kind, id })
    if (kind === 'pass') setPassId(id)
  }

  const down = (e: ReactPointerEvent, kind: Kind, id: Id, mode: Drag['mode']) => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { kind, id, mode, x0: e.clientX, orig: d, moved: false }
    session.begin()
  }
  const move = (e: ReactPointerEvent) => {
    const g = drag.current
    if (!g) return
    if (Math.abs(e.clientX - g.x0) > 3) g.moved = true
    if (!g.moved) return
    const dx = (e.clientX - g.x0) / WEEK
    const o = g.orig
    const start = (s: number) => Math.max(0, snap(s + dx))
    const len = (w: number) => Math.max(step, snap(w + dx))
    session.change(() => {
      if (g.kind === 'version') return { ...o, versions: o.versions.map((v) => (v.id === g.id ? { ...v, weeks: Math.max(1, Math.round(v.weeks + dx)) } : v)) }
      if (g.kind === 'event') return { ...o, events: o.events.map((v) => (v.id !== g.id ? v : g.mode === 'size' ? { ...v, days: Math.max(1, Math.round(v.days + dx * 7)) } : { ...v, startWeek: start(v.startWeek) })) }
      if (g.kind === 'store') return { ...o, store: o.store.map((v) => (v.id !== g.id ? v : { ...v, week: start(v.week) })) }
      if (g.kind === 'custom') return { ...o, rows: (o.rows ?? []).map((r) => ({ ...r, items: r.items.map((v) => (v.id !== g.id ? v : g.mode === 'size' ? { ...v, weeks: len(v.weeks) } : { ...v, startWeek: start(v.startWeek) })) })) }
      if (g.kind === 'pass') return withPasses(o, passesOf(o).map((v) => (v.id !== g.id ? v : g.mode === 'size' ? { ...v, weeks: len(v.weeks) } : { ...v, startWeek: start(v.startWeek) })))
      return { ...o, banners: o.banners.map((v) => (v.id !== g.id ? v : g.mode === 'size' ? { ...v, weeks: len(v.weeks) } : { ...v, startWeek: start(v.startWeek) })) }
    })
  }
  const up = () => {
    const g = drag.current
    if (!g) return
    drag.current = null
    session.end()
    // A press without moving is a click: open the bar's details.
    if (!g.moved) setSel({ kind: g.kind, id: g.id })
  }
  const makeMilestones = () => {
    const r = versionMilestones(d, tasks.data?.milestones ?? [])
    tasks.update((t) => ({ ...t, milestones: r.milestones }))
    if (r.versions.some((v, i) => v !== d.versions[i])) set((x) => ({ ...x, versions: r.versions }))
  }

  const eventLanes = lanes(d.events.map((v) => ({ id: v.id, start: v.startWeek, length: v.days / 7 })))
  const bannerLanes = lanes(d.banners.map((v) => ({ id: v.id, start: v.startWeek, length: v.weeks })))
  const passLanes = lanes(passes.map((v) => ({ id: v.id, start: v.startWeek, length: v.weeks })))
  const storeLanes = lanes(d.store.map((v) => ({ id: v.id, start: v.week, length: 1 })))
  const shown: Record<Exclude<RowKind, 'version'>, boolean> = { event: d.events.length > 0, banner: d.banners.length > 0, pass: passes.length > 0, store: d.store.length > 0 }
  const hidden = (Object.keys(shown) as (keyof typeof shown)[]).filter((k) => !shown[k])
  const isEmpty = hidden.length === 4 && rows.length === 0
  const isSel = (id: Id) => sel?.id === id

  return (
    <div className="lo">
      <div className="lo-head">
        <PresetHeader documentId={documentId!} kind="Plan" undo={doc.undo} redo={doc.redo} canUndo={doc.canUndo} canRedo={doc.canRedo} />
        <div className="ld-inline">
          <div className="lo-tabs ld-inline">
            {(['plan', 'list', 'pass', 'store'] as Tab[]).map((t) => (
              <button key={t} className={`btn btn-ghost${tab === t ? ' on' : ''}`} onClick={() => setTab(t)}>
                {UI.tabs[t]}
              </button>
            ))}
          </div>
          {tab === 'plan' && (
            <span className="ld-inline">
              <button className="icon-btn" title={UI.zoomOut} aria-label={UI.zoomOut} onClick={() => zoom(0.8)} disabled={WEEK <= MIN_ZOOM}>
                <ZoomOut size={14} />
              </button>
              <button className="icon-btn" title={UI.zoomIn} aria-label={UI.zoomIn} onClick={() => zoom(1.25)} disabled={WEEK >= MAX_ZOOM}>
                <ZoomIn size={14} />
              </button>
            </span>
          )}
          <label
            className="ld-inline lo-start"
            title={UI.launchTip}
            // WebKit only opens the date picker from its small icon, so the label opens it too.
            onClick={(e) => {
              const i = e.currentTarget.querySelector('input')
              if (e.target !== i)
                try {
                  i?.showPicker()
                } catch {
                  i?.focus()
                }
            }}
          >
            <span className="lo-start-name">{UI.launchDay}</span> <input className="input" type="date" value={d.start} onChange={(e) => set((x) => ({ ...x, start: e.target.value }))} />
          </label>
          <button className="btn btn-ghost" onClick={makeMilestones} title={d.start ? UI.milestonesTip : `${UI.milestonesTip} ${UI.milestonesNoDate}`}>
            <Flag size={14} /> {UI.milestones}
          </button>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="lo-warn">
          {warnings.map((w, i) => (
            <p key={i} className="lo-warn-line">
              {UI.rerun(charName(w.characterId), w.weeks, bannerName(w.first), bannerName(w.again), d.rerunWeeks)}
            </p>
          ))}
        </div>
      )}

      {tab === 'plan' && (
        <div className="lo-scroll" onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}>
          {isEmpty && (
            <div className="lo-empty">
              <p className="muted">{UI.empty}</p>
              <button className="btn btn-primary" onClick={() => set(exampleLiveOpsDoc)}>
                <Sparkles size={14} /> {UI.example}
              </button>
            </div>
          )}
          <div className="lo-grid" style={{ width: weeks * WEEK + 110 }}>
            <div className="lo-ruler">
              <span className="lo-rowname" />
              {Array.from({ length: weeks }, (_, w) => (
                <span key={w} className="lo-week" style={{ width: WEEK }} title={weekDate(d.start, w)}>
                  {w % labelEvery === 0 ? label(w).replace(/^\d{4}-/, '') : ''}
                </span>
              ))}
            </div>
            <Row name={UI.rows.version} tip={UI.rowTips.version} week={WEEK} onAdd={() => add('version')}>
              {d.versions.map((v, i) => (
                <Bar key={v.id} on={isSel(v.id)} left={starts[i] * WEEK} width={v.weeks * WEEK} color={v.color} title={`${v.name}: ${v.weeks} ${UI.weeksWord}${v.notes ? ` · ${v.notes}` : ''}`} onMove={(e) => down(e, 'version', v.id, 'move')} onSize={(e) => down(e, 'version', v.id, 'size')}>
                  {v.name}
                </Bar>
              ))}
            </Row>
            {shown.event && (
              <Row name={UI.rows.event} tip={UI.rowTips.event} week={WEEK} tall={eventLanes.count} onAdd={() => add('event')}>
                {d.events.map((v) => (
                  <Bar key={v.id} on={isSel(v.id)} top={eventLanes.lane.get(v.id)! * LANE} left={v.startWeek * WEEK} width={(v.days / 7) * WEEK} color={v.color} title={`${v.name}: ${UI.daysN(v.days)}${v.rewards ? ` · ${v.rewards}` : ''}`} onMove={(e) => down(e, 'event', v.id, 'move')} onSize={(e) => down(e, 'event', v.id, 'size')}>
                    {v.name}
                  </Bar>
                ))}
              </Row>
            )}
            {shown.banner && (
              <Row name={UI.rows.banner} tip={UI.rowTips.banner} week={WEEK} tall={bannerLanes.count} onAdd={() => add('banner')}>
                {d.banners.map((v) => {
                  const what = [...v.featured.map(charName), ...(v.links ?? []).map(targetLabel)].join(', ')
                  return (
                    <Bar
                      key={v.id}
                      on={isSel(v.id)}
                      top={bannerLanes.lane.get(v.id)! * LANE}
                      left={v.startWeek * WEEK}
                      width={v.weeks * WEEK}
                      color={warnings.some((w) => w.again === v.id) ? '#e03131' : (v.color ?? BANNER_COLOR)}
                      title={`${v.name}${what ? `: ${what}` : ''}`}
                      onMove={(e) => down(e, 'banner', v.id, 'move')}
                      onSize={(e) => down(e, 'banner', v.id, 'size')}
                    >
                      {v.name}
                      {what ? ` · ${what}` : ''}
                    </Bar>
                  )
                })}
              </Row>
            )}
            {rows.map((r) => {
              const l = lanes(r.items.map((v) => ({ id: v.id, start: v.startWeek, length: v.weeks })))
              return (
                <Row key={r.id} name={r.name || UI.untitledRow} tip={r.name} week={WEEK} tall={l.count} onAdd={() => addItem(r)}>
                  {r.items.map((v) => (
                    <Bar key={v.id} on={isSel(v.id)} top={l.lane.get(v.id)! * LANE} left={v.startWeek * WEEK} width={v.weeks * WEEK} color={r.color} title={`${v.name}: ${weekText(v.weeks).slice(1)} ${UI.weeksWord}${v.notes ? ` · ${v.notes}` : ''}`} onMove={(e) => down(e, 'custom', v.id, 'move')} onSize={(e) => down(e, 'custom', v.id, 'size')}>
                      {v.name}
                    </Bar>
                  ))}
                </Row>
              )
            })}
            {shown.pass && (
              <Row name={UI.rows.pass} tip={UI.rowTips.pass} week={WEEK} tall={passLanes.count} onAdd={() => add('pass')}>
                {passes.map((p) => (
                  <Bar key={p.id} on={isSel(p.id)} top={passLanes.lane.get(p.id)! * LANE} left={p.startWeek * WEEK} width={p.weeks * WEEK} color={PASS_COLOR} title={`${p.name ?? UI.pass}: ${p.tiers} ${UI.tiers} · ${p.weeks} ${UI.weeksWord}`} onMove={(e) => down(e, 'pass', p.id, 'move')} onSize={(e) => down(e, 'pass', p.id, 'size')}>
                    {p.name ?? UI.pass} · {p.tiers} {UI.tiers}
                  </Bar>
                ))}
              </Row>
            )}
            {shown.store && (
              <Row name={UI.rows.store} tip={UI.rowTips.store} week={WEEK} tall={storeLanes.count} onAdd={() => add('store')}>
                {d.store.map((s) => (
                  <Bar key={s.id} on={isSel(s.id)} top={storeLanes.lane.get(s.id)! * LANE} left={s.week * WEEK} width={WEEK} color={STORE_COLOR} title={`${s.name}: ${s.price} ${s.currency}`} onMove={(e) => down(e, 'store', s.id, 'move')}>
                    {s.name}
                  </Bar>
                ))}
              </Row>
            )}
          </div>
          <div className="ld-inline lo-addrow">
            <span className="muted">{UI.addRow}</span>
            {hidden.map((k) => (
              <button key={k} className="btn btn-ghost" title={UI.rowTips[k]} onClick={() => add(k)}>
                <Plus size={13} /> {UI.rows[k]}
              </button>
            ))}
            <button className="btn btn-ghost" onClick={addRow}>
              <Plus size={13} /> {UI.ownRow}
            </button>
          </div>
          {sel && (
            <Details
              d={d}
              sel={sel}
              close={() => setSel(null)}
              remove={() => remove(sel.kind, sel.id)}
              ui={{ editVersion, editEvent, editBanner, editStore, editPass, editItem }}
              characters={characters}
              gachaDocs={gachaDocs}
              charName={charName}
              label={label}
              openPass={(id) => {
                setPassId(id)
                setTab('pass')
              }}
            />
          )}
          <p className="muted lo-hint">{UI.hint}</p>
        </div>
      )}

      {tab === 'list' && (
        <div className="lo-body">
          <div className="ld-inline">
            <span className="muted">{picked.size ? UI.picked(picked.size) : UI.pickHint}</span>
            {picked.size > 0 && (
              <>
                <label className="ld-inline">
                  {UI.moveBy} <NumberInput value={moveBy} step={1} onChange={setMoveBy} aria-label={UI.moveBy} /> {UI.weeksWord}
                </label>
                <button className="btn btn-ghost" disabled={!moveBy} onClick={() => set((x) => shiftWeeks(x, picked, moveBy))}>
                  {UI.move}
                </button>
              </>
            )}
            <label className="ld-inline">
              {UI.warnWithin} <NumberInput value={d.rerunWeeks} min={0} onChange={(rerunWeeks) => set((x) => ({ ...x, rerunWeeks }))} /> {UI.weeksWord}
            </label>
          </div>
          <h3>{UI.versions}</h3>
          <table className="calc-table lo-table">
            <tbody>
              {d.versions.map((v, i) => (
                <tr key={v.id}>
                  <td>
                    <input type="color" value={v.color} onChange={(e) => editVersion(v.id, { color: e.target.value })} aria-label={UI.colour} />
                  </td>
                  <td>
                    <input className="input" value={v.name} onChange={(e) => editVersion(v.id, { name: e.target.value })} aria-label={UI.name} />
                  </td>
                  <td className="muted">{label(starts[i])}</td>
                  <td>
                    <NumberInput value={v.weeks} min={1} onChange={(w) => editVersion(v.id, { weeks: Math.max(1, Math.round(w)) })} /> {UI.weeksWord}
                  </td>
                  <td>
                    <input className="input" placeholder={UI.notes} value={v.notes} onChange={(e) => editVersion(v.id, { notes: e.target.value })} />
                  </td>
                  <td>
                    <button className="icon-btn" aria-label={UI.remove} onClick={() => remove('version', v.id)}>
                      <X size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>{UI.events}</h3>
          <table className="calc-table lo-table">
            <tbody>
              {d.events.map((v) => (
                <tr key={v.id}>
                  <td>
                    <input type="checkbox" checked={picked.has(v.id)} onChange={() => setPicked(toggle(picked, v.id))} aria-label="Pick" />
                  </td>
                  <td>
                    <input type="color" value={v.color} onChange={(e) => editEvent(v.id, { color: e.target.value })} aria-label={UI.colour} />
                  </td>
                  <td>
                    <input className="input" value={v.name} onChange={(e) => editEvent(v.id, { name: e.target.value })} aria-label={UI.name} />
                  </td>
                  <td>
                    {UI.startDay} <NumberInput value={Math.round(v.startWeek * 7)} min={0} onChange={(day) => editEvent(v.id, { startWeek: Math.max(0, Math.round(day)) / 7 })} />
                  </td>
                  <td>
                    <NumberInput value={v.days} min={1} onChange={(days) => editEvent(v.id, { days })} /> {UI.days}
                  </td>
                  <td>
                    <input className="input" placeholder={UI.rewards} value={v.rewards} onChange={(e) => editEvent(v.id, { rewards: e.target.value })} />
                  </td>
                  <td>
                    <EventLink v={v} edit={(p) => editEvent(v.id, p)} />
                  </td>
                  <td>
                    <button className="icon-btn" aria-label={UI.remove} onClick={() => remove('event', v.id)}>
                      <X size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>{UI.banners}</h3>
          <table className="calc-table lo-table">
            <tbody>
              {d.banners.map((v) => (
                <tr key={v.id}>
                  <td>
                    <input type="checkbox" checked={picked.has(v.id)} onChange={() => setPicked(toggle(picked, v.id))} aria-label="Pick" />
                  </td>
                  <td>
                    <input className="input" value={v.name} onChange={(e) => editBanner(v.id, { name: e.target.value })} aria-label={UI.name} />
                  </td>
                  <td>
                    {UI.week} <NumberInput value={v.startWeek} min={0} onChange={(startWeek) => editBanner(v.id, { startWeek })} />
                  </td>
                  <td>
                    <NumberInput value={v.weeks} min={1 / 7} onChange={(weeks) => editBanner(v.id, { weeks })} /> {UI.weeksWord}
                  </td>
                  <td>
                    <GachaPick v={v} gachaDocs={gachaDocs} edit={(p) => editBanner(v.id, p)} />
                  </td>
                  <td>
                    <FeaturedPick v={v} characters={characters} charName={charName} edit={(p) => editBanner(v.id, p)} />
                  </td>
                  <td>
                    <button className="icon-btn" aria-label={UI.remove} onClick={() => remove('banner', v.id)}>
                      <X size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {rows.map((r) => (
            <section key={r.id}>
              <h3 className="ld-inline">
                <input type="color" value={r.color} onChange={(e) => editRow(r.id, (o) => ({ ...o, color: e.target.value }))} aria-label={UI.colour} />
                <input className="input" value={r.name} placeholder={UI.rowName} onChange={(e) => editRow(r.id, (o) => ({ ...o, name: e.target.value }))} aria-label={UI.rowName} />
                <button className="btn btn-ghost" onClick={() => addItem(r)}>
                  <Plus size={13} /> {UI.add}
                </button>
                <button className="icon-btn" aria-label={UI.removeRow} title={UI.removeRow} onClick={() => set((x) => ({ ...x, rows: (x.rows ?? []).filter((o) => o.id !== r.id) }))}>
                  <X size={13} />
                </button>
              </h3>
              <table className="calc-table lo-table">
                <tbody>
                  {r.items.map((v) => (
                    <tr key={v.id}>
                      <td>
                        <input type="checkbox" checked={picked.has(v.id)} onChange={() => setPicked(toggle(picked, v.id))} aria-label="Pick" />
                      </td>
                      <td>
                        <input className="input" value={v.name} onChange={(e) => editItem(v.id, { name: e.target.value })} aria-label={UI.name} />
                      </td>
                      <td>
                        {UI.week} <NumberInput value={v.startWeek} min={0} onChange={(startWeek) => editItem(v.id, { startWeek })} />
                      </td>
                      <td>
                        <NumberInput value={v.weeks} min={1 / 7} onChange={(weeks) => editItem(v.id, { weeks: Math.max(1 / 7, weeks) })} /> {UI.weeksWord}
                      </td>
                      <td>
                        <input className="input" placeholder={UI.notes} value={v.notes} onChange={(e) => editItem(v.id, { notes: e.target.value })} />
                      </td>
                      <td>
                        <button className="icon-btn" aria-label={UI.remove} onClick={() => remove('custom', v.id)}>
                          <X size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
          <button className="btn btn-ghost lo-addrow" onClick={addRow}>
            <Plus size={14} /> {UI.ownRow}
          </button>
        </div>
      )}

      {tab === 'pass' && (
        <PassTab
          d={d}
          passes={passes}
          passId={passId}
          setPassId={setPassId}
          profiles={profiles}
          set={set}
          editPass={editPass}
          addPass={() => add('pass')}
          removePass={(id) => remove('pass', id)}
        />
      )}

      {tab === 'store' && (
        <div className="lo-body">
          <p className="muted">{UI.storeIntro}</p>
          <table className="calc-table lo-table">
            <tbody>
              {[...d.store]
                .sort((a, b) => a.week - b.week)
                .map((s) => (
                  <tr key={s.id}>
                    <td>
                      <input type="checkbox" checked={picked.has(s.id)} onChange={() => setPicked(toggle(picked, s.id))} aria-label="Pick" />
                    </td>
                    <td>
                      {UI.week} <NumberInput value={s.week} min={0} onChange={(week) => editStore(s.id, { week })} />
                    </td>
                    <td className="muted">{weekDate(d.start, s.week)}</td>
                    <td>
                      <input className="input" value={s.name} onChange={(e) => editStore(s.id, { name: e.target.value })} aria-label={UI.name} />
                    </td>
                    <td>
                      <NumberInput value={s.price} min={0} onChange={(price) => editStore(s.id, { price })} aria-label={UI.price} />
                    </td>
                    <td>
                      <input className="input" style={{ width: 90 }} value={s.currency} onChange={(e) => editStore(s.id, { currency: e.target.value })} aria-label={UI.currency} />
                    </td>
                    <td>
                      <button className="icon-btn" aria-label={UI.remove} onClick={() => remove('store', s.id)}>
                        <X size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <button className="btn btn-ghost" onClick={() => add('store')}>
            <Plus size={14} /> {UI.storeItem}
          </button>
        </div>
      )}
    </div>
  )
}

type Edits = {
  editVersion(id: Id, p: Partial<Version>): void
  editEvent(id: Id, p: Partial<LiveEvent>): void
  editBanner(id: Id, p: Partial<LiveBanner>): void
  editStore(id: Id, p: Partial<StoreSlot>): void
  editPass(id: Id, p: Partial<BattlePass>): void
  editItem(id: Id, p: Partial<CustomItem>): void
}
type DocRef = { id: Id; title: string }

/** The clicked bar's fields, under the ruler. */
function Details({ d, sel, close, remove, ui, characters, gachaDocs, charName, label, openPass }: { d: LiveOpsDoc; sel: NonNullable<Sel>; close(): void; remove(): void; ui: Edits; characters: Entity[]; gachaDocs: DocRef[]; charName(id: Id): string; label(w: number): string; openPass(id: Id): void }) {
  const field = (name: string, input: ReactNode) => (
    <label className="ld-field">
      <span>{name}</span>
      {input}
    </label>
  )
  const startDay = (w: number, on: (w: number) => void) => field(`${UI.startDay} (${label(w)})`, <NumberInput value={Math.round(w * 7)} min={0} onChange={(day) => on(Math.max(0, Math.round(day)) / 7)} />)
  let body: ReactNode = null
  if (sel.kind === 'version') {
    const v = d.versions.find((x) => x.id === sel.id)
    if (v)
      body = (
        <>
          {field(UI.name, <input className="input" value={v.name} onChange={(e) => ui.editVersion(v.id, { name: e.target.value })} />)}
          {field(UI.colour, <input type="color" value={v.color} onChange={(e) => ui.editVersion(v.id, { color: e.target.value })} />)}
          {field(UI.weeks, <NumberInput value={v.weeks} min={1} onChange={(w) => ui.editVersion(v.id, { weeks: Math.max(1, Math.round(w)) })} />)}
          {field(UI.notes, <input className="input lo-wide" value={v.notes} onChange={(e) => ui.editVersion(v.id, { notes: e.target.value })} />)}
        </>
      )
  } else if (sel.kind === 'event') {
    const v = d.events.find((x) => x.id === sel.id)
    if (v)
      body = (
        <>
          {field(UI.name, <input className="input" value={v.name} onChange={(e) => ui.editEvent(v.id, { name: e.target.value })} />)}
          {field(UI.colour, <input type="color" value={v.color} onChange={(e) => ui.editEvent(v.id, { color: e.target.value })} />)}
          {startDay(v.startWeek, (startWeek) => ui.editEvent(v.id, { startWeek }))}
          {field(UI.days, <NumberInput value={v.days} min={1} onChange={(days) => ui.editEvent(v.id, { days: Math.max(1, Math.round(days)) })} />)}
          {field(UI.rewards, <input className="input lo-wide" value={v.rewards} onChange={(e) => ui.editEvent(v.id, { rewards: e.target.value })} />)}
          {field(UI.link, <EventLink v={v} edit={(p) => ui.editEvent(v.id, p)} />)}
        </>
      )
  } else if (sel.kind === 'banner') {
    const v = d.banners.find((x) => x.id === sel.id)
    if (v)
      body = (
        <>
          {field(UI.name, <input className="input" value={v.name} onChange={(e) => ui.editBanner(v.id, { name: e.target.value })} />)}
          {field(UI.colour, <input type="color" value={v.color ?? BANNER_COLOR} onChange={(e) => ui.editBanner(v.id, { color: e.target.value })} />)}
          {startDay(v.startWeek, (startWeek) => ui.editBanner(v.id, { startWeek }))}
          {field(UI.days, <NumberInput value={Math.round(v.weeks * 7)} min={1} onChange={(days) => ui.editBanner(v.id, { weeks: Math.max(1, Math.round(days)) / 7 })} />)}
          {field(UI.featured, <FeaturedPick v={v} characters={characters} charName={charName} edit={(p) => ui.editBanner(v.id, p)} />)}
          {field(UI.gacha, <GachaPick v={v} gachaDocs={gachaDocs} edit={(p) => ui.editBanner(v.id, p)} />)}
        </>
      )
  } else if (sel.kind === 'store') {
    const v = d.store.find((x) => x.id === sel.id)
    if (v)
      body = (
        <>
          {field(UI.name, <input className="input" value={v.name} onChange={(e) => ui.editStore(v.id, { name: e.target.value })} />)}
          {startDay(v.week, (week) => ui.editStore(v.id, { week }))}
          {field(UI.price, <NumberInput value={v.price} min={0} onChange={(price) => ui.editStore(v.id, { price })} />)}
          {field(UI.currency, <input className="input" style={{ width: 90 }} value={v.currency} onChange={(e) => ui.editStore(v.id, { currency: e.target.value })} />)}
        </>
      )
  } else if (sel.kind === 'custom') {
    const v = (d.rows ?? []).flatMap((r) => r.items).find((x) => x.id === sel.id)
    if (v)
      body = (
        <>
          {field(UI.name, <input className="input" value={v.name} onChange={(e) => ui.editItem(v.id, { name: e.target.value })} />)}
          {startDay(v.startWeek, (startWeek) => ui.editItem(v.id, { startWeek }))}
          {field(UI.days, <NumberInput value={Math.round(v.weeks * 7)} min={1} onChange={(days) => ui.editItem(v.id, { weeks: Math.max(1, Math.round(days)) / 7 })} />)}
          {field(UI.notes, <input className="input lo-wide" value={v.notes} onChange={(e) => ui.editItem(v.id, { notes: e.target.value })} />)}
        </>
      )
  } else {
    const v = passesOf(d).find((x) => x.id === sel.id)
    if (v)
      body = (
        <>
          {field(UI.name, <input className="input" value={v.name ?? ''} placeholder={UI.pass} onChange={(e) => ui.editPass(v.id, { name: e.target.value })} />)}
          {startDay(v.startWeek, (startWeek) => ui.editPass(v.id, { startWeek }))}
          {field(UI.runsFor, <NumberInput value={v.weeks} min={1 / 7} onChange={(weeks) => ui.editPass(v.id, { weeks })} />)}
          {field(UI.tiers, <NumberInput value={v.tiers} min={1} onChange={(tiers) => ui.editPass(v.id, { tiers: Math.max(1, Math.round(tiers)) })} />)}
          <button className="btn btn-ghost" onClick={() => openPass(v.id)}>
            {UI.passTab}
          </button>
        </>
      )
  }
  if (!body) return null
  return (
    <div className="lo-details">
      <div className="ld-inline lo-details-fields">{body}</div>
      <div className="ld-inline">
        <button className="btn btn-ghost" onClick={remove}>
          <Trash2 size={13} /> {UI.delete}
        </button>
        <button className="icon-btn" aria-label={UI.close} title={UI.close} onClick={close}>
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

function EventLink({ v, edit }: { v: LiveEvent; edit(p: Partial<LiveEvent>): void }) {
  if (v.target)
    return (
      <span className="ld-inline">
        <button className="btn btn-ghost" onClick={() => jumpTo(v.target!)}>
          <Link2 size={13} /> {targetLabel(v.target)}
        </button>
        <button className="icon-btn" aria-label={UI.remove} title={UI.remove} onClick={() => edit({ target: null })}>
          <X size={12} />
        </button>
      </span>
    )
  return (
    <button
      className="btn btn-ghost"
      title={UI.linkTip}
      onClick={async () => {
        const target = await pickJumpTarget(UI.linkAsk)
        if (target) edit({ target })
      }}
    >
      <Link2 size={13} /> {UI.link}
    </button>
  )
}

function GachaPick({ v, gachaDocs, edit }: { v: LiveBanner; gachaDocs: DocRef[]; edit(p: Partial<LiveBanner>): void }) {
  return (
    <span className="ld-inline">
      <select className="input" value={v.gachaDocId ?? ''} onChange={(e) => edit({ gachaDocId: e.target.value || null })} title={UI.gachaTip}>
        <option value="">{UI.noGacha}</option>
        {gachaDocs.map((g) => (
          <option key={g.id} value={g.id}>
            {g.title}
          </option>
        ))}
      </select>
      {v.gachaDocId && (
        <button className="icon-btn" title={UI.open} aria-label={UI.open} onClick={() => jumpTo({ kind: 'document', type: 'gacha', documentId: v.gachaDocId })}>
          <Link2 size={13} />
        </button>
      )}
    </span>
  )
}

/** Characters from the Character List, plus links to anything else (items, skins, maps, modes, documents). */
function FeaturedPick({ v, characters, charName, edit }: { v: LiveBanner; characters: Entity[]; charName(id: Id): string; edit(p: Partial<LiveBanner>): void }) {
  const links = v.links ?? []
  return (
    <div className="ld-inline">
      {v.featured.map((c) => (
        <button key={c} className="btn btn-ghost" title={UI.remove} onClick={() => edit({ featured: v.featured.filter((x) => x !== c) })}>
          {charName(c)} ×
        </button>
      ))}
      {links.map((l: LinkTarget, i) => (
        <span key={i} className="ld-inline">
          <button className="btn btn-ghost" onClick={() => jumpTo(l)}>
            <Link2 size={12} /> {targetLabel(l)}
          </button>
          <button className="icon-btn" aria-label={UI.remove} title={UI.remove} onClick={() => edit({ links: links.filter((_, j) => j !== i) })}>
            <X size={12} />
          </button>
        </span>
      ))}
      {characters.length > 0 && (
        <select className="input" value="" onChange={(e) => e.target.value && edit({ featured: [...v.featured, e.target.value] })}>
          <option value="">{UI.featureChar}</option>
          {characters
            .filter((c) => !v.featured.includes(c.id))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || UI.untitled}
              </option>
            ))}
        </select>
      )}
      <button
        className="btn btn-ghost"
        onClick={async () => {
          const t = await pickJumpTarget(UI.featureAsk)
          if (t) edit({ links: [...links, t] })
        }}
      >
        <Plus size={13} /> {UI.featureAny}
      </button>
    </div>
  )
}

function PassTab({
  d,
  passes,
  passId,
  setPassId,
  profiles,
  set,
  editPass,
  addPass,
  removePass,
}: {
  d: LiveOpsDoc
  passes: ReturnType<typeof passesOf>
  passId: Id | null
  setPassId(id: Id): void
  profiles: { name: string; hoursPerDay: number }[]
  set(fn: (d: LiveOpsDoc) => LiveOpsDoc): void
  editPass(id: Id, p: Partial<BattlePass>): void
  addPass(): void
  removePass(id: Id): void
}) {
  const p = passes.find((x) => x.id === passId) ?? passes[0]
  const setProfiles = (fn: (ps: typeof profiles) => typeof profiles) => set((x) => ({ ...x, profiles: fn(x.profiles ?? DEFAULT_PROFILES) }))
  return (
    <div className="lo-body">
      <div className="ld-inline lo-tabs">
        {passes.map((x) => (
          <button key={x.id} className={`btn btn-ghost${x.id === p?.id ? ' on' : ''}`} onClick={() => setPassId(x.id)}>
            {x.name || UI.pass} · {weekText(x.startWeek)}
          </button>
        ))}
        <button className="btn btn-ghost" onClick={addPass}>
          <Plus size={14} /> {UI.addPass}
        </button>
        <button className="btn btn-ghost" title={UI.perVersionTip} onClick={() => set(passPerVersion)}>
          <Plus size={14} /> {UI.perVersion}
        </button>
      </div>
      {!p ? (
        <p className="muted">{UI.noPass}</p>
      ) : (
        <>
          <div className="ld-inline">
            <label className="ld-field">
              <span>{UI.name}</span>
              <input className="input" value={p.name ?? ''} placeholder={UI.pass} onChange={(e) => editPass(p.id, { name: e.target.value })} />
            </label>
            <label className="ld-field">
              <span>
                {UI.startWeek} ({weekDate(d.start, p.startWeek) || weekText(p.startWeek)})
              </span>
              <NumberInput value={p.startWeek} min={0} onChange={(startWeek) => editPass(p.id, { startWeek: Math.max(0, startWeek) })} />
            </label>
            <label className="ld-field">
              <span>{UI.runsFor}</span>
              <NumberInput value={p.weeks} min={1 / 7} onChange={(weeks) => editPass(p.id, { weeks })} />
            </label>
            <label className="ld-field">
              <span>{UI.tiers}</span>
              <NumberInput value={p.tiers} min={1} onChange={(tiers) => editPass(p.id, { tiers: Math.max(1, Math.round(tiers)) })} />
            </label>
            <label className="ld-field">
              <span>{UI.xpPerTier}</span>
              <NumberInput value={p.xpPerTier} min={1} onChange={(xpPerTier) => editPass(p.id, { xpPerTier })} />
            </label>
            <label className="ld-field">
              <span>{UI.xpPerHour}</span>
              <NumberInput value={p.xpPerHour} min={0} onChange={(xpPerHour) => editPass(p.id, { xpPerHour })} />
            </label>
          </div>
          <div className="ld-result">
            {profiles.map((pr, i) => {
              const r = passDays(p, pr.hoursPerDay)
              return (
                <div key={i} className="ld-stat">
                  <span>
                    {pr.name} ({pr.hoursPerDay} h)
                  </span>
                  <strong className={r.fits ? '' : 'lo-bad'}>{Number.isFinite(r.days) ? UI.daysN(r.days) : UI.never}</strong>
                  <span>{r.fits ? UI.finishes : UI.misses(Math.round(p.weeks * 7))}</span>
                </div>
              )
            })}
          </div>
          <h3 title={UI.profilesTip}>{UI.profiles}</h3>
          <p className="muted">{UI.profilesTip}</p>
          <table className="calc-table lo-table">
            <tbody>
              {profiles.map((pr, i) => (
                <tr key={i}>
                  <td>
                    <input className="input" value={pr.name} aria-label={UI.name} onChange={(e) => setProfiles((ps) => ps.map((o, j) => (j === i ? { ...o, name: e.target.value } : o)))} />
                  </td>
                  <td>
                    <NumberInput value={pr.hoursPerDay} min={0} step={0.25} onChange={(hoursPerDay) => setProfiles((ps) => ps.map((o, j) => (j === i ? { ...o, hoursPerDay } : o)))} /> {UI.hoursADay}
                  </td>
                  <td>
                    <button className="icon-btn" aria-label={UI.remove} onClick={() => setProfiles((ps) => ps.filter((_, j) => j !== i))}>
                      <X size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <button className="btn btn-ghost" onClick={() => setProfiles((ps) => [...ps, { name: UI.newProfile, hoursPerDay: 1 }])}>
              <Plus size={14} /> {UI.addProfile}
            </button>
          </div>
          <h3>{UI.rewards}</h3>
          <table className="calc-table lo-table">
            <thead>
              <tr>
                <th>{UI.tier}</th>
                <th>{UI.free}</th>
                <th>{UI.paid}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {p.rewards.map((r, i) => {
                const edit = (q: Partial<typeof r>) => editPass(p.id, { rewards: p.rewards.map((o, j) => (j === i ? { ...o, ...q } : o)) })
                return (
                  <tr key={i}>
                    <td>
                      <NumberInput value={r.tier} min={1} max={p.tiers} onChange={(tier) => edit({ tier: Math.round(tier) })} />
                    </td>
                    <td>
                      <input className="input" value={r.free} onChange={(e) => edit({ free: e.target.value })} aria-label={UI.free} />
                    </td>
                    <td>
                      <input className="input" value={r.paid} onChange={(e) => edit({ paid: e.target.value })} aria-label={UI.paid} />
                    </td>
                    <td>
                      <button className="icon-btn" aria-label={UI.remove} onClick={() => editPass(p.id, { rewards: p.rewards.filter((_, j) => j !== i) })}>
                        <X size={13} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="ld-inline">
            <button className="btn btn-ghost" onClick={() => editPass(p.id, { rewards: [...p.rewards, { tier: Math.min(p.tiers, (p.rewards.at(-1)?.tier ?? 0) + 1), free: '', paid: '' }].sort((a, b) => a.tier - b.tier) })}>
              <Plus size={14} /> {UI.reward}
            </button>
            <button className="btn btn-ghost" onClick={() => removePass(p.id)}>
              <Trash2 size={13} /> {UI.removePass}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

const toggle = (s: Set<Id>, id: Id) => {
  const n = new Set(s)
  if (n.has(id)) n.delete(id)
  else n.add(id)
  return n
}

function Row({ name, tip, week, tall = 1, onAdd, children }: { name: string; tip: string; week: number; tall?: number; onAdd?(): void; children: ReactNode }) {
  return (
    <div className="lo-row" style={{ height: tall * LANE + 10 }}>
      <span className="lo-rowname" title={tip}>
        {name}
        {onAdd && (
          <button className="icon-btn" aria-label={UI.addTo(name)} title={UI.addTo(name)} onClick={onAdd}>
            <Plus size={13} />
          </button>
        )}
      </span>
      <div className="lo-lane" style={{ backgroundSize: `${week}px 100%` }}>
        {children}
      </div>
    </div>
  )
}

function Bar({ left, width, top = 0, color, title, on, onMove, onSize, children }: { left: number; width: number; top?: number; color: string; title: string; on?: boolean; onMove?(e: ReactPointerEvent): void; onSize?(e: ReactPointerEvent): void; children: ReactNode }) {
  return (
    <div className={`lo-bar${onMove ? ' movable' : ''}${on ? ' on' : ''}`} style={{ left, width: Math.max(14, width), top, background: color }} title={title} onPointerDown={onMove}>
      <span className="lo-bar-text">{children}</span>
      {onSize && <span className="lo-bar-size" onPointerDown={onSize} />}
    </div>
  )
}
