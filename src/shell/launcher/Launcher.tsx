import { ChevronDown, ChevronRight, CircleHelp, FileArchive, FolderOpen, FolderPlus, GitBranch, Image, MoreHorizontal, Moon, Plus, Search, Settings, Sun, Type, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { saveBinaryFile, safeFileName } from '@/core/export'
import { getFs, isTauri } from '@/core/fs'
import { cloneProject, listProjectRepos, projectGitState, syncProjectFromGit, syncProjectToGit, useGitSync, type GitHubRepo, type ProjectGitState } from '@/core/gitsync'
import { assetUrl, pickAndImportAssets } from '@/core/assets'
import { newId, type RecentProject } from '@/core/model'
import { deleteProject, importProjectZip, isProjectFolder, loadProject, readRecents, removeRecent, saveMeta, upsertRecent, zipProject } from '@/core/project'
import { useAppStore, useProjectStore, useSettings, type ProjectFolder } from '@/core/state'
import { confirmDialog, promptDialog } from '@/shared/dialogs'
import { Modal } from '@/shared/ui'
import { maybeStartTour, useHelp } from '../help/help'
import { toggleTheme, useTheme } from '../theme'
import { openSettings } from '../settings/open'
import { BackupsDialog } from './BackupsDialog'
import { moveToFolder } from './folders'
import { JoinDialog } from '../collab/CollabDialogs'
import './launcher.css'

/** Drag type for a project card dragged onto a start-screen folder (0.21). */
const PROJECT_DRAG = 'application/x-egd-project'
/** How many cards the Recent projects row shows. */
const RECENT_COUNT = 6

const setFolders = (projectFolders: ProjectFolder[]) => useSettings.getState().update({ projectFolders })

async function newFolder(path?: string) {
  const name = (await promptDialog('New folder', ''))?.trim()
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
  const [joinOpen, setJoinOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  /** "Import from GitHub": the person's project repositories to pick from (0.20). */
  const [repos, setRepos] = useState<GitHubRepo[] | null>(null)
  const theme = useTheme()
  const folders = useSettings((s) => s.projectFolders)

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
    if (!useSettings.getState().githubLogin) return cloneFrom((await promptDialog('Import from Git: repository address', ''))?.trim())
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

  const cloneFrom = async (url: string | undefined) => {
    setRepos(null)
    if (!url) return
    try {
      setError(null)
      setBusy('Downloading the project from Git…')
      const roots = await cloneProject(url)
      if (roots.length === 1) return void (await open(roots[0]))
      // A repository with several projects: put them all on the start screen.
      for (const path of roots) {
        const { meta } = await loadProject(path)
        await upsertRecent({ path, name: meta.name, description: meta.description, image: meta.image ?? null, lastOpened: new Date().toISOString(), stats: { words: 0, images: 0 } })
      }
      await refresh()
    } catch (e) {
      setError(`Could not open from Git: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
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
        <div className="launcher-brand">
          <img src="/favicon.png" alt="" className="launcher-logo" />
          <div>
            <h1>Eve.Lopment Games Designer</h1>
            <div className="muted">Your game projects</div>
          </div>
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

      {error && <div className="launcher-error">{error}</div>}
      {busy && <div className="muted launcher-busy">{busy}</div>}
      {repos && (
        <Modal onClose={() => setRepos(null)}>
          <div className="gitsync-dialog">
            <h3>Import from GitHub</h3>
            {repos.length === 0 && <p className="muted">No project repositories (egd-…) on GitHub yet.</p>}
            <div className="gitsync-choices">
              {repos.map((r) => (
                <button key={r.name} className="btn" onClick={() => void cloneFrom(r.cloneUrl)}>
                  {r.name} <span className="muted gitsync-small">{new Date(r.updatedAt).toLocaleDateString()}</span>
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

      {!!projects?.length && (
        <div className="launcher-tools">
          <label className="launcher-search">
            <Search size={15} />
            <input className="input" type="search" placeholder="Search your projects" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), setQuery(''))} />
          </label>
          <button className="btn" onClick={() => void newFolder()}>
            <FolderPlus size={16} /> New folder
          </button>
          {folders.length > 0 && (
            <button className="btn btn-ghost" onClick={() => setFolders(folders.map((f) => ({ ...f, open: !folders.every((g) => g.open) })))}>
              {folders.every((f) => f.open) ? 'Collapse all folders' : 'Expand all folders'}
            </button>
          )}
        </div>
      )}
      {!!projects?.length && shown?.length === 0 && <p className="muted">No project matches "{query}".</p>}

      {words.length ? (
        <div className="project-grid">{shown?.map(card)}</div>
      ) : (
        !!projects?.length && (
          <>
            {folders.map((f) => (
              <FolderSection key={f.id} folder={f} folders={folders}>
                {projects.filter((p) => f.paths.includes(p.path)).map(card)}
              </FolderSection>
            ))}
            <section className="launcher-section">
              <h2 className="launcher-section-title">Recent projects</h2>
              <div className="project-grid launcher-recent">{projects.slice(0, RECENT_COUNT).map(card)}</div>
            </section>
            <FolderSection folders={folders}>{projects.filter((p) => !folders.some((f) => f.paths.includes(p.path))).map(card)}</FolderSection>
          </>
        )
      )}
    </div>
  )
}

/** A start-screen folder (0.21): a section you can expand, rename, delete and drop projects onto. */
function FolderSection({ folder, folders, children }: { folder?: ProjectFolder; folders: ProjectFolder[]; children: React.ReactNode[] }) {
  const [over, setOver] = useState(false)
  const [menu, setMenu] = useState(false)
  // The "Not in a folder" section has no folder; it is hidden when empty and is always open.
  if (!folder && !children.length) return null
  const open = folder?.open ?? true
  const update = (patch: Partial<ProjectFolder>) => setFolders(folders.map((f) => (f.id === folder!.id ? { ...f, ...patch } : f)))
  const rename = async () => {
    setMenu(false)
    const name = (await promptDialog('Rename folder', folder!.name))?.trim()
    if (name) update({ name })
  }
  const remove = async () => {
    setMenu(false)
    const ok = await confirmDialog({ title: `Delete the folder "${folder!.name}"?`, message: 'Only the folder goes away. Its projects stay and move back to "Not in a folder".', confirmLabel: 'Delete folder' })
    if (ok) setFolders(folders.filter((f) => f.id !== folder!.id))
  }
  return (
    <section
      className={`launcher-section${over ? ' drop' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(PROJECT_DRAG)) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const path = e.dataTransfer.getData(PROJECT_DRAG)
        if (path) setFolders(moveToFolder(folders, path, folder?.id ?? null))
      }}
    >
      <h2 className="launcher-section-title">
        {folder ? (
          <>
            <button className="launcher-section-toggle" onClick={() => update({ open: !open })} aria-expanded={open}>
              {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />} {folder.name}
              <span className="muted launcher-section-count">{children.length}</span>
            </button>
            <button className="icon-btn" title="Folder menu" onClick={() => setMenu(!menu)}>
              <MoreHorizontal size={16} />
            </button>
            {menu && (
              <div className="menu launcher-section-menu" onMouseLeave={() => setMenu(false)}>
                <button onClick={() => void rename()}>Rename</button>
                <button className="danger" onClick={() => void remove()}>
                  Delete folder
                </button>
              </div>
            )}
          </>
        ) : (
          folders.length ? 'Not in a folder' : 'All projects'
        )}
      </h2>
      {open && (children.length ? <div className="project-grid">{children}</div> : <p className="muted launcher-section-empty">Drag a project here, or use Move to folder in its menu.</p>)}
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
              <button onClick={() => (setMenu(false), void newFolder(project.path))}>Move to a new folder…</button>
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
