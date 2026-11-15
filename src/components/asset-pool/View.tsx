import {
  Box,
  Check,
  Clapperboard,
  ExternalLink,
  FolderOpen,
  Gem,
  LayoutGrid,
  LayoutList,
  ListPlus,
  Music,
  Palette,
  PanelsTopLeft,
  Paperclip,
  PersonStanding,
  Plus,
  Search,
  Shapes,
  Sparkles,
  SquareKanban,
  Star,
  Trash2,
  Volume2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { dragHasFiles, importAssetsFromDataTransfer, pickAndImportAssets, resolveAssetPath, useAssetUrls, type ImportedAsset } from '@/core/assets'
import { getFs } from '@/core/fs'
import { ENTITY_TYPES, newId, type EntityType, type Id } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { postIntent, useDocument, useIntentHandler, useProjectStore, useUndoRedoKeys } from '@/core/state'
import { openComponent } from '@/shell/editor/actions'
import { confirmDialog } from '@/shared/dialogs'
import { openEntity } from '@/shared/entityList'
import { Modal } from '@/shared/ui'
import {
  ASSET_KINDS,
  createPool,
  guessKind,
  isLate,
  makeMain,
  newEntry,
  parseChecklist,
  PRIORITIES,
  progress,
  STATUSES,
  trackedIds,
  type AssetEntry,
  type AssetKind,
  type AssetPool,
  type Priority,
  type Status,
} from './model'
import './asset-pool.css'
import { ProofTextarea } from '@/shared/spell'

const UI = {
  add: 'New asset',
  bulk: 'Add many…',
  search: 'Search assets',
  all: 'All',
  allKinds: 'Any kind',
  empty: 'Nothing to make yet. Add assets one by one, or use Add many… to add one for every item, character, town or enemy, or paste a checklist.',
  noMatch: 'No assets match the filters.',
  done: (d: number, t: number) => `${d} of ${t} done`,
  name: 'Name',
  kind: 'Kind',
  status: 'Status',
  notes: 'Notes',
  notesHint: 'Style, size, references…',
  files: 'Pictures and files',
  filesHint: 'Pictures, the sound, the model, the source file (.psd, .blend…). Drop anything onto this panel.',
  add1: 'Add picture or file',
  dropHere: 'Drop a picture or file here',
  for: 'For',
  openSource: 'Open',
  deleted: '(deleted)',
  delete: 'Delete asset',
  owner: 'Who makes it',
  ownerHint: 'A name, or leave empty',
  anyone: 'Anyone',
  team: 'Who, when, priority',
  due: 'Due',
  priority: 'Priority',
  show: 'Show in folder',
  makeMain: 'Make this the main picture',
  main: 'Main picture, shown in the list',
  makeTask: 'Make a task',
  makeTaskHint: 'Adds a task on the Task Board with this name, who, due date and picture',
  openTask: 'Open its task',
  late: 'late',
  rows: 'List',
  tiles: 'Pictures',
  statusOf: (name: string) => `Status of ${name}`,
}

const today = () => new Date().toISOString().slice(0, 10)
const isAudio = (path: string) => path.startsWith('assets/audio/')

const ENTITY_LABEL: Record<EntityType, string> = { item: 'Items', character: 'Characters', town: 'Towns', enemy: 'Enemies' }
const ENTITY_ONE: Record<EntityType, string> = { item: 'Item', character: 'Character', town: 'Town', enemy: 'Enemy' }

/** Shown instead of a picture until the asset has one, so the list says what each asset is at a glance. */
const KIND_ICON: Record<AssetKind, LucideIcon> = {
  '2D art': Palette,
  Icon: Gem,
  Sprite: PersonStanding,
  '3D model': Box,
  Animation: Clapperboard,
  Sound: Volume2,
  Music: Music,
  UI: PanelsTopLeft,
  VFX: Sparkles,
  Other: Shapes,
}

const VIEW_KEY = 'egd-asset-pool-view'
type ViewMode = 'rows' | 'tiles'
const loadView = (): ViewMode => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'tiles' ? 'tiles' : 'rows'
  } catch {
    return 'rows'
  }
}

/** The main picture, or the kind's icon when there is none yet. */
function Thumb({ e, url, className }: { e: AssetEntry; url?: string; className: string }) {
  const Icon = KIND_ICON[e.kind] ?? Shapes
  return <div className={`${className} pool-kind-${e.status}`}>{e.images[0] && url ? <img src={url} alt="" /> : <Icon size={className === 'pool-thumb' ? 18 : 36} />}</div>
}

/** A status pill that opens the four statuses (a native menu, so it works with keys and touch), never a blind click-to-cycle. */
function StatusPick({ e, label, onChange }: { e: AssetEntry; label: string; onChange: (s: Status) => void }) {
  return (
    <select
      className={`pool-status pool-status-${e.status}`}
      aria-label={label}
      title={label}
      value={e.status}
      onClick={(ev) => ev.stopPropagation()}
      onChange={(ev) => onChange(ev.target.value as Status)}
    >
      {STATUSES.map((s) => (
        <option key={s.id} value={s.id}>
          {s.label}
        </option>
      ))}
    </select>
  )
}

/**
 * Asset Pool (v0.5, redesigned v0.32). Intents: `select` ({ id }) shows one entry; `add-image` ({ path, name }) attaches a picture to the
 * selected asset, or makes a new asset from it when none is selected.
 */
export default function View({ active }: PanelProps) {
  const doc = useDocument<AssetPool>('asset-pool', 'pool', createPool)
  useUndoRedoKeys(doc, active)
  const root = useProjectStore((s) => s.root)
  const entities = useProjectStore((s) => s.entities)
  const [selectedId, setSelectedId] = useState<Id | null>(null)
  const [justAdded, setJustAdded] = useState<Id | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<Status | ''>('')
  const [kindFilter, setKindFilter] = useState<AssetKind | ''>('')
  const [ownerFilter, setOwnerFilter] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)
  const [view, setViewState] = useState<ViewMode>(loadView)
  const [dropping, setDropping] = useState(false)
  const pool = doc.data
  const urlOf = useAssetUrls(pool?.entries.flatMap((e) => [...e.images, ...(e.files ?? []).filter((f) => isAudio(f.path)).map((f) => f.path)]) ?? [])
  const owners = [...new Set((pool?.entries ?? []).map((e) => e.owner?.trim() ?? '').filter(Boolean))].sort()

  const setView = (v: ViewMode) => {
    setViewState(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // no storage: the choice lasts until the tool closes
    }
  }

  const nameOf = (e: AssetEntry) => {
    if (!e.sourceType || !e.sourceId) return e.name
    return (entities[e.sourceType] as { id: Id; name: string }[]).find((x) => x.id === e.sourceId)?.name ?? e.name
  }
  const sourceExists = (e: AssetEntry) => !!e.sourceType && (entities[e.sourceType] as { id: Id }[]).some((x) => x.id === e.sourceId)

  const edit = (id: Id, patch: Partial<AssetEntry>) => doc.update((p) => ({ ...p, entries: p.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) }))

  useIntentHandler(
    'asset-pool',
    (intent) => {
      // A link to one asset (Ctrl+K, [[ ]] in the Wiki or Writer) opens the pool on it.
      if (intent.action === 'select' && typeof intent.id === 'string') return setSelectedId(intent.id)
      if (intent.action !== 'add-image' || typeof intent.path !== 'string') return
      const path = intent.path
      const target = pool?.entries.find((e) => e.id === selectedId)
      if (target) edit(target.id, { images: [...target.images, path] })
      else {
        const entry = { ...newEntry(String(intent.name ?? 'New asset'), '2D art'), status: 'in-progress' as const, images: [path] }
        doc.update((p) => ({ ...p, entries: [...p.entries, entry] }))
        setSelectedId(entry.id)
      }
    },
    !!pool,
  )

  // Everything but the status filter; the status chips count from this.
  const matching = useMemo(() => {
    if (!pool) return []
    const q = query.trim().toLowerCase()
    return pool.entries.filter(
      (e) =>
        (!kindFilter || e.kind === kindFilter) &&
        (!ownerFilter || (e.owner?.trim() ?? '') === ownerFilter) &&
        (!q || nameOf(e).toLowerCase().includes(q) || e.notes.toLowerCase().includes(q) || (e.owner ?? '').toLowerCase().includes(q)),
    )
    // nameOf reads entities, which are in the deps.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, query, kindFilter, ownerFilter, entities])

  if (!pool) return null
  const selected = pool.entries.find((e) => e.id === selectedId) ?? null
  const { done, total } = progress(pool.entries)
  const groups = STATUSES.filter((s) => !statusFilter || s.id === statusFilter)
    .map((s) => ({ ...s, entries: matching.filter((e) => e.status === s.id) }))
    .filter((g) => g.entries.length)

  const add = () => {
    const entry = newEntry('New asset', kindFilter || '2D art')
    doc.update((p) => ({ ...p, entries: [...p.entries, entry] }))
    setSelectedId(entry.id)
    setJustAdded(entry.id)
    setStatusFilter('')
  }

  const remove = async (e: AssetEntry) => {
    if (!(await confirmDialog({ title: `Delete ${nameOf(e)}?`, message: 'You can undo with Ctrl+Z.', confirmLabel: 'Delete', danger: true }))) return
    doc.update((p) => ({ ...p, entries: p.entries.filter((x) => x.id !== e.id) }))
    setSelectedId(null)
  }

  /** Pictures go to the pictures, everything else (sounds, models, source files) to the file list. */
  const attach = (e: AssetEntry, assets: ImportedAsset[]) => {
    if (!assets.length) return
    const pics = assets.filter((a) => a.kind === 'image').map((a) => a.path)
    const files = assets.filter((a) => a.kind !== 'image').map((a) => ({ path: a.path, name: a.name }))
    edit(e.id, { images: [...e.images, ...pics], ...(files.length ? { files: [...(e.files ?? []), ...files] } : {}) })
  }
  const pickFiles = async (e: AssetEntry) => root && attach(e, await pickAndImportAssets(root, 'file', UI.add1))

  const reveal = async (path: string) => {
    if (root) await getFs().revealInFolder(await resolveAssetPath(root, path))
  }

  const makeTask = (e: AssetEntry) => {
    if (e.taskId) {
      postIntent('tasks', { action: 'open-task', taskId: e.taskId })
    } else {
      const taskId = newId()
      postIntent('tasks', {
        action: 'add-task',
        taskId,
        title: nameOf(e),
        notes: [`${e.kind}, from the Asset Pool.`, e.notes].filter(Boolean).join('\n'),
        assignee: e.owner ?? '',
        due: e.due ?? '',
        priority: e.priority ?? 'Normal',
        image: e.images[0] ?? '',
        links: e.sourceType && e.sourceId ? [{ kind: e.sourceType, id: e.sourceId }] : [],
      })
      edit(e.id, { taskId })
    }
    openComponent('tasks')
  }

  const meta = (e: AssetEntry) => (
    <>
      {e.kind}
      {e.sourceType && ` · ${ENTITY_ONE[e.sourceType]}${sourceExists(e) ? '' : ` ${UI.deleted}`}`}
      {e.owner?.trim() && ` · ${e.owner.trim()}`}
      {e.due && <span className={isLate(e, today()) ? 'pool-late' : undefined}>{` · ${UI.due} ${e.due}${isLate(e, today()) ? ` (${UI.late})` : ''}`}</span>}
      {(e.files?.length ?? 0) > 0 && (
        <span title={e.files!.map((f) => f.name).join(', ')}>
          {' · '}
          <Paperclip size={11} /> {e.files!.length}
        </span>
      )}
    </>
  )

  const teamUsed = !!selected && !!(selected.owner?.trim() || selected.due || (selected.priority && selected.priority !== 'Normal') || selected.taskId)

  return (
    <div className="pool">
      <div className="pool-main">
        <div className="pool-toolbar">
          <button className="btn btn-primary" onClick={add}>
            <Plus size={14} /> {UI.add}
          </button>
          <button className="btn" onClick={() => setBulkOpen(true)}>
            <ListPlus size={14} /> {UI.bulk}
          </button>
          <label className="pool-search">
            <Search size={14} />
            <input className="input" placeholder={UI.search} value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <select className="input" value={kindFilter} onChange={(e) => setKindFilter(e.target.value as AssetKind | '')}>
            <option value="">{UI.allKinds}</option>
            {ASSET_KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          {owners.length > 0 && (
            <select className="input" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
              <option value="">{UI.anyone}</option>
              {owners.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          )}
          <div className="pool-segmented" role="group" aria-label="View">
            <button className={`icon-btn${view === 'rows' ? ' on' : ''}`} title={UI.rows} aria-pressed={view === 'rows'} onClick={() => setView('rows')}>
              <LayoutList size={15} />
            </button>
            <button className={`icon-btn${view === 'tiles' ? ' on' : ''}`} title={UI.tiles} aria-pressed={view === 'tiles'} onClick={() => setView('tiles')}>
              <LayoutGrid size={15} />
            </button>
          </div>
        </div>

        {pool.entries.length > 0 && (
          <div className="pool-statusbar">
            <button className={`pool-chip${statusFilter === '' ? ' is-on' : ''}`} onClick={() => setStatusFilter('')}>
              {UI.all} <b>{matching.length}</b>
            </button>
            {STATUSES.map((s) => (
              <button
                key={s.id}
                className={`pool-chip pool-chip-${s.id}${statusFilter === s.id ? ' is-on' : ''}`}
                onClick={() => setStatusFilter(statusFilter === s.id ? '' : s.id)}
              >
                {s.label} <b>{matching.filter((e) => e.status === s.id).length}</b>
              </button>
            ))}
            <span className="pool-progress" title={UI.done(done, total)}>
              <span className="pool-progress-bar">
                <span style={{ width: total ? `${(done / total) * 100}%` : 0 }} />
              </span>
              {UI.done(done, total)}
            </span>
          </div>
        )}

        {pool.entries.length === 0 ? (
          <p className="pool-empty muted">{UI.empty}</p>
        ) : groups.length === 0 ? (
          <p className="pool-empty muted">{UI.noMatch}</p>
        ) : (
          <div className="pool-list">
            {groups.map((g) => (
              <section key={g.id} className="pool-group">
                <h4 className={`pool-group-head pool-chip-${g.id}`}>
                  {g.label} <span className="muted">{g.entries.length}</span>
                </h4>
                <div className={view === 'tiles' ? 'pool-tiles' : 'pool-rows'}>
                  {g.entries.map((e) =>
                    view === 'tiles' ? (
                      <div key={e.id} className={`pool-tile${e.id === selectedId ? ' is-selected' : ''}`} onClick={() => setSelectedId(e.id)}>
                        <Thumb e={e} url={e.images[0] ? urlOf(e.images[0]) : undefined} className="pool-tile-pic" />
                        <div className="pool-row-name" title={nameOf(e)}>
                          {nameOf(e)}
                        </div>
                        <div className="pool-tile-foot">
                          <span className="pool-row-meta">{e.kind}</span>
                          <StatusPick e={e} label={UI.statusOf(nameOf(e))} onChange={(status) => edit(e.id, { status })} />
                        </div>
                      </div>
                    ) : (
                      <div key={e.id} className={`pool-row${e.id === selectedId ? ' is-selected' : ''}`} onClick={() => setSelectedId(e.id)}>
                        <Thumb e={e} url={e.images[0] ? urlOf(e.images[0]) : undefined} className="pool-thumb" />
                        <div className="pool-row-main">
                          <div className="pool-row-name">{nameOf(e)}</div>
                          <div className="pool-row-meta">{meta(e)}</div>
                        </div>
                        <StatusPick e={e} label={UI.statusOf(nameOf(e))} onChange={(status) => edit(e.id, { status })} />
                      </div>
                    ),
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <aside
          className={`pool-detail${dropping ? ' is-dropping' : ''}`}
          onDragOver={(e) => {
            if (!dragHasFiles(e.dataTransfer)) return
            e.preventDefault()
            setDropping(true)
          }}
          onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropping(false)}
          onDrop={async (e) => {
            setDropping(false)
            if (!root || !dragHasFiles(e.dataTransfer)) return
            e.preventDefault()
            attach(selected, await importAssetsFromDataTransfer(root, e.dataTransfer, 'file'))
          }}
        >
          <div className="pool-detail-head">
            <button className="pool-hero" title={selected.images[0] ? UI.main : UI.add1} onClick={() => !selected.images[0] && void pickFiles(selected)}>
              <Thumb e={selected} url={selected.images[0] ? urlOf(selected.images[0]) : undefined} className="pool-hero-pic" />
              {!selected.images[0] && <span className="muted">{UI.dropHere}</span>}
            </button>
            <button className="icon-btn pool-close" title="Close" onClick={() => setSelectedId(null)}>
              <X size={14} />
            </button>
          </div>

          {selected.sourceType && selected.sourceId ? (
            <div className="pool-field">
              <h3 className="pool-title">{nameOf(selected)}</h3>
              <span className="pool-source muted">
                {UI.for} {ENTITY_ONE[selected.sourceType]}
                {sourceExists(selected) ? (
                  <button className="btn btn-ghost" onClick={() => openEntity(selected.sourceType!, selected.sourceId!)}>
                    <ExternalLink size={13} /> {UI.openSource}
                  </button>
                ) : (
                  ` ${UI.deleted}`
                )}
              </span>
            </div>
          ) : (
            <label className="pool-field">
              {UI.name}
              <input
                key={selected.id}
                className="input pool-name"
                autoFocus={selected.id === justAdded}
                onFocus={(e) => selected.id === justAdded && e.target.select()}
                value={selected.name}
                onChange={(e) => edit(selected.id, { name: e.target.value })}
              />
            </label>
          )}

          <div className="pool-field">
            {UI.status}
            <div className="pool-steps" role="radiogroup" aria-label={UI.status}>
              {STATUSES.map((s, i) => {
                const at = STATUSES.findIndex((x) => x.id === selected.status)
                return (
                  <button
                    key={s.id}
                    role="radio"
                    aria-checked={s.id === selected.status}
                    className={`pool-step pool-chip-${s.id}${s.id === selected.status ? ' is-on' : ''}${i < at ? ' is-past' : ''}`}
                    onClick={() => edit(selected.id, { status: s.id })}
                  >
                    {i < at && <Check size={12} />}
                    {s.label}
                  </button>
                )
              })}
            </div>
          </div>

          <label className="pool-field">
            {UI.kind}
            <select className="input" value={selected.kind} onChange={(e) => edit(selected.id, { kind: e.target.value as AssetKind })}>
              {ASSET_KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>

          <div className="pool-field">
            {UI.files}
            {selected.images.length > 0 && (
              <div className="pool-pictures">
                {selected.images.map((p, i) => (
                  <div key={`${p}-${i}`} className={`pool-picture${i === 0 ? ' is-main' : ''}`} title={i === 0 ? UI.main : undefined}>
                    {urlOf(p) ? <img src={urlOf(p)} alt="" /> : <div className="placeholder-image" />}
                    <button className="icon-btn" title="Remove picture" onClick={() => edit(selected.id, { images: selected.images.filter((_, j) => j !== i) })}>
                      <X size={12} />
                    </button>
                    {i > 0 && (
                      <button className="icon-btn pool-make-main" title={UI.makeMain} onClick={() => edit(selected.id, { images: makeMain(selected.images, i) })}>
                        <Star size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {(selected.files ?? []).map((f, i) => (
              <div key={`${f.path}-${i}`} className="pool-file">
                <div className="pool-file-head">
                  <Paperclip size={12} />
                  <span className="pool-file-name" title={f.name}>
                    {f.name}
                  </span>
                  <button className="icon-btn" title={UI.show} onClick={() => void reveal(f.path)}>
                    <FolderOpen size={13} />
                  </button>
                  <button className="icon-btn" title="Remove file" onClick={() => edit(selected.id, { files: (selected.files ?? []).filter((_, j) => j !== i) })}>
                    <X size={12} />
                  </button>
                </div>
                {isAudio(f.path) && urlOf(f.path) && <audio controls preload="none" src={urlOf(f.path)} />}
              </div>
            ))}
            <button className="btn" onClick={() => void pickFiles(selected)}>
              <Plus size={14} /> {UI.add1}
            </button>
            <span className="muted pool-hint">{UI.filesHint}</span>
          </div>

          <label className="pool-field">
            {UI.notes}
            <ProofTextarea className="input pool-notes" placeholder={UI.notesHint} value={selected.notes} onChange={(e) => edit(selected.id, { notes: e.target.value })} />
          </label>

          <details key={selected.id} className="pool-team" open={teamUsed || undefined}>
            <summary>{UI.team}</summary>
            <label className="pool-field">
              {UI.owner}
              <input className="input" list="pool-owners" placeholder={UI.ownerHint} value={selected.owner ?? ''} onChange={(e) => edit(selected.id, { owner: e.target.value })} />
              <datalist id="pool-owners">
                {owners.map((o) => (
                  <option key={o} value={o} />
                ))}
              </datalist>
            </label>
            <div className="pool-field-row">
              <label className="pool-field">
                {UI.due}
                <input className="input" type="date" value={selected.due ?? ''} onChange={(e) => edit(selected.id, { due: e.target.value })} />
              </label>
              <label className="pool-field">
                {UI.priority}
                <select className="input" value={selected.priority ?? 'Normal'} onChange={(e) => edit(selected.id, { priority: e.target.value as Priority })}>
                  {PRIORITIES.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
            </div>
            <button className="btn" title={selected.taskId ? undefined : UI.makeTaskHint} onClick={() => makeTask(selected)}>
              <SquareKanban size={14} /> {selected.taskId ? UI.openTask : UI.makeTask}
            </button>
          </details>

          <button className="btn btn-ghost pool-delete" onClick={() => void remove(selected)}>
            <Trash2 size={14} /> {UI.delete}
          </button>
        </aside>
      )}

      {bulkOpen && (
        <BulkAdd
          pool={pool}
          onClose={() => setBulkOpen(false)}
          onAdd={(entries) => {
            setBulkOpen(false)
            if (entries.length) doc.update((p) => ({ ...p, entries: [...p.entries, ...entries] }))
          }}
        />
      )}
    </div>
  )
}

const BULK = {
  title: 'Add many assets',
  fromEntities: 'From the project',
  fromChecklist: 'From a checklist',
  kind: 'Kind of asset',
  all: 'Select all',
  none: 'Select none',
  allTracked: (what: string, kind: string) => `Every ${what.toLowerCase()} already has a ${kind} asset.`,
  noEntities: (what: string) => `This project has no ${what.toLowerCase()} yet.`,
  checklistHint: 'One asset per line. Bullets and checkboxes like "- [ ] Sword icon" are fine.',
  guess: 'Guess from the name',
  add: (n: number) => (n === 1 ? 'Add 1 asset' : `Add ${n} assets`),
  cancel: 'Cancel',
}

function BulkAdd({ pool, onClose, onAdd }: { pool: AssetPool; onClose: () => void; onAdd: (entries: AssetEntry[]) => void }) {
  const entities = useProjectStore((s) => s.entities)
  const [mode, setMode] = useState<'entities' | 'checklist'>('entities')
  const [type, setType] = useState<EntityType>('item')
  const [kind, setKind] = useState<AssetKind>('Icon')
  // A checklist mixes kinds ("Forest music", "Sword icon"), so by default each line gets its own guess.
  const [listKind, setListKind] = useState<AssetKind | ''>('')
  const [text, setText] = useState('')
  const tracked = trackedIds(pool, type, kind)
  const candidates = (entities[type] as { id: Id; name: string }[]).filter((e) => !tracked.has(e.id))
  const [picked, setPicked] = useState<Set<Id> | null>(null)
  const chosen = picked ?? new Set(candidates.map((c) => c.id))
  const lines = parseChecklist(text)
  const count = mode === 'entities' ? candidates.filter((c) => chosen.has(c.id)).length : lines.length

  const toggle = (id: Id) => {
    const next = new Set(chosen)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPicked(next)
  }

  const submit = () =>
    onAdd(
      mode === 'entities'
        ? candidates.filter((c) => chosen.has(c.id)).map((c) => newEntry(c.name, kind, { type, id: c.id }))
        : lines.map((l) => newEntry(l, listKind || guessKind(l))),
    )

  return (
    <Modal onClose={onClose}>
      <div className="pool-bulk">
        <h3>{BULK.title}</h3>
        <div className="pool-tabs">
          <button className={`btn${mode === 'entities' ? ' btn-primary' : ''}`} onClick={() => setMode('entities')}>
            {BULK.fromEntities}
          </button>
          <button className={`btn${mode === 'checklist' ? ' btn-primary' : ''}`} onClick={() => setMode('checklist')}>
            {BULK.fromChecklist}
          </button>
        </div>
        <label className="pool-field">
          {BULK.kind}
          {mode === 'entities' ? (
            <select
              className="input"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as AssetKind)
                setPicked(null)
              }}
            >
              {ASSET_KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          ) : (
            <select className="input" value={listKind} onChange={(e) => setListKind(e.target.value as AssetKind | '')}>
              <option value="">{BULK.guess}</option>
              {ASSET_KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          )}
        </label>
        {mode === 'entities' ? (
          <>
            <div className="pool-tabs">
              {ENTITY_TYPES.map((t) => (
                <button
                  key={t}
                  className={`btn btn-ghost${t === type ? ' is-active' : ''}`}
                  onClick={() => {
                    setType(t)
                    setPicked(null)
                  }}
                >
                  {ENTITY_LABEL[t]}
                </button>
              ))}
            </div>
            {entities[type].length === 0 ? (
              <p className="muted">{BULK.noEntities(ENTITY_LABEL[type])}</p>
            ) : candidates.length === 0 ? (
              <p className="muted">{BULK.allTracked(ENTITY_LABEL[type], kind)}</p>
            ) : (
              <>
                <div className="pool-tabs">
                  <button className="btn btn-ghost" onClick={() => setPicked(new Set(candidates.map((c) => c.id)))}>
                    {BULK.all}
                  </button>
                  <button className="btn btn-ghost" onClick={() => setPicked(new Set())}>
                    {BULK.none}
                  </button>
                </div>
                <div className="pool-bulk-list">
                  {candidates.map((c) => (
                    <label key={c.id} className="pool-check">
                      <input type="checkbox" checked={chosen.has(c.id)} onChange={() => toggle(c.id)} />
                      {c.name}
                    </label>
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <p className="muted">{BULK.checklistHint}</p>
            <textarea className="input pool-checklist" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
            {lines.length > 0 && (
              <div className="pool-bulk-list pool-bulk-preview">
                {lines.map((l, i) => (
                  <div key={i} className="pool-check">
                    <span className="pool-bulk-kind">{listKind || guessKind(l)}</span>
                    {l}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {BULK.cancel}
          </button>
          <button className="btn btn-primary" disabled={!count} onClick={submit}>
            {BULK.add(count)}
          </button>
        </div>
      </div>
    </Modal>
  )
}
