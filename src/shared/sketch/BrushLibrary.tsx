import { shrinkBrushImages } from './brushImages'
import { dragFromRowOnly } from '@/shared/dragGuard'
import {
  Blend,
  BookOpen,
  Brush,
  Copy,
  Download,
  Droplet,
  Eraser,
  Flame,
  Folder,
  FolderPlus,
  Grid3x3,
  Heart,
  Highlighter,
  Leaf,
  MoreHorizontal,
  Pencil,
  PenTool,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  SprayCan,
  Square,
  Star,
  Trash2,
  Type,
  Upload,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { saveBinaryFile, safeFileName } from '@/core/export'
import { getFs } from '@/core/fs'
import type { Id } from '@/core/model'
import { confirmDialog, promptDialog } from '../dialogs'
import { Modal } from '../ui'
import { rgbToHex } from './brushColor'
import { BRUSH_EXTENSIONS, BrushFileError, exportBrushes, importBrushFile, type ImportedSet } from './brushFiles'
import { drawPreview, type BrushDef, type BrushSet } from './brushes'
import { BrushStudio } from './BrushStudio'
import { preloadBrush, useBrushLibrary } from './library'
import './studio.css'

const SET_ICONS: Record<string, LucideIcon> = {
  folder: Folder,
  pencil: Pencil,
  pen: PenTool,
  type: Type,
  brush: Brush,
  droplet: Droplet,
  flame: Flame,
  spray: SprayCan,
  highlighter: Highlighter,
  grid: Grid3x3,
  book: BookOpen,
  leaf: Leaf,
  blend: Blend,
  square: Square,
  eraser: Eraser,
  star: Star,
  heart: Heart,
  sparkles: Sparkles,
}

const UI = {
  title: 'Brush Library',
  recent: 'Recent',
  pinned: 'Pinned',
  search: 'Search brushes',
  results: 'Found',
  newSet: 'New brush set',
  newSetName: 'Name the brush set',
  newBrush: 'New brush',
  import: 'Import brushes (.egdbrush, .abr, .brush, .brushset)',
  rename: 'Rename',
  renameSet: 'Rename brush set',
  setMenu: 'Set options',
  setHint: 'Double-click to rename, right-click for more',
  icon: 'Icon',
  exportSet: 'Export this set',
  deleteSet: 'Delete brush set',
  deleteSetText: 'Brushes that are only in this set are deleted too.',
  edit: 'Edit in Brush Studio',
  duplicate: 'Duplicate',
  pin: 'Pin to the top',
  unpin: 'Unpin',
  exportBrush: 'Export this brush',
  reset: 'Reset to the original settings',
  deleteBrush: 'Delete brush',
  deleteBrushText: 'This cannot be undone.',
  renameBrush: 'Rename brush',
  drag: 'Drag brushes to reorder them or onto a set to move them. Drop brush files here to import them.',
  emptySet: 'No brushes in this set yet. Make one with +, or drag a brush here.',
  noResults: 'No brushes with that name.',
  dropHere: 'Drop brush files to import them',
  imported: 'Brushes imported',
  importFailed: 'Some files could not be imported',
  license: 'Imported brushes are covered by their creator’s license and are for your own use.',
  unmapped: 'Settings from the file that have no match here (the brush works without them):',
  replacedTitle: (n: number) => `${n} ${n === 1 ? 'brush looks' : 'brushes look'} different from the original`,
  replacedText:
    'Some brushes use a shape or grain from the original app’s own built-in library. That picture is not inside the file, so the closest shape or grain of ours is used instead. To get the exact look, give the brush its own shape picture in the original app before exporting, or import the picture in the Brush Studio.',
  replacedList: (n: number) => `Which ${n === 1 ? 'brush' : 'brushes'} and what was replaced`,
  ok: 'OK',
}

const DRAG = 'application/x-egd-brush'
const DRAG_SET = 'application/x-egd-brush-set'

/** The element's text color as #rrggbb. */
function textColor(el: Element): string | null {
  const m = getComputedStyle(el).color.match(/\d+/g)
  return m && m.length >= 3 ? rgbToHex(Number(m[0]), Number(m[1]), Number(m[2])) : null
}

const nameOf = (path: string) => path.split(/[\\/]/).pop() ?? path

function reorder(ids: Id[], id: Id, before: Id): Id[] {
  const rest = ids.filter((x) => x !== id)
  const i = rest.indexOf(before)
  rest.splice(i < 0 ? rest.length : i, 0, id)
  return rest
}

/** Brush library popover: sets on the left, brushes with stroke previews on the right. */
export function BrushLibrary({ mode, color, at, onClose }: { mode: 'brush' | 'eraser'; color: string; at: { x: number; y: number }; onClose: () => void }) {
  const lib = useBrushLibrary()
  const pinned = lib.pinned ?? []
  const current = mode === 'brush' ? lib.brushId : lib.eraserId
  const [setId, setSetId] = useState<Id>(() => (lib.recent.length ? 'recent' : (lib.sets.find((s) => s.brushIds.includes(current))?.id ?? lib.sets[0]?.id ?? 'recent')))
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Id | null>(null)
  const [dropSet, setDropSet] = useState<Id | null>(null)
  const [menu, setMenu] = useState<Id | null>(null)
  const [fileOver, setFileOver] = useState(false)
  const [report, setReport] = useState<{ sets: ImportedSet[]; errors: string[] } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Close when clicking outside (but not while Brush Studio or a dialog is open).
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (editing || report || document.querySelector('.modal-backdrop')) return
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', down)
    return () => window.removeEventListener('mousedown', down)
  }, [editing, report, onClose])

  const byId = new Map(lib.brushes.map((b) => [b.id, b]))
  const q = query.trim().toLowerCase()
  const ids = q
    ? lib.brushes.filter((b) => b.name.toLowerCase().includes(q)).map((b) => b.id)
    : setId === 'recent'
      ? lib.recent
      : setId === 'pinned'
        ? pinned
        : (lib.sets.find((s) => s.id === setId)?.brushIds ?? [])
  const shown = ids.map((id) => byId.get(id)).filter((b): b is BrushDef => !!b)
  const realSet = setId !== 'recent' && setId !== 'pinned' ? setId : (lib.sets.find((s) => s.brushIds.includes(current))?.id ?? lib.sets[0]?.id)
  const canReorder = !q && setId !== 'recent'
  const openSet = (id: Id) => {
    setSetId(id)
    setQuery('')
  }

  const newSet = async () => {
    const name = (await promptDialog(UI.newSetName, 'My brushes'))?.trim()
    if (name) setSetId(lib.createSet(name))
  }

  const importFiles = async (files: { name: string; bytes: () => Promise<Uint8Array> }[]) => {
    const sets: ImportedSet[] = []
    const errors: string[] = []
    for (const f of files) {
      try {
        for (const s of importBrushFile(f.name, await f.bytes())) {
          if (!s.brushes.length) continue
          s.brushes = await shrinkBrushImages(s.brushes)
          const id = useBrushLibrary.getState().addSet(s.name, s.brushes, s.icon ?? 'folder')
          s.brushes.forEach((b) => void preloadBrush(b))
          sets.push(s)
          openSet(id)
        }
      } catch (e) {
        errors.push(e instanceof BrushFileError ? e.message : `${f.name}: ${(e as Error).message}`)
      }
    }
    if (sets.length || errors.length) setReport({ sets, errors })
  }

  const pick = async () => {
    const fs = getFs()
    const paths = await fs.pickFiles(UI.import, BRUSH_EXTENSIONS)
    await importFiles(paths.map((p) => ({ name: nameOf(p), bytes: () => fs.readBinary(p) })))
  }

  const exportFile = async (name: string, sets: { name: string; icon?: string; brushes: BrushDef[] }[]) => {
    await saveBinaryFile({ title: UI.exportSet, defaultName: `${safeFileName(name)}.egdbrush`, bytes: exportBrushes(sets), filter: { name: 'Brushes', extensions: ['egdbrush'] } })
  }
  const exportSet = (s: BrushSet) => void exportFile(s.name, [{ name: s.name, icon: s.icon, brushes: s.brushIds.map((id) => byId.get(id)).filter((b): b is BrushDef => !!b) }])

  return (
    <div
      className={`brushlib${fileOver ? ' is-file-over' : ''}`}
      ref={ref}
      style={{ left: at.x, top: at.y }}
      onPointerDown={(e) => e.stopPropagation()}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setFileOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setFileOver(false)
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        setFileOver(false)
        void importFiles([...e.dataTransfer.files].map((f) => ({ name: f.name, bytes: async () => new Uint8Array(await f.arrayBuffer()) })))
      }}
    >
      <div className="brushlib-head">
        <h4>{UI.title}</h4>
        <label className="brushlib-search">
          <Search size={13} />
          <input placeholder={UI.search} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button className="icon-btn" title={UI.import} onClick={() => void pick()}>
          <Upload size={15} />
        </button>
        <button className="icon-btn" title={UI.newSet} onClick={() => void newSet()}>
          <FolderPlus size={15} />
        </button>
        {realSet && (
          <button
            className="icon-btn"
            title={UI.newBrush}
            onClick={() => {
              const id = lib.createBrush(realSet)
              setSetId(realSet)
              setEditing(id)
            }}
          >
            <Plus size={15} />
          </button>
        )}
      </div>
      <div className="brushlib-body">
        <nav className="brushlib-sets">
          {pinned.length > 0 && (
            <button className={`brushlib-set${setId === 'pinned' && !q ? ' is-active' : ''}`} onClick={() => openSet('pinned')}>
              <Pin size={13} /> <span>{UI.pinned}</span>
            </button>
          )}
          {lib.recent.length > 0 && (
            <button className={`brushlib-set${setId === 'recent' && !q ? ' is-active' : ''}`} onClick={() => openSet('recent')}>
              <RotateCcw size={13} /> <span>{UI.recent}</span>
            </button>
          )}
          {lib.sets.map((s) => {
            const Icon = SET_ICONS[s.icon ?? 'folder'] ?? Folder
            return (
              <div key={s.id} className="brushlib-set-wrap">
                <button
                  className={`brushlib-set${setId === s.id && !q ? ' is-active' : ''}${dropSet === s.id ? ' is-drop' : ''}`}
                  draggable
                  onPointerDownCapture={dragFromRowOnly}
                  onDragStart={(e) => e.dataTransfer.setData(DRAG_SET, s.id)}
                  onClick={() => openSet(s.id)}
                  onDoubleClick={async () => {
                    const name = (await promptDialog(UI.renameSet, s.name))?.trim()
                    if (name) lib.renameSet(s.id, name)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setMenu(s.id)
                  }}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes(DRAG) && !e.dataTransfer.types.includes(DRAG_SET)) return
                    e.preventDefault()
                    setDropSet(s.id)
                  }}
                  onDragLeave={() => setDropSet(null)}
                  onDrop={(e) => {
                    setDropSet(null)
                    const brush = e.dataTransfer.getData(DRAG)
                    const set = e.dataTransfer.getData(DRAG_SET)
                    if (brush) lib.moveBrush(brush, s.id)
                    else if (set) lib.moveSet(set, s.id)
                  }}
                  title={UI.setHint}
                >
                  <Icon size={13} /> <span>{s.name}</span>
                </button>
                <button className="icon-btn brushlib-set-more" title={UI.setMenu} onClick={() => setMenu(menu === s.id ? null : s.id)}>
                  <MoreHorizontal size={13} />
                </button>
                {menu === s.id && (
                  <div className="brushlib-menu" onMouseLeave={() => setMenu(null)}>
                    <span className="muted">{UI.icon}</span>
                    <div className="brushlib-icons">
                      {Object.entries(SET_ICONS).map(([id, I]) => (
                        <button key={id} className={`icon-btn${(s.icon ?? 'folder') === id ? ' is-active' : ''}`} onClick={() => lib.setIcon(s.id, id)}>
                          <I size={13} />
                        </button>
                      ))}
                    </div>
                    <button
                      className="brushlib-menu-item"
                      onClick={async () => {
                        setMenu(null)
                        const name = (await promptDialog(UI.renameSet, s.name))?.trim()
                        if (name) lib.renameSet(s.id, name)
                      }}
                    >
                      <Pencil size={13} /> {UI.rename}
                    </button>
                    <button
                      className="brushlib-menu-item"
                      onClick={() => {
                        setMenu(null)
                        exportSet(s)
                      }}
                    >
                      <Download size={13} /> {UI.exportSet}
                    </button>
                    <button
                      className="brushlib-menu-item danger"
                      onClick={async () => {
                        setMenu(null)
                        if (await confirmDialog({ title: `${UI.deleteSet}: ${s.name}?`, message: UI.deleteSetText, confirmLabel: UI.deleteSet, danger: true })) {
                          lib.deleteSet(s.id)
                          setSetId(lib.sets[0]?.id ?? 'recent')
                        }
                      }}
                    >
                      <Trash2 size={13} /> {UI.deleteSet}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </nav>
        <div className="brushlib-brushes">
          {q && <p className="muted brushlib-empty">{shown.length ? `${UI.results}: ${shown.length}` : UI.noResults}</p>}
          {!q && shown.length === 0 && <p className="muted brushlib-empty">{UI.emptySet}</p>}
          {shown.map((b) => (
            <BrushRow
              key={b.id}
              brush={b}
              color={mode === 'eraser' ? '#888' : color}
              active={b.id === current}
              pinned={pinned.includes(b.id)}
              onPick={() => lib.select(b.id, mode)}
              onEdit={() => setEditing(b.id)}
              onDuplicate={() => realSet && lib.duplicateBrush(b.id, realSet)}
              onPin={() => lib.togglePin(b.id)}
              onExport={() => void exportFile(b.name, [{ name: b.name, brushes: [b] }])}
              onDelete={async () => {
                if (await confirmDialog({ title: `${UI.deleteBrush}: ${b.name}?`, message: UI.deleteBrushText, confirmLabel: UI.deleteBrush, danger: true })) lib.deleteBrush(b.id)
              }}
              onRename={async () => {
                const name = (await promptDialog(UI.renameBrush, b.name))?.trim()
                if (name) lib.updateBrush(b.id, { name })
              }}
              onDropBefore={(id) => {
                if (!canReorder) return
                if (setId === 'pinned') useBrushLibrary.setState((s) => ({ pinned: reorder(s.pinned ?? [], id, b.id) }))
                else lib.moveBrush(id, setId, b.id)
              }}
            />
          ))}
          <p className="muted brushlib-hint">{UI.drag}</p>
        </div>
      </div>
      {fileOver && <div className="brushlib-drop">{UI.dropHere}</div>}
      {editing && <BrushStudio brushId={editing} color={color} onClose={() => setEditing(null)} />}
      {report && <ImportReport report={report} onClose={() => setReport(null)} />}
    </div>
  )
}

/** What was imported, what could not be used, and the license note (shown on every import). */
function ImportReport({ report, onClose }: { report: { sets: ImportedSet[]; errors: string[] }; onClose: () => void }) {
  const replaced = report.sets.reduce((n, s) => n + new Set((s.notes ?? []).map((x) => x.brush)).size, 0)
  return (
    <Modal onClose={onClose}>
      <h3>{report.sets.length ? UI.imported : UI.importFailed}</h3>
      {replaced > 0 && (
        <div className="brushlib-report-warning">
          <b>{UI.replacedTitle(replaced)}</b>
          <p>{UI.replacedText}</p>
        </div>
      )}
      <div className="brushlib-report-scroll">
        {report.sets.map((s, i) => (
          <div key={i} className="brushlib-report">
            <b>
              {s.name}: {s.brushes.length} {s.brushes.length === 1 ? 'brush' : 'brushes'}
            </b>
            {s.notes?.length ? (
              <details>
                <summary>{UI.replacedList(new Set(s.notes.map((x) => x.brush)).size)}</summary>
                <ul className="brushlib-report-notes">
                  {s.notes.map((n, j) => (
                    <li key={j}>
                      <b>{n.brush}</b>: {n.text}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {s.unmapped.length > 0 && (
              <details>
                <summary className="muted">{UI.unmapped}</summary>
                <ul>
                  {s.unmapped.map((u, j) => (
                    <li key={j}>
                      {u.brush}: <span className="muted">{u.keys.join(', ')}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
      {report.errors.map((e) => (
        <p key={e} className="brushlib-report-error">
          {e}
        </p>
      ))}
      </div>
      <p className="muted">{UI.license}</p>
      <div className="modal-actions">
        <button className="btn btn-primary" onClick={onClose}>
          {UI.ok}
        </button>
      </div>
    </Modal>
  )
}

function BrushRow(p: {
  brush: BrushDef
  color: string
  active: boolean
  pinned: boolean
  onPick(): void
  onEdit(): void
  onDuplicate(): void
  onPin(): void
  onExport(): void
  onDelete(): void
  onRename(): void
  onDropBefore(id: Id): void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let live = true
    // Custom shapes and grains load first, so the preview shows them.
    void preloadBrush(p.brush).then(() => {
      // Strokes in the text color, so they show on both themes.
      if (live && canvas.current) drawPreview(canvas.current, p.brush, textColor(canvas.current) ?? p.color)
    })
    return () => {
      live = false
    }
  }, [p.brush, p.color])
  return (
    <div
      className={`brushlib-brush${p.active ? ' is-active' : ''}`}
      draggable
      onPointerDownCapture={dragFromRowOnly}
      onDragStart={(e) => e.dataTransfer.setData(DRAG, p.brush.id)}
      onDragOver={(e) => e.dataTransfer.types.includes(DRAG) && e.preventDefault()}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(DRAG)
        if (id && id !== p.brush.id) {
          e.stopPropagation()
          p.onDropBefore(id)
        }
      }}
      onClick={p.onPick}
      onDoubleClick={p.onEdit}
    >
      <div className="brushlib-brush-name">
        {p.pinned && <Pin size={11} />} {p.brush.name}
      </div>
      <canvas ref={canvas} width={220} height={54} className="brushlib-preview" />
      <div className="brushlib-brush-actions" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn" title={UI.edit} onClick={p.onEdit}>
          <SlidersHorizontal size={13} />
        </button>
        <button className="icon-btn" title={p.pinned ? UI.unpin : UI.pin} onClick={p.onPin}>
          {p.pinned ? <PinOff size={13} /> : <Pin size={13} />}
        </button>
        <button className="icon-btn" title={UI.rename} onClick={p.onRename}>
          <Pencil size={13} />
        </button>
        <button className="icon-btn" title={UI.duplicate} onClick={p.onDuplicate}>
          <Copy size={13} />
        </button>
        <button className="icon-btn" title={UI.exportBrush} onClick={p.onExport}>
          <Download size={13} />
        </button>
        {p.brush.builtIn && (
          <button className="icon-btn" title={UI.reset} onClick={() => useBrushLibrary.getState().resetBrush(p.brush.id)}>
            <RotateCcw size={13} />
          </button>
        )}
        <button className="icon-btn" title={UI.deleteBrush} onClick={p.onDelete}>
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}
