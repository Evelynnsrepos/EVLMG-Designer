import { ArrowLeft, ArrowRight, BookOpen, Boxes, ChevronDown, ChevronRight, CircleHelp, House, PanelLeftClose, PanelLeftOpen, Palette, Plus, Gem, Settings, Trash2, Users } from 'lucide-react'
import { useState } from 'react'
import type { ComponentType, Id } from '@/core/model'
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
import { CloseToolDialog, RestoreToolDialog, type CloseChoice, type RestoreChoice } from './ToolDialogs'
import { BACKGROUND_TOOLS, deleteToolContent, hideTool, toolHasContent } from './toolContent'

/** Always-visible component sidebar (SB-1..SB-7). */
export function Sidebar() {
  const meta = useProjectStore((s) => s.meta)
  const updateMeta = useProjectStore((s) => s.updateMeta)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [addOpen, setAddOpen] = useState<React.CSSProperties | null>(null)
  const [themeOpen, setThemeOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
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
  const enabled = meta.enabledComponents.map(getManifest).filter((m): m is ComponentManifest => !!m && shownTool(m.type, askProject))
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
  })

  return (
    <nav className={`sidebar${collapsed ? ' collapsed' : ''}`} aria-label="Components">
      <div className="sidebar-top">
        <button className="sidebar-row" onClick={() => void backToProjects()} title="Back to projects">
          <House size={16} />
          {!collapsed && <span>Projects</span>}
        </button>
        {!collapsed && <div className="sidebar-project" title={meta.name}>{meta.name}</div>}
        <JumpButtons />
      </div>

      <div className="sidebar-list" data-tour="sidebar-list">
        {enabled.map((m) => {
          const docs = meta.documents.filter((d) => d.type === m.type)
          const isOpen = expanded[m.type] ?? true
          return (
            <div key={m.type}>
              <div className="sidebar-item">
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
                        onContextMenu={async (e) => {
                          // v0.13: right-click renames (a double-click used to, but it also opened the document twice).
                          e.preventDefault()
                          const title = await promptDialog('Rename', d.title)
                          if (title?.trim()) useProjectStore.getState().renameDocument(d.id, title.trim())
                        }}
                        title={`${d.title} (right-click to rename, Shift-click to open next to the others)`}
                        {...dragProps(m.type, d.id)}
                      >
                        <span>{d.title}</span>
                        <TeammateDots at={`${m.type}/${d.id}`} />
                      </button>
                      <button
                        className="icon-btn sidebar-doc-delete"
                        title="Delete document"
                        onClick={async () => {
                          const ok = await confirmDialog({
                            title: 'Delete document?',
                            message: `"${d.title}" will be deleted permanently.`,
                            confirmLabel: 'Delete',
                            danger: true,
                          })
                          if (!ok) return
                          const open = leaves(useProjectStore.getState().meta?.layout ?? null).find((p) => p.documentId === d.id)
                          if (open) await closePanel(open.id)
                          await useProjectStore.getState().removeDocument(d.id)
                        }}
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
        })}
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
            <div className="menu" style={{ position: 'fixed', left: toolMenu.x, top: toolMenu.y }} onMouseDown={(e) => e.stopPropagation()}>
              <button className="danger" onClick={() => void closeTool(toolMenu.manifest)}>
                Close tool
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
