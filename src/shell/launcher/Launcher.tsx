import { CircleHelp, FileArchive, FolderOpen, GitBranch, Image, MoreHorizontal, Moon, Plus, Settings, Sun, Type, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { saveBinaryFile, safeFileName } from '@/core/export'
import { getFs, isTauri } from '@/core/fs'
import { cloneProject, listProjectRepos, type GitHubRepo } from '@/core/gitsync'
import { assetUrl, pickAndImportAssets } from '@/core/assets'
import type { RecentProject } from '@/core/model'
import { deleteProject, importProjectZip, isProjectFolder, loadProject, readRecents, removeRecent, saveMeta, upsertRecent, zipProject } from '@/core/project'
import { useAppStore, useProjectStore, useSettings } from '@/core/state'
import { confirmDialog, promptDialog } from '@/shared/dialogs'
import { Modal } from '@/shared/ui'
import { maybeStartTour, useHelp } from '../help/help'
import { toggleTheme, useTheme } from '../theme'
import { openSettings } from '../settings/open'
import { BackupsDialog } from './BackupsDialog'
import { JoinDialog } from '../collab/CollabDialogs'
import './launcher.css'

/** Project list shown on startup (spec 4, PM-1..PM-8). */
export function Launcher() {
  const [projects, setProjects] = useState<RecentProject[] | null>(null)
  const [missing, setMissing] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [joinOpen, setJoinOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  /** "Open from GitHub": the person's project repositories to pick from (0.20). */
  const [repos, setRepos] = useState<GitHubRepo[] | null>(null)
  const theme = useTheme()

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
      setError('That folder is not an Evelopment Games Designer project (no project.json).')
      return
    }
    await open(path)
  }

  const openFromGit = async () => {
    if (!useSettings.getState().githubLogin) return cloneFrom((await promptDialog('Open from Git: repository address', ''))?.trim())
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

  return (
    <div className="launcher">
      <header className="launcher-header">
        <div>
          <h1>Evelopment Games Designer</h1>
          <div className="muted">Your game projects</div>
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
            <button className="btn" title="Download a project from a Git repository and keep it synced (one person only)" onClick={() => void openFromGit()}>
              <GitBranch size={16} /> Open from Git
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
            <h3>Open from GitHub</h3>
            {repos.length === 0 && <p className="muted">No project repositories (egd-…) on GitHub yet.</p>}
            <div className="gitsync-choices">
              {repos.map((r) => (
                <button key={r.name} className="btn" onClick={() => void cloneFrom(r.cloneUrl)}>
                  {r.name} <span className="muted gitsync-small">{new Date(r.updatedAt).toLocaleDateString()}</span>
                </button>
              ))}
              <button className="btn btn-ghost" onClick={() => void promptDialog('Open from Git: repository address', '').then((u) => cloneFrom(u?.trim()))}>
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

      <div className="project-grid">
        {projects?.map((p) => (
          <ProjectCard key={p.path} project={p} missing={missing.has(p.path)} onOpen={() => void open(p.path)} onChanged={refresh} onError={setError} />
        ))}
      </div>
    </div>
  )
}

function ProjectCard({
  project,
  missing,
  onOpen,
  onChanged,
  onError,
}: {
  project: RecentProject
  missing: boolean
  onOpen: () => void
  onChanged: () => void
  onError: (message: string) => void
}) {
  const [menu, setMenu] = useState(false)
  const [showBackups, setShowBackups] = useState(false)

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
    <div className={`project-card${missing ? ' missing' : ''}`}>
      <button className="project-card-main" onClick={onOpen} disabled={missing}>
        {project.image && imageUrl && <img className="project-card-image" src={imageUrl} alt="" />}
        <h3>{project.name}</h3>
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
              <button onClick={() => void getFs().revealInFolder(project.path)}>Show in folder</button>
              <button onClick={() => void exportZip()}>Export as zip…</button>
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
