import { ArrowLeft, ArrowRight, BookOpen, FolderClosed, FolderOpen, Search, Star, Boxes, ChevronDown, ChevronRight, CircleHelp, House, Keyboard, PanelLeftClose, PanelLeftOpen, Palette, Plus, Gem, Settings, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import { newId, type ComponentType, type Id, type SidebarFolder } from '@/core/model'
import { allManifests, getManifest, type ComponentManifest } from '@/core/registry'
import { useProjectStore, useSettings } from '@/core/state'
import { shownTool } from './optionalTools'
import { confirmDialog, promptDialog } from '@/shared/dialogs'
import { backToProjects, closePanel, DRAG_MIME, newDocument, openComponent, replaceWithComponent, type DragPayload } from './actions'
import { leaves } from '../workspace/layoutTree'
import { useHelp } from '../help/help'
import { openSettings } from '../settings/open'
import { openDesignBook } from '../designBook/open'
import { useEngineExport } from '../engineExport/open'
import { openRarities } from '@/shared/categories'
import { jumpBack, jumpForward, useJumpHistory } from '@/shared/entityList/navigation'
import { usePlugins } from '../plugins/plugins'
import { ProjectThemeDialog } from './projectTheme'
import { PresenceDots, ShareDialog, TeammateDots } from '../collab/CollabDialogs'
import { GitSyncRow } from '../gitsync/GitSync'
import { CloseToolDialog, RestoreToolDialog, type CloseChoice, type RestoreChoice } from './ToolDialogs'
import { BACKGROUND_TOOLS, deleteToolContent, hideTool, toolHasContent } from './toolContent'

/** Colours for tools and folders in the sidebar (v0.13); null = none. */
const TOOL_COLORS: (string | null)[] = [null, '#e03131', '#f08c00', '#f5b301', '#2f9e44', '#0c8599', '#1971c2', '#7048e8', '#c2255c']

/** A right-click menu at the pointer that opens upward in the lower half of the window, so it is never cut off (v0.13). */
const menuAt = (x: number, y: number): React.CSSProperties =>
  y > window.innerHeight / 2
    ? { position: 'fixed', left: x, bottom: window.innerHeight - y, maxHeight: y - 8, overflowY: 'auto' }
    : { position: 'fixed', left: x, top: y, maxHeight: window.innerHeight - y - 8, overflowY: 'auto' }

/** Always-visible component sidebar (SB-1..SB-7). */
export function Sidebar() {
  const meta = useProjectStore((s) => s.meta)
  const updateMeta = useProjectStore((s) => s.updateMeta)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [addOpen, setAddOpen] = useState<React.CSSProperties | null>(null)
  const [themeOpen, setThemeOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [dropOn, setDropOn] = useState<string | null>(null)
  const [folderMenu, setFolderMenu] = useState<{ id: Id; x: number; y: number } | null>(null)
  const [docMenu, setDocMenu] = useState<{ id: Id; title: string; x: number; y: number } | null>(null)
  const [moreOpen, setMoreOpen] = useState(() => {
    try {
      return localStorage.getItem('egd.sidebar.more') !== '0'
    } catch {
      return true
    }
  })
  const toggleMore = () => {
    setMoreOpen(!moreOpen)
    try {
      localStorage.setItem('egd.sidebar.more', moreOpen ? '0' : '1')
    } catch {
      // only a convenience
    }
  }
  const [toolMenu, setToolMenu] = useState<{ manifest: ComponentManifest; x: number; y: number } | null>(null)
  const [closing, setClosing] = useState<ComponentManifest | null>(null)
  const [restoring, setRestoring] = useState<ComponentManifest | null>(null)
  usePlugins((s) => s.installed) // re-render when plugin tools come and go
  const askProject = useSettings((s) => s.askProject)
  if (!meta) return null
  const collapsed = meta.sidebarCollapsed
  const favorites = meta.favorites ?? []
  // v0.13: starred tools first, then the rest in the order the user dragged them into.
  const order = [...favorites.filter((t) => meta.enabledComponents.includes(t)), ...meta.enabledComponents.filter((t) => !favorites.includes(t))]
  const q = search.trim().toLowerCase()
  const enabled = order
    .map(getManifest)
    .filter((m): m is ComponentManifest => !!m && shownTool(m.type, askProject))
    .filter((m) => !q || m.name.toLowerCase().includes(q) || meta.documents.some((d) => d.type === m.type && d.title.toLowerCase().includes(q)))
  const toggleFavorite = (type: ComponentType) => updateMeta({ favorites: favorites.includes(type) ? favorites.filter((t) => t !== type) : [...favorites, type] })
  // v0.13: colours and folders.
  const toolColors = meta.toolColors ?? {}
  const folders = meta.folders ?? []
  const setFolders = (next: SidebarFolder[]) => updateMeta({ folders: next })
  const folderOf = (t: ComponentType) => folders.find((f) => f.tools.includes(t))
  const shown = new Set(enabled.map((m) => m.type))
  const topTools = enabled.filter((m) => favorites.includes(m.type))
  const shownFolders = folders
    .map((folder) => ({ folder, tools: folder.tools.filter((t) => shown.has(t) && !favorites.includes(t)).map(getManifest).filter((m): m is ComponentManifest => !!m) }))
    .filter((x) => !q || x.tools.length || x.folder.name.toLowerCase().includes(q))
  const restTools = enabled.filter((m) => !favorites.includes(m.type) && !folderOf(m.type))
  const intoFolder = (t: ComponentType, folderId: Id | null) =>
    updateMeta({ folders: folders.map((f) => ({ ...f, tools: f.id === folderId ? [...f.tools.filter((x) => x !== t), t] : f.tools.filter((x) => x !== t) })), favorites: favorites.filter((x) => x !== t) })
  const newFolder = async (withTool?: ComponentType) => {
    const name = await promptDialog('New folder', 'Folder')
    if (!name?.trim()) return
    const f: SidebarFolder = { id: newId(), name: name.trim(), tools: withTool ? [withTool] : [] }
    updateMeta({ folders: [...folders.map((x) => ({ ...x, tools: x.tools.filter((t) => t !== withTool) })), f], favorites: withTool ? favorites.filter((x) => x !== withTool) : favorites })
  }
  const deleteDocument = async (id: Id, title: string) => {
    const ok = await confirmDialog({ title: 'Delete document?', message: `"${title}" will be deleted permanently.`, confirmLabel: 'Delete', danger: true })
    if (!ok) return
    const open = leaves(useProjectStore.getState().meta?.layout ?? null).find((p) => p.documentId === id)
    if (open) await closePanel(open.id)
    await useProjectStore.getState().removeDocument(id)
  }

  /** Drop tool `from` onto tool `to`: it moves there, and joins `to`'s folder or stars like `to`. */
  const moveTool = (from: ComponentType, to: ComponentType) => {
    if (from === to) return
    const without = (list: ComponentType[]) => list.filter((t) => t !== from)
    const insert = (list: ComponentType[]) => {
      const i = list.indexOf(to)
      return i < 0 ? [...list, from] : [...list.slice(0, i), from, ...list.slice(i)]
    }
    const target = favorites.includes(to) ? null : folderOf(to)
    updateMeta({
      enabledComponents: insert(without(meta.enabledComponents)),
      favorites: favorites.includes(to) ? insert(without(favorites)) : without(favorites),
      folders: folders.map((f) => ({ ...f, tools: f.id === target?.id ? insert(without(f.tools)) : without(f.tools) })),
    })
  }
  const available = allManifests().filter((m) => !meta.enabledComponents.includes(m.type) && shownTool(m.type, askProject))

  /** The Add tool menu opens below the button, or above it when there is little room. */
  const openAdd = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const below = window.innerHeight - r.bottom
    setAddOpen(below > 260 ? { left: r.left + 4, top: r.bottom, maxHeight: below - 8 } : { left: r.left + 4, bottom: window.innerHeight - r.top, maxHeight: r.top - 8 })
  }
  const addTool = async (m: ComponentManifest) => {
    setAddOpen(null)
    if (!BACKGROUND_TOOLS.includes(m.type) && (await toolHasContent(m.type))) setRestoring(m)
    else useProjectStore.getState().enableComponent(m.type)
  }
  const finishRestore = async (choice: RestoreChoice) => {
    const m = restoring
    setRestoring(null)
    if (!m || !choice) return
    if (choice === 'delete') await deleteToolContent(m.type)
    useProjectStore.getState().enableComponent(m.type)
  }
  const closeTool = async (m: ComponentManifest) => {
    setToolMenu(null)
    if (await toolHasContent(m.type)) setClosing(m)
    else await hideTool(m.type)
  }
  const finishClose = async (choice: CloseChoice) => {
    const m = closing
    setClosing(null)
    if (!m || !choice) return
    await hideTool(m.type)
    if (choice === 'delete') await deleteToolContent(m.type)
  }

  const dragProps = (type: ComponentType, documentId: Id | null) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      const payload: DragPayload = { type, documentId }
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload))
      e.dataTransfer.effectAllowed = 'copy'
    },
    onDragEnd: () => setDropOn(null),
  })

  const renderTool = (m: ComponentManifest) => {
          const docs = meta.documents.filter((d) => d.type === m.type && (!q || m.name.toLowerCase().includes(q) || d.title.toLowerCase().includes(q)))
          const isOpen = q ? true : (expanded[m.type] ?? true)
          const fav = favorites.includes(m.type)
          return (
            <div key={m.type}>
              <div
                className={`sidebar-item${dropOn === m.type ? ' drop-target' : ''}`}
                style={toolColors[m.type] ? ({ ['--tool-color' as string]: toolColors[m.type] } as React.CSSProperties) : undefined}
                data-colored={toolColors[m.type] ? '' : undefined}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes(DRAG_MIME)) return
                  e.preventDefault()
                  setDropOn(m.type)
                }}
                onDragLeave={() => setDropOn(null)}
                onDrop={(e) => {
                  setDropOn(null)
                  const raw = e.dataTransfer.getData(DRAG_MIME)
                  if (!raw) return
                  e.preventDefault()
                  moveTool((JSON.parse(raw) as DragPayload).type, m.type)
                }}
              >
                <button
                  className="sidebar-row"
                  title={`${m.name} (Shift-click to open next to the others)`}
                  onClick={(e) => (e.shiftKey ? openComponent(m.type) : void replaceWithComponent(m.type))}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setToolMenu({ manifest: m, x: e.clientX, y: e.clientY })
                  }}
                  {...dragProps(m.type, m.multiDocument ? (docs[0]?.id ?? null) : null)}
                >
                  <m.icon size={16} />
                  {!collapsed && <span>{m.name}</span>}
                  {!collapsed && <TeammateDots at={m.type} wholeType={m.multiDocument && !isOpen} />}
                </button>
                {!collapsed && (
                  <button className={`icon-btn sidebar-star${fav ? ' on' : ''}`} title={fav ? 'Unstar (stays at the top while starred)' : 'Star: keep this tool at the top'} aria-label={fav ? `Unstar ${m.name}` : `Star ${m.name}`} aria-pressed={fav} onClick={() => toggleFavorite(m.type)}>
                    <Star size={13} fill={fav ? 'currentColor' : 'none'} />
                  </button>
                )}
                {!collapsed && m.multiDocument && (
                  <button className="icon-btn" title={isOpen ? 'Collapse' : 'Expand'} onClick={() => setExpanded({ ...expanded, [m.type]: !isOpen })}>
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                )}
              </div>
              {!collapsed && m.multiDocument && isOpen && (
                <div className="sidebar-docs">
                  {docs.map((d) => (
                    <div key={d.id} className="sidebar-item">
                      <button
                        className="sidebar-row sidebar-doc"
                        onClick={(e) => (e.shiftKey ? openComponent(m.type, d.id) : void replaceWithComponent(m.type, d.id))}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          setDocMenu({ id: d.id, title: d.title, x: e.clientX, y: e.clientY })
                        }}
                        title={`${d.title} (right-click to rename or delete, Shift-click to open next to the others)`}
                        {...dragProps(m.type, d.id)}
                      >
                        <span>{d.title}</span>
                        <TeammateDots at={`${m.type}/${d.id}`} />
                      </button>
                      <button
                        className="icon-btn sidebar-doc-delete"
                        title="Delete document"
                        onClick={() => void deleteDocument(d.id, d.title)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                  <button className="sidebar-row sidebar-doc sidebar-new" title="New (Shift-click to open it next to the others)" onClick={(e) => newDocument(m.type, !e.shiftKey)}>
                    <Plus size={13} /> <span>New</span>
                  </button>
                </div>
              )}
            </div>
          )
  }

  return (
    <nav className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label="Components">
      <div className="sidebar-top">
        <button className="sidebar-row" onClick={() => void backToProjects()} title="Back to projects">
          <House size={16} />
          {!collapsed && <span>Projects</span>}
        </button>
        <HotkeyHintSwitch collapsed={collapsed} />
        {!collapsed && <div className="sidebar-project" title={meta.name}>{meta.name}</div>}
        <JumpButtons />
      </div>

      {!collapsed && (
        <label className="sidebar-search">
          <Search size={14} />
          <input
            className="input"
            placeholder="Search tools and documents"
            aria-label="Search tools and documents"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), setSearch(''))}
          />
        </label>
      )}
      <div className="sidebar-list" data-tour="sidebar-list">
        {q && enabled.length === 0 && <div className="sidebar-menu-note">Nothing matches.</div>}
        {topTools.map(renderTool)}
        {shownFolders.map(({ folder: f, tools }) => (
          <div key={f.id} className="sidebar-folder" style={f.color ? ({ ['--tool-color' as string]: f.color } as React.CSSProperties) : undefined}>
            <div
              className={`sidebar-item sidebar-folder-head${dropOn === f.id ? ' drop-target' : ''}`}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_MIME)) return
                e.preventDefault()
                setDropOn(f.id)
              }}
              onDragLeave={() => setDropOn(null)}
              onDrop={(e) => {
                setDropOn(null)
                const raw = e.dataTransfer.getData(DRAG_MIME)
                if (!raw) return
                e.preventDefault()
                intoFolder((JSON.parse(raw) as DragPayload).type, f.id)
              }}
            >
              <button
                className="sidebar-row"
                title={`${f.name} (right-click to rename, colour or remove; drop tools here)`}
                onClick={() => setFolders(folders.map((x) => (x.id === f.id ? { ...x, collapsed: !x.collapsed } : x)))}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setFolderMenu({ id: f.id, x: e.clientX, y: e.clientY })
                }}
              >
                {f.collapsed && !q ? <FolderClosed size={16} /> : <FolderOpen size={16} />}
                {!collapsed && <span>{f.name}</span>}
              </button>
            </div>
            {(!f.collapsed || q) && <div className="sidebar-folder-tools">{tools.map(renderTool)}</div>}
          </div>
        ))}
        {restTools.map(renderTool)}
        <button className="sidebar-row" title="Add tool" data-tour="add-component" onClick={openAdd}>
          <Plus size={16} />
          {!collapsed && <span>Add tool</span>}
        </button>
        {addOpen && (
          <div className="menu-backdrop" onMouseDown={() => setAddOpen(null)}>
            <AddToolMenu style={addOpen} available={available} onAdd={(m) => void addTool(m)} onClose={() => setAddOpen(null)} />
          </div>
        )}
      </div>

      <div className="sidebar-bottom">
        <button className="sidebar-row" title={moreOpen ? 'Show fewer buttons' : 'Show all buttons'} aria-expanded={moreOpen} onClick={toggleMore}>
          {moreOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          {!collapsed && <span>{moreOpen ? 'Show less' : 'Show more'}</span>}
        </button>
        {toolMenu && (
          <div className="menu-backdrop" onMouseDown={() => setToolMenu(null)} onContextMenu={(e) => e.preventDefault()}>
            <div className="menu" style={menuAt(toolMenu.x, toolMenu.y)} onMouseDown={(e) => e.stopPropagation()}>
              <div className="sidebar-menu-label">Colour</div>
              <div className="sidebar-swatches" aria-label="Colour">
                {TOOL_COLORS.map((c) => (
                  <button
                    key={c ?? 'none'}
                    className={`sidebar-swatch${(toolColors[toolMenu.manifest.type] ?? null) === c ? ' on' : ''}`}
                    style={{ background: c ?? 'transparent' }}
                    title={c ? 'Colour' : 'No colour'}
                    aria-label={c ? `Colour ${c}` : 'No colour'}
                    onClick={() => {
                      const next = { ...toolColors }
                      if (c) next[toolMenu.manifest.type] = c
                      else delete next[toolMenu.manifest.type]
                      updateMeta({ toolColors: next })
                      setToolMenu(null)
                    }}
                  />
                ))}
              </div>
              {folders
                .filter((f) => !f.tools.includes(toolMenu.manifest.type))
                .map((f) => (
                  <button key={f.id} onClick={() => (intoFolder(toolMenu.manifest.type, f.id), setToolMenu(null))}>
                    Put in folder “{f.name}”
                  </button>
                ))}
              {folderOf(toolMenu.manifest.type) && <button onClick={() => (intoFolder(toolMenu.manifest.type, null), setToolMenu(null))}>Take out of the folder</button>}
              <button onClick={() => (void newFolder(toolMenu.manifest.type), setToolMenu(null))}>Put in a new folder…</button>
              <button className="danger" onClick={() => void closeTool(toolMenu.manifest)}>
                Close tool
              </button>
            </div>
          </div>
        )}
        {docMenu && (
          <div className="menu-backdrop" onMouseDown={() => setDocMenu(null)} onContextMenu={(e) => e.preventDefault()}>
            <div className="menu" style={menuAt(docMenu.x, docMenu.y)} onMouseDown={(e) => e.stopPropagation()}>
              <button
                onClick={async () => {
                  const d = docMenu
                  setDocMenu(null)
                  const title = await promptDialog('Rename', d.title)
                  if (title?.trim()) useProjectStore.getState().renameDocument(d.id, title.trim())
                }}
              >
                Rename
              </button>
              <button
                className="danger"
                onClick={() => {
                  const d = docMenu
                  setDocMenu(null)
                  void deleteDocument(d.id, d.title)
                }}
              >
                Delete
              </button>
            </div>
          </div>
        )}
        {folderMenu && (
          <div className="menu-backdrop" onMouseDown={() => setFolderMenu(null)} onContextMenu={(e) => e.preventDefault()}>
            <div className="menu" style={menuAt(folderMenu.x, folderMenu.y)} onMouseDown={(e) => e.stopPropagation()}>
              <div className="sidebar-swatches" aria-label="Folder colour">
                {TOOL_COLORS.map((c) => (
                  <button
                    key={c ?? 'none'}
                    className="sidebar-swatch"
                    style={{ background: c ?? 'transparent' }}
                    aria-label={c ? `Colour ${c}` : 'No colour'}
                    onClick={() => (setFolders(folders.map((f) => (f.id === folderMenu.id ? { ...f, color: c } : f))), setFolderMenu(null))}
                  />
                ))}
              </div>
              <button
                onClick={async () => {
                  const f = folders.find((x) => x.id === folderMenu.id)
                  setFolderMenu(null)
                  const name = f && (await promptDialog('Rename folder', f.name))
                  if (f && name?.trim()) setFolders(folders.map((x) => (x.id === f.id ? { ...x, name: name.trim() } : x)))
                }}
              >
                Rename
              </button>
              <button className="danger" onClick={() => (setFolders(folders.filter((f) => f.id !== folderMenu.id)), setFolderMenu(null))}>
                Remove folder (the tools stay)
              </button>
            </div>
          </div>
        )}
        <button className="sidebar-row" title="Work together" data-tour="share" onClick={() => setShareOpen(true)}>
          <Users size={16} />
          {!collapsed && <span>Work together</span>}
          {!collapsed && <PresenceDots />}
        </button>
        {shareOpen && <ShareDialog onClose={() => setShareOpen(false)} />}
        <GitSyncRow collapsed={collapsed} />
        {closing && <CloseToolDialog manifest={closing} onDone={(c) => void finishClose(c)} />}
        {restoring && <RestoreToolDialog manifest={restoring} onDone={(c) => void finishRestore(c)} />}
        {moreOpen && (
          <>
            <button className="sidebar-row" title="Project look" data-tour="project-look" onClick={() => setThemeOpen(true)}>
              <Palette size={16} />
              {!collapsed && <span>Project look</span>}
            </button>
            {themeOpen && <ProjectThemeDialog onClose={() => setThemeOpen(false)} />}
            <button className="sidebar-row" title="Rarities: colors, borders, icons and ratings" onClick={openRarities}>
              <Gem size={16} />
              {!collapsed && <span>Rarities</span>}
            </button>
            <button className="sidebar-row" title="Design Book: export your game design document" onClick={openDesignBook}>
              <BookOpen size={16} />
              {!collapsed && <span>Design Book</span>}
            </button>
            <button className="sidebar-row" title="Export your data to Godot, Unity or Unreal" onClick={() => useEngineExport.setState({ open: true })}>
              <Boxes size={16} />
              {!collapsed && <span>Engine export</span>}
            </button>
            <button className="sidebar-row" title="Settings" onClick={openSettings}>
              <Settings size={16} />
              {!collapsed && <span>Settings</span>}
            </button>
          </>
        )}
        <button className="sidebar-row" title="Help" data-tour="help" onClick={() => useHelp.getState().openReport()}>
          <CircleHelp size={16} />
          {!collapsed && <span>Help</span>}
        </button>
        <button
          className="sidebar-row"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => updateMeta({ sidebarCollapsed: !collapsed })}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </nav>
  )
}


/** Back and forward through jumps between entries and tools (Alt+Left / Alt+Right). */
function JumpButtons() {
  const canBack = useJumpHistory((h) => h.back.length > 0)
  const canForward = useJumpHistory((h) => h.forward.length > 0)
  return (
    <div className="sidebar-jump">
      <button className="icon-btn" title="Back (Alt+Left)" aria-label="Back" disabled={!canBack} onClick={jumpBack}>
        <ArrowLeft size={15} />
      </button>
      <button className="icon-btn" title="Forward (Alt+Right)" aria-label="Forward" disabled={!canForward} onClick={jumpForward}>
        <ArrowRight size={15} />
      </button>
    </div>
  )
}

/** The Add tool menu, with a search field: type to filter by name or description, Enter adds the first match. */
function AddToolMenu({ style, available, onAdd, onClose }: { style: React.CSSProperties; available: ComponentManifest[]; onAdd(m: ComponentManifest): void; onClose(): void }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = q ? available.filter((m) => `${m.name} ${m.description}`.toLowerCase().includes(q)) : available
  return (
    <div className="menu sidebar-add-menu" style={{ position: 'fixed', overflowY: 'auto', ...style }} onMouseDown={(e) => e.stopPropagation()}>
      {available.length > 0 && (
        <input
          className="input sidebar-add-search"
          placeholder="Search tools…"
          aria-label="Search tools"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && shown[0]) onAdd(shown[0])
            else if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            }
          }}
        />
      )}
      {shown.map((m) => (
        <button key={m.type} title={m.description} onClick={() => onAdd(m)}>
          {m.name}
        </button>
      ))}
      {available.length === 0 && <div className="sidebar-menu-note">Every tool is already added.</div>}
      {available.length > 0 && shown.length === 0 && <div className="sidebar-menu-note">No tool matches.</div>}
    </div>
  )
}

/** v0.20: Hotkey hint mode on / off; while on, every button with a key shows it in its corner. */
function HotkeyHintSwitch({ collapsed }: { collapsed: boolean }) {
  const on = useSettings((s) => s.hotkeyHints)
  const label = 'Hotkey hint mode'
  return (
    <button className={`sidebar-row sidebar-hint-switch${on ? ' on' : ''}`} role="switch" aria-checked={on} title={`${label}: show each button's key on it`} onClick={() => useSettings.getState().update({ hotkeyHints: !on })}>
      <Keyboard size={16} />
      {!collapsed && (
        <>
          <span>{label}</span>
          <span className="sidebar-switch" aria-hidden />
        </>
      )}
    </button>
  )
}
