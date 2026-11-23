import { CircleHelp, FileArchive, FolderOpen, FolderPlus, GitBranch, Image, Maximize2, Minimize2, MoreHorizontal, Moon, Plus, Redo2, Search, Settings, Sun, Type, Undo2, Users } from 'lucide-react'
import { getVersion } from '@tauri-apps/api/app'
import { useCallback, useEffect, useState } from 'react'
import { saveBinaryFile, safeFileName } from '@/core/export'
import { getFs, isTauri } from '@/core/fs'
import { cloneProject, connectGitHub, listProjectRepos, repoNameFor, projectGitState, syncProjectFromGit, syncProjectToGit, useGitSync, type GitHubRepo, type ProjectGitState } from '@/core/gitsync'
import { assetUrl, pickAndImportAssets } from '@/core/assets'
import { newId, type RecentProject } from '@/core/model'
import { deleteProject, importProjectZip, isProjectFolder, loadProject, readRecents, removeRecent, saveMeta, upsertRecent, zipProject } from '@/core/project'
import { useAppStore, useProjectStore, useSettings, type HomeSection, type ProjectFolder, type SectionHeight, type SectionWidth } from '@/core/state'
import { confirmDialog, promptDialog } from '@/shared/dialogs'
import { Modal } from '@/shared/ui'
import { maybeStartTour, useHelp } from '../help/help'
import { toggleTheme, useTheme } from '../theme'
import { openSettings } from '../settings/open'
import { BackupsDialog } from './BackupsDialog'
import { UpdateCard } from '../updates/UpdateCard'
import { GpuCard } from '../updates/GpuCard'
import { homeLayout, moveSection, moveToFolder, WIDTH_COLUMNS } from './folders'
import { JoinDialog } from '../collab/CollabDialogs'
import './launcher.css'

/** Drag type for a project card dragged onto a start-screen folder (0.21). */
const PROJECT_DRAG = 'application/x-egd-project'
/** Drag type for a section dragged by its title onto another section, to move it there. */
const SECTION_DRAG = 'application/x-egd-section'
/** How many cards the Recent projects section shows. */
const RECENT_COUNT = 12

/** Start screen layout changes are undoable (Ctrl+Z / Ctrl+Shift+Z) while the start screen is open. */
type Layout = { projectFolders: ProjectFolder[]; homeSections: HomeSection[] }
const past: Layout[] = []
const future: Layout[] = []
const snapshot = (): Layout => {
  const s = useSettings.getState()
  return { projectFolders: s.projectFolders, homeSections: s.homeSections }
}
function changeLayout(patch: Partial<Layout>) {
  past.push(snapshot())
  if (past.length > 100) past.shift()
  future.length = 0
  useSettings.getState().update(patch)
}
function undoLayout(redo = false) {
  const from = redo ? future : past
  const step = from.pop()
  if (!step) return
  ;(redo ? past : future).push(snapshot())
  useSettings.getState().update(step)
}
const setFolders = (projectFolders: ProjectFolder[]) => changeLayout({ projectFolders })
const setSections = (homeSections: HomeSection[]) => changeLayout({ homeSections })

async function newFolder(path?: string) {
  const name = (await promptDialog('New section', ''))?.trim()
  if (!name) return
  const id = newId()
  const folders = [...useSettings.getState().projectFolders, { id, name, open: true, paths: [] }]
  setFolders(path ? moveToFolder(folders, path, id) : folders)
}

/** Project list shown on startup (spec 4, PM-1..PM-8). */
export function Launcher() {
  const [projects, setProjects] = useState<RecentProject[] | null>(null)
  const [missing, setMissing] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState('')
  // No window title bar on some Linux setups, so the start screen shows the version itself.
  useEffect(() => {
    if (isTauri()) getVersion().then(setVersion, () => {})
  }, [])
  const [joinOpen, setJoinOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  /** "Import from GitHub": the person's project repositories to pick from (0.20). */
  const [repos, setRepos] = useState<GitHubRepo[] | null>(null)
  const theme = useTheme()
  const folders = useSettings((s) => s.projectFolders)
  const sections = homeLayout(folders, useSettings((s) => s.homeSections))
  /** The section opened to fill the screen with its expand button, if any. */
  const [expanded, setExpanded] = useState<string | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return
      if (e.key === 'Escape') setExpanded(null)
      const mod = e.ctrlKey || e.metaKey
      if (!mod || !'zy'.includes(e.key.toLowerCase())) return
      e.preventDefault()
      undoLayout(e.shiftKey || e.key.toLowerCase() === 'y')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const refresh = useCallback(async () => {
    const list = await readRecents()
    const gone = new Set<string>()
    for (const p of list) if (!(await isProjectFolder(p.path))) gone.add(p.path)
    setMissing(gone)
    setProjects(list)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])
  useEffect(() => {
    maybeStartTour('launcher')
  }, [])

  const open = async (path: string) => {
    try {
      setError(null)
      await useProjectStore.getState().open(path)
      useAppStore.getState().go('editor')
    } catch (e) {
      setError(`Could not open project: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const openExisting = async () => {
    const path = await getFs().pickFolder('Open a project folder')
    if (!path) return
    if (!(await isProjectFolder(path))) {
      setError('That folder is not an Eve.Lopment Games Designer project (no project.json).')
      return
    }
    await open(path)
  }

  const openFromGit = async () => {
    // 0.21: Git on this computer is usually logged in to GitHub already, so connect first instead of asking for an address.
    if (!useSettings.getState().githubLogin) {
      setBusy('Connecting GitHub…')
      const ok = await connectGitHub()
      setBusy(null)
      if (!ok) return cloneFrom((await promptDialog('Import from Git: repository address', ''))?.trim())
    }
    try {
      setError(null)
      setBusy('Looking up your projects on GitHub…')
      setRepos(await listProjectRepos())
    } catch (e) {
      setError(`Could not list your GitHub projects: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  /** Put downloaded project folders on the start screen. */
  const addRecents = async (roots: string[]) => {
    for (const path of roots) {
      const { meta } = await loadProject(path)
      await upsertRecent({ path, name: meta.name, description: meta.description, image: meta.image ?? null, lastOpened: new Date().toISOString(), stats: { words: 0, images: 0 } })
    }
    await refresh()
  }

  const cloneFrom = async (url: string | undefined) => {
    setRepos(null)
    if (!url) return
    try {
      setError(null)
      setBusy('Downloading the project from Git…')
      const roots = await cloneProject(url)
      if (roots.length === 1) return void (await open(roots[0]))
      // A repository with several projects: put them all on the start screen.
      await addRecents(roots)
    } catch (e) {
      setError(`Could not open from Git: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  /** GitHub projects that are not on this computer yet (the start screen has no project with that repository name). */
  const onGitHubOnly = (list: GitHubRepo[]) => list.filter((r) => !projects?.some((p) => repoNameFor(p.name) === r.name))

  /** 0.21: download every GitHub project that is not here yet, onto the start screen. */
  const importAll = async (list: GitHubRepo[]) => {
    setRepos(null)
    const failed: string[] = []
    for (const [i, r] of list.entries()) {
      setBusy(`Downloading ${r.name} (${i + 1} of ${list.length})…`)
      try {
        await addRecents(await cloneProject(r.cloneUrl))
      } catch (e) {
        failed.push(`${r.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    setBusy(null)
    setError(failed.length ? `Could not download ${failed.length} of ${list.length}:\n${failed.join('\n')}` : null)
  }

  const importZip = async () => {
    const [file] = await getFs().pickFiles('Import a project zip', ['zip'])
    if (!file) return
    try {
      setError(null)
      await open(await importProjectZip(await getFs().readBinary(file)))
    } catch (e) {
      setError(`Could not import project: ${(e as Error).message}`)
    }
  }

  // v0.20: the search box filters the cards by name and description.
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = projects?.filter((p) => words.every((w) => `${p.name} ${p.description}`.toLowerCase().includes(w)))

  const card = (p: RecentProject) => (
    <ProjectCard key={p.path} project={p} missing={missing.has(p.path)} onOpen={() => void open(p.path)} onChanged={refresh} onError={setError} gitBusy={!!busy} />
  )

  return (
    <div className="launcher">
      <header className="launcher-header">
        <div className="launcher-head-left">
          <div className="launcher-brand">
            <img src="/favicon.png" alt="" className="launcher-logo" />
            <h1>
              Eve.Lopment Games Designer {version && <span className="launcher-version muted">v{version}</span>}
            </h1>
          </div>
          {!!projects?.length && (
            <div className="launcher-tools">
              <button className="icon-btn launcher-add" title="Add a section (for example Games, YouTube videos or Writing)" onClick={() => void newFolder()}>
                <FolderPlus size={17} />
              </button>
              <label className="launcher-search">
                <Search size={15} />
                <input className="input" type="search" placeholder="Search your projects" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), setQuery(''))} />
              </label>
              <button className="icon-btn" title="Undo the last start screen change (Ctrl+Z)" disabled={!past.length} onClick={() => undoLayout()}>
                <Undo2 size={16} />
              </button>
              <button className="icon-btn" title="Redo (Ctrl+Shift+Z)" disabled={!future.length} onClick={() => undoLayout(true)}>
                <Redo2 size={16} />
              </button>
            </div>
          )}
        </div>
        <div className="launcher-actions">
          <button className="icon-btn" title="Help" data-tour="help" onClick={() => useHelp.getState().openReport()}>
            <CircleHelp size={16} />
          </button>
          <button className="icon-btn" title="Settings" onClick={openSettings}>
            <Settings size={16} />
          </button>
          <button className="icon-btn" title="Toggle light/dark theme" data-tour="theme-toggle" onClick={toggleTheme}>
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button className="btn" data-tour="join-project" onClick={() => setJoinOpen(true)}>
            <Users size={16} /> Join project
          </button>
          <button className="btn" data-tour="open-folder" onClick={() => void openExisting()}>
            <FolderOpen size={16} /> Open existing folder
          </button>
          {isTauri() && (
            <button className="btn" title="Download a project from GitHub (or any Git repository) as a new project and keep it synced (one person only)" onClick={() => void openFromGit()}>
              <GitBranch size={16} /> Import from Git
            </button>
          )}
          <button className="btn" onClick={() => void importZip()}>
            <FileArchive size={16} /> Import zip
          </button>
          <button className="btn btn-primary" data-tour="new-project" onClick={() => useAppStore.getState().go('new-project')}>
            <Plus size={16} /> New Project
          </button>
        </div>
      </header>

      <UpdateCard />
      <GpuCard />
      {error && <div className="launcher-error">{error}</div>}
      {busy && <div className="muted launcher-busy">{busy}</div>}
      {repos && (
        <Modal onClose={() => setRepos(null)}>
          <div className="gitsync-dialog">
            <h3>Import from GitHub</h3>
            {repos.length === 0 && <p className="muted">No project repositories (egd-…) on GitHub yet.</p>}
            <div className="gitsync-choices">
              {onGitHubOnly(repos).length > 1 && (
                <button className="btn btn-primary" onClick={() => void importAll(onGitHubOnly(repos))}>
                  Import all {onGitHubOnly(repos).length} projects that are not on this computer yet
                </button>
              )}
              {repos.map((r) => (
                <button key={r.name} className="btn" onClick={() => void cloneFrom(r.cloneUrl)}>
                  {r.name} <span className="muted gitsync-small">{onGitHubOnly([r]).length ? new Date(r.updatedAt).toLocaleDateString() : 'already on this computer'}</span>
                </button>
              ))}
              <button className="btn btn-ghost" onClick={() => void promptDialog('Import from Git: repository address', '').then((u) => cloneFrom(u?.trim()))}>
                Another repository address…
              </button>
            </div>
          </div>
        </Modal>
      )}
      {joinOpen && (
        <JoinDialog
          onClose={() => setJoinOpen(false)}
          onJoined={(root) => {
            setJoinOpen(false)
            void open(root)
          }}
        />
      )}

      {projects && projects.length === 0 && (
        <div className="launcher-empty">
          <h2>No projects yet</h2>
          <p className="muted">Create your first game project to get started.</p>
          <button className="btn btn-primary" onClick={() => useAppStore.getState().go('new-project')}>
            <Plus size={16} /> New Project
          </button>
        </div>
      )}

      {!!projects?.length && shown?.length === 0 && <p className="muted">No project matches "{query}".</p>}

      {words.length ? (
        <div className="project-grid">{shown?.map(card)}</div>
      ) : (
        !!projects?.length && (
          <div className={`home-grid${expanded ? ' expanded' : ''}`}>
            {sections
              .filter((sec) => !expanded || sec.id === expanded)
              .map((sec) => {
                const folder = folders.find((f) => f.id === sec.id)
                const list =
                  sec.id === 'recent' ? projects.slice(0, RECENT_COUNT) : sec.id === 'rest' ? projects.filter((p) => !folders.some((f) => f.paths.includes(p.path))) : projects.filter((p) => folder!.paths.includes(p.path))
                if (sec.id === 'rest' && !list.length) return null
                const title = folder?.name ?? (sec.id === 'recent' ? 'Recent projects' : folders.length ? 'Not in a section' : 'All projects')
                return (
                  <FolderSection key={sec.id} section={sec} sections={sections} title={title} folder={folder} folders={folders} expanded={expanded === sec.id} onExpand={(on) => setExpanded(on ? sec.id : null)}>
                    {list.map(card)}
                  </FolderSection>
                )
              })}
          </div>
        )
      )}
    </div>
  )
}

const WIDTHS: [SectionWidth, string][] = [
  ['narrow', 'Narrow'],
  ['medium', 'Medium'],
  ['wide', 'Wide'],
  ['half', 'Half'],
  ['full', 'Full width'],
]
const HEIGHTS: [SectionHeight, string][] = [
  ['short', 'Short'],
  ['tall', 'Tall'],
]

/**
 * A start screen section: a box with a light edge. A folder section ("Games", "YouTube videos") holds the projects put
 * into it; Recent projects and "Not in a section" are built in. Every section can be resized and moved, and opened to
 * fill the screen with the expand button in its corner. Two short sections next to a tall one stack on top of each other.
 */
function FolderSection({
  section,
  sections,
  title,
  folder,
  folders,
  expanded,
  onExpand,
  children,
}: {
  section: HomeSection
  sections: HomeSection[]
  title: string
  folder?: ProjectFolder
  folders: ProjectFolder[]
  expanded: boolean
  onExpand: (on: boolean) => void
  children: React.ReactNode[]
}) {
  const [over, setOver] = useState<'project' | 'section' | null>(null)
  const [menu, setMenu] = useState(false)
  const at = sections.findIndex((s) => s.id === section.id)
  const resize = (patch: Partial<HomeSection>) => setSections(sections.map((s) => (s.id === section.id ? { ...s, ...patch } : s)))
  const move = (by: number) => {
    setMenu(false)
    setSections(moveSection(sections, section.id, by < 0 ? sections[at - 1].id : (sections[at + 2]?.id ?? null)))
  }
  const rename = async () => {
    setMenu(false)
    const name = (await promptDialog('Rename section', folder!.name))?.trim()
    if (name) setFolders(folders.map((f) => (f.id === folder!.id ? { ...f, name } : f)))
  }
  const remove = async () => {
    setMenu(false)
    const ok = await confirmDialog({ title: `Delete the section "${folder!.name}"?`, message: 'Only the section goes away. Its projects stay and move to "Not in a section". You can undo this with Ctrl+Z.', confirmLabel: 'Delete section' })
    if (ok) setFolders(folders.filter((f) => f.id !== folder!.id))
  }
  return (
    <section
      className={`home-section${over ? ` drop-${over}` : ''}${expanded ? ' expanded' : ''}`}
      style={{ '--w': WIDTH_COLUMNS[section.width], '--h': section.height === 'tall' ? 2 : 1 } as React.CSSProperties}
      onDragOver={(e) => {
        const kind = e.dataTransfer.types.includes(SECTION_DRAG) ? 'section' : e.dataTransfer.types.includes(PROJECT_DRAG) && section.id !== 'recent' ? 'project' : null
        if (!kind) return
        e.preventDefault()
        setOver(kind)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(null)}
      onDrop={(e) => {
        setOver(null)
        const moved = e.dataTransfer.getData(SECTION_DRAG)
        if (moved) return setSections(moveSection(sections, moved, section.id))
        const path = e.dataTransfer.getData(PROJECT_DRAG)
        if (path && section.id !== 'recent') setFolders(moveToFolder(folders, path, folder?.id ?? null))
      }}
    >
      <h2 className="home-section-title" draggable={!expanded} title="Drag onto another section to move it there" onDragStart={(e) => e.dataTransfer.setData(SECTION_DRAG, section.id)}>
        <span className="home-section-name">{title}</span>
        <span className="muted launcher-section-count">{children.length}</span>
        <button className="icon-btn home-section-menu-btn" title="Section menu: size, move, rename" onClick={() => setMenu(!menu)}>
          <MoreHorizontal size={16} />
        </button>
        {menu && (
          <div className="menu home-section-menu" onMouseLeave={() => setMenu(false)}>
            <div className="home-size-label muted">Width</div>
            <div className="home-size-row">
              {WIDTHS.map(([w, label]) => (
                <button key={w} className={`template-chip${section.width === w ? ' on' : ''}`} onClick={() => resize({ width: w })}>
                  {label}
                </button>
              ))}
            </div>
            <div className="home-size-label muted">Height</div>
            <div className="home-size-row">
              {HEIGHTS.map(([h, label]) => (
                <button key={h} className={`template-chip${section.height === h ? ' on' : ''}`} onClick={() => resize({ height: h })}>
                  {label}
                </button>
              ))}
            </div>
            <button disabled={at === 0} onClick={() => move(-1)}>
              Move earlier
            </button>
            <button disabled={at === sections.length - 1} onClick={() => move(1)}>
              Move later
            </button>
            {folder && <button onClick={() => void rename()}>Rename</button>}
            {folder && (
              <button className="danger" onClick={() => void remove()}>
                Delete section
              </button>
            )}
          </div>
        )}
      </h2>
      <div className="home-section-body">
        {children.length ? <div className="project-grid">{children}</div> : <p className="muted launcher-section-empty">{section.id === 'recent' ? 'Projects you open show up here.' : 'Drag a project here, or use Move to … in its menu.'}</p>}
      </div>
      <button className="icon-btn home-expand" title={expanded ? 'Back to all sections (Esc)' : 'Expand this section to fill the screen'} onClick={() => onExpand(!expanded)}>
        {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>
    </section>
  )
}

function ProjectCard({
  project,
  missing,
  onOpen,
  onChanged,
  onError,
  gitBusy,
}: {
  project: RecentProject
  missing: boolean
  onOpen: () => void
  onChanged: () => void
  onError: (message: string) => void
  gitBusy: boolean
}) {
  const [menu, setMenu] = useState(false)
  // 0.20: whether the project is saved to Git, shown as a marker on the card.
  const [git, setGit] = useState<ProjectGitState | null>(null)
  const gitRunning = !!useGitSync((s) => s.busy) || gitBusy
  useEffect(() => {
    let live = true
    if (isTauri() && !missing && !gitRunning) void projectGitState(project.path).then((g) => live && setGit(g), () => {})
    return () => {
      live = false
    }
  }, [project.path, missing, gitRunning])
  const gitAction = async (job: () => Promise<boolean>) => {
    setMenu(false)
    if (!(await job())) onError(useGitSync.getState().error ?? 'Git sync failed.')
    onChanged()
  }
  const [showBackups, setShowBackups] = useState(false)
  const folders = useSettings((s) => s.projectFolders)
  const inFolder = folders.find((f) => f.paths.includes(project.path))

  const editMeta = async (field: 'name' | 'description') => {
    const value = await promptDialog(field === 'name' ? 'Rename project' : 'Edit description', project[field])
    if (value === null || (field === 'name' && !value.trim())) return
    const loaded = await loadProject(project.path)
    const meta = { ...loaded.meta, [field]: value.trim() }
    await saveMeta(project.path, meta)
    await upsertRecent({ ...project, name: meta.name, description: meta.description })
    onChanged()
  }

  /** v0.13: an optional picture on the project's card. */
  const setImage = async (pick: boolean) => {
    setMenu(false)
    const [asset] = pick ? await pickAndImportAssets(project.path, 'image', 'Picture for the project') : []
    if (pick && !asset) return
    const loaded = await loadProject(project.path)
    await saveMeta(project.path, { ...loaded.meta, image: asset?.path ?? null })
    await upsertRecent({ ...project, image: asset?.path ?? null })
    onChanged()
  }
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    if (project.image) void assetUrl(project.path, project.image).then((u) => live && setImageUrl(u))
    return () => {
      live = false
    }
  }, [project.path, project.image])

  const exportZip = async () => {
    setMenu(false)
    try {
      const bytes = await zipProject(project.path)
      await saveBinaryFile({ title: 'Export project', defaultName: `${safeFileName(project.name)}.zip`, bytes, filter: { name: 'Zip', extensions: ['zip'] } })
    } catch (e) {
      onError(`Could not export project: ${(e as Error).message}`)
    }
  }

  const remove = async () => {
    const ok = await confirmDialog({
      title: `Delete "${project.name}"?`,
      message: `This permanently deletes the project folder and everything in it:\n${project.path}`,
      confirmLabel: 'Delete project',
      danger: true,
    })
    if (!ok) return
    await deleteProject(project.path)
    await removeRecent(project.path)
    onChanged()
  }

  return (
    <div className={`project-card${missing ? ' missing' : ''}`} draggable onDragStart={(e) => e.dataTransfer.setData(PROJECT_DRAG, project.path)}>
      <button className="project-card-main" onClick={onOpen} disabled={missing}>
        {project.image && imageUrl && <img className="project-card-image" src={imageUrl} alt="" />}
        <h3>
          {git && (
            <span className={`project-git project-git-${git.state}`} title={git.detail} aria-label={git.detail}>
              <GitBranch size={13} />
              {git.state === 'public' && <span className="project-git-badge">Public</span>}
            </span>
          )}
          {project.name}
        </h3>
        {project.description && <p className="muted">{project.description}</p>}
        <div className="project-stats">
          {missing ? (
            <span>Folder not found</span>
          ) : (
            <>
              <span title="Words">
                <Type size={13} /> {project.stats.words.toLocaleString()} words
              </span>
              <span title="Images">
                <Image size={13} /> {project.stats.images.toLocaleString()} images
              </span>
            </>
          )}
        </div>
      </button>
      <button className="icon-btn project-card-menu" title="Project menu" onClick={() => setMenu(!menu)}>
        <MoreHorizontal size={16} />
      </button>
      {menu && (
        <div className="menu" style={{ top: 40, right: 8 }} onMouseLeave={() => setMenu(false)}>
          {missing ? (
            <button
              onClick={async () => {
                await removeRecent(project.path)
                onChanged()
              }}
            >
              Remove from list
            </button>
          ) : (
            <>
              <button onClick={() => void editMeta('name')}>Rename</button>
              <button onClick={() => void editMeta('description')}>Edit description</button>
              <button onClick={() => void setImage(true)}>{project.image ? 'Change picture…' : 'Add a picture…'}</button>
              {project.image && <button onClick={() => void setImage(false)}>Remove picture</button>}
              {folders
                .filter((f) => f.id !== inFolder?.id)
                .map((f) => (
                  <button key={f.id} onClick={() => (setMenu(false), setFolders(moveToFolder(folders, project.path, f.id)))}>
                    Move to {f.name}
                  </button>
                ))}
              {inFolder && <button onClick={() => (setMenu(false), setFolders(moveToFolder(folders, project.path, null)))}>Take out of {inFolder.name}</button>}
              <button onClick={() => (setMenu(false), void newFolder(project.path))}>Move to a new section…</button>
              <button onClick={() => void getFs().revealInFolder(project.path)}>Show in folder</button>
              <button onClick={() => void exportZip()}>Export as zip…</button>
              {isTauri() && (
                <button disabled={gitRunning} onClick={() => void gitAction(() => syncProjectToGit(project.path, project.name))}>
                  Sync to Git
                </button>
              )}
              {git && git.state !== 'off' && (
                <button disabled={gitRunning} onClick={() => void gitAction(() => syncProjectFromGit(project.path))}>
                  Sync from Git
                </button>
              )}
              <button
                onClick={() => {
                  setMenu(false)
                  setShowBackups(true)
                }}
              >
                Restore a backup…
              </button>
              <button className="danger" onClick={() => void remove()}>
                Delete
              </button>
            </>
          )}
        </div>
      )}
      {showBackups && <BackupsDialog project={project} onClose={() => setShowBackups(false)} onRestored={onChanged} />}
    </div>
  )
}
