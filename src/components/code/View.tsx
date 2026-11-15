import type { LSPClient } from '@codemirror/lsp-client'
import { EditorState, type Extension, type Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { ChevronDown, ChevronRight, File, FileCode2, FolderOpen, Play, Clapperboard, RefreshCw, Square, Volume2, VolumeX, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getFs, type DirEntry } from '@/core/fs'
import { newId, type ComponentType, type Entity, type EntityType, type Id } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { loadDocumentNow, useDocument, useProjectStore } from '@/core/state'
import { keyHint } from '@/shared/hotkeyHints'
import { openComponent } from '@/shell/editor/actions'
import { buildExport, gatherExport } from '@/shell/engineExport/build'
import { comboMode, type EffectLevel } from './combo'
import { designDataFrom, EMPTY_DATA, type DesignData, type DesignEntry } from './designData'
import { createState, lspCompartment } from './editor'
import { canRun, connectGodot, disconnectGodot, findGodot, startProcess, stopProcess, type CodeEvent, type GodotLink } from './godot'
import { createCodeDoc, fileUri, isHiddenEntry, isTextFile, loadLocal, outputLinks, relPath, saveLocal, type CodeDoc } from './model'
import './code.css'

const T = {
  openFolder: 'Open game folder',
  run: 'Run game',
  runScene: 'Run this scene',
  stop: 'Stop',
  findGodot: 'Find Godot',
  refresh: 'Read the folder again',
  noFolderTitle: 'Open your game folder',
  noFolder: [
    '1. Open the folder of your Godot game (the one with project.godot). Your code stays there; nothing is copied into the project.',
    '2. Godot connects by itself: completion, hover help and errors come straight from your Godot version.',
    '3. Press F5 to run the game. What it prints shows up below, and errors jump to their line when you click them.',
  ],
  noFile: 'Pick a file on the left.',
  output: 'Output',
  noScene: 'No scene found for this file. Open a .tscn file, or a script that has a scene with the same name next to it.',
  noGodot: 'Godot was not found on this computer. Use "Find Godot" and pick the Godot program.',
  notGodot: 'That file did not answer like Godot. Pick the Godot program itself.',
  desktopOnly: 'Running the game and Godot\'s help need the desktop app.',
  effect: 'Combo mode',
  sound: 'Combo mode sound',
  link: { off: 'Godot not connected', starting: 'Connecting to Godot…', on: 'Godot connected' } satisfies Record<GodotLink, string>,
}

interface Buffer {
  state: EditorState
  /** The text as it is on disk. */
  saved: Text
  /** The file uses Windows line ends; keep them when saving. */
  crlf: boolean
}

interface OutLine {
  kind: 'out' | 'err' | 'info'
  text: string
}

const MAX_OUTPUT = 2000

export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<CodeDoc>('code', documentId!, createCodeDoc)
  if (!doc.data) return null
  return <CodeTool key={documentId} id={documentId!} data={doc.data} update={doc.update} active={active} />
}

function CodeTool({ id, data, update }: { id: Id; data: CodeDoc; update: (recipe: (d: CodeDoc) => CodeDoc, o?: { undoable?: boolean }) => void; active: boolean }) {
  const fs = getFs()
  const [local, setLocal] = useState(loadLocal)
  const localRef = useRef(local)
  localRef.current = local
  const folder = local.folders[id] || data.folder.path
  const activeTab = data.tabs.find((t) => t.id === data.activeId) ?? null

  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const buffers = useRef(new Map<string, Buffer>())
  /** The file the editor shows right now. */
  const shown = useRef<string | null>(null)
  const clientRef = useRef<LSPClient | null>(null)
  const dataRef = useRef<DesignData>(EMPTY_DATA)
  const linkGen = useRef(0)
  const runGen = useRef(0)
  const pendingOut = useRef<OutLine[]>([])

  const [dirty, setDirty] = useState<ReadonlySet<string>>(new Set())
  const [tree, setTree] = useState<Record<string, DirEntry[]>>({})
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [godot, setGodot] = useState<{ program: string; version: string } | null>(null)
  const [link, setLink] = useState<GodotLink>('off')
  const [running, setRunning] = useState(false)
  const [lines, setLines] = useState<OutLine[]>([])

  const abs = useCallback((rel: string) => fs.join(folder, ...rel.split('/').filter(Boolean)), [fs, folder])
  const say = (text: string, kind: OutLine['kind'] = 'info') => setLines((l) => [...l, { kind, text }].slice(-MAX_OUTPUT))

  // ---- the one editor, showing one buffer at a time ----

  useEffect(() => {
    const view = new EditorView({ parent: hostRef.current!, state: EditorState.create({ extensions: EditorView.editable.of(false) }) })
    viewRef.current = view
    return () => view.destroy()
  }, [])

  const stateOf = (rel: string) => (shown.current === rel ? viewRef.current!.state : buffers.current.get(rel)?.state)

  const markDirty = (rel: string) => {
    const b = buffers.current.get(rel)
    const now = !!b && !stateOf(rel)!.doc.eq(b.saved)
    setDirty((d) => {
      if (d.has(rel) === now) return d
      const next = new Set(d)
      if (now) next.add(rel)
      else next.delete(rel)
      return next
    })
  }

  const lspFor = (rel: string): Extension =>
    clientRef.current && /\.gd$/i.test(rel) ? clientRef.current.plugin(`${fileUri(folder).replace(/\/$/, '')}/${rel.split('/').map(encodeURIComponent).join('/')}`, 'gdscript') : []

  /** Put the language server's part in (or take it out of) every open file. */
  const applyLsp = () => {
    for (const [rel, b] of buffers.current) {
      const effects = lspCompartment.reconfigure(lspFor(rel))
      if (shown.current === rel) viewRef.current!.dispatch({ effects })
      else b.state = b.state.update({ effects }).state
    }
  }

  const jump = (entry: DesignEntry) => openComponent(entry.tool, entry.documentId)

  const show = async (rel: string, line?: number): Promise<EditorView | null> => {
    const view = viewRef.current
    if (!view) return null
    if (!buffers.current.has(rel)) {
      let text: string
      try {
        text = await fs.readText(await abs(rel))
      } catch {
        // Deleted or moved outside the app: drop its tab.
        update((d) => ({ ...d, tabs: d.tabs.filter((t) => t.path !== rel), activeId: d.tabs.find((t) => t.path !== rel)?.id ?? null }), { undoable: false })
        return null
      }
      if (buffers.current.has(rel)) return show(rel, line) // opened twice at once
      const state = createState(text.replace(/\r\n/g, '\n'), {
        path: rel,
        lsp: lspFor(rel),
        data: () => dataRef.current,
        jump,
        extras: [comboMode(hostRef.current!, () => ({ level: localRef.current.effect, sound: localRef.current.sound }))],
        onChange: () => markDirty(rel),
      })
      buffers.current.set(rel, { state, saved: state.doc, crlf: text.includes('\r\n') })
    }
    if (shown.current !== rel) {
      const old = shown.current && buffers.current.get(shown.current)
      if (old) old.state = view.state
      shown.current = rel
      view.setState(buffers.current.get(rel)!.state)
    }
    if (line) {
      const at = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines)).from
      view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'center' }) })
    }
    view.focus()
    return view
  }

  const openFile = (rel: string, line?: number) => {
    update(
      (d) => {
        const tab = d.tabs.find((t) => t.path === rel) ?? { id: newId(), path: rel }
        return { ...d, tabs: d.tabs.includes(tab) ? d.tabs : [...d.tabs, tab], activeId: tab.id }
      },
      { undoable: false },
    )
    return show(rel, line)
  }

  useEffect(() => {
    if (!folder) return
    if (activeTab) void show(activeTab.path)
    else if (viewRef.current) {
      const old = shown.current && buffers.current.get(shown.current)
      if (old) old.state = viewRef.current.state
      shown.current = null
      viewRef.current.setState(EditorState.create({ extensions: EditorView.editable.of(false) }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab?.path, folder])

  // ---- saving and files changed by the engine ----

  const save = async (rel: string) => {
    const b = buffers.current.get(rel)
    const state = stateOf(rel)
    if (!b || !state || state.doc.eq(b.saved)) return
    try {
      await fs.writeTextAtomic(await abs(rel), state.doc.sliceString(0, undefined, b.crlf ? '\r\n' : '\n'))
      b.saved = state.doc
      markDirty(rel)
    } catch (e) {
      say(`Could not save ${rel}: ${String(e)}`, 'err')
    }
  }
  const saveAll = () => Promise.all([...buffers.current.keys()].map(save))

  /** Take over what the engine (or git) changed on disk. A file with unsaved changes here is left alone. */
  const reloadChanged = async () => {
    for (const [rel, b] of buffers.current) {
      const state = stateOf(rel)!
      if (!state.doc.eq(b.saved)) continue
      const text = await abs(rel)
        .then((p) => fs.readText(p))
        .catch(() => null)
      const now = stateOf(rel)
      if (text === null || !now || now !== state) continue
      const fresh = text.replace(/\r\n/g, '\n')
      if (fresh === b.saved.toString()) continue
      // An ordinary change, so Undo brings the old text back.
      const spec = { changes: { from: 0, to: state.doc.length, insert: fresh }, userEvent: 'reload' }
      if (shown.current === rel) {
        viewRef.current!.dispatch(spec)
        b.saved = viewRef.current!.state.doc
      } else {
        b.state = state.update(spec).state
        b.saved = b.state.doc
      }
      b.crlf = text.includes('\r\n')
      markDirty(rel)
    }
  }

  const closeTab = async (tabId: Id) => {
    const tab = data.tabs.find((t) => t.id === tabId)
    if (!tab) return
    await save(tab.path)
    if (shown.current === tab.path) shown.current = null
    buffers.current.delete(tab.path)
    update(
      (d) => {
        const i = d.tabs.findIndex((t) => t.id === tabId)
        const tabs = d.tabs.filter((t) => t.id !== tabId)
        return { ...d, tabs, activeId: d.activeId === tabId ? (tabs[Math.min(i, tabs.length - 1)]?.id ?? null) : d.activeId }
      },
      { undoable: false },
    )
  }

  // ---- design data ----

  const loadData = async () => {
    const { root, meta, entities, categories } = useProjectStore.getState()
    if (!root || !meta) return
    const read = (type: ComponentType, docId: string) => loadDocumentNow<unknown>(root, type, docId, () => null)
    const input = await gatherExport(read, meta, entities as Record<EntityType, Entity[]>, categories)
    dataRef.current = designDataFrom(buildExport(input, 'godot'), input.strings)
  }

  // Latest versions for the listeners below, which are set up once.
  const live = useRef({ saveAll, reloadChanged, loadData })
  live.current = { saveAll, reloadChanged, loadData }
  useEffect(() => {
    void live.current.loadData()
    const onFocus = () => {
      void live.current.reloadChanged()
      void live.current.loadData().catch(() => {})
    }
    const onBlur = () => void live.current.saveAll()
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      void live.current.saveAll()
    }
  }, [])

  // ---- the folder tree ----

  const loadDir = async (rel: string) => {
    const entries = await fs.list(await abs(rel)).catch(() => [] as DirEntry[])
    const list = entries.filter((e) => !isHiddenEntry(e.name)).sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name))
    setTree((t) => ({ ...t, [rel]: list }))
  }
  const refreshTree = () => {
    setTree({})
    for (const rel of ['', ...expanded]) void loadDir(rel)
  }
  const toggleDir = (rel: string) => {
    setExpanded((s) => {
      const next = new Set(s)
      if (next.has(rel)) next.delete(rel)
      else next.add(rel)
      return next
    })
    if (!tree[rel]) void loadDir(rel)
  }

  // ---- Godot ----

  const connect = async (program: string | null) => {
    const gen = ++linkGen.current
    await disconnectGodot(clientRef.current)
    clientRef.current = null
    const client = await connectGodot(
      folder,
      program,
      async (uri) => {
        const rel = relPath(folder, uri)
        return rel ? openFile(rel) : null
      },
      (s) => {
        if (gen !== linkGen.current) return
        setLink(s)
        if (s === 'off' && clientRef.current) {
          clientRef.current = null
          applyLsp()
        }
      },
    )
    if (gen !== linkGen.current) return
    clientRef.current = client
    applyLsp()
  }

  useEffect(() => {
    if (!folder) return
    buffers.current.clear()
    shown.current = null
    setDirty(new Set())
    setTree({})
    setExpanded(new Set())
    void loadDir('')
    let gone = false
    void findGodot(localRef.current.godot).then((found) => {
      if (gone) return
      setGodot(found)
      void connect(found?.program ?? null)
    })
    return () => {
      gone = true
      linkGen.current++
      void disconnectGodot(clientRef.current)
      clientRef.current = null
      if (canRun()) void stopProcess('run').catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder])

  const pickFolder = async () => {
    const path = await fs.pickFolder('Choose your game folder (the one with project.godot)')
    if (!path) return
    await saveAll()
    setLocal(saveLocal({ folders: { ...localRef.current.folders, [id]: path } }))
    if (!data.folder.path) update((d) => ({ ...d, folder: { path } }), { undoable: false })
  }

  const pickGodot = async () => {
    const [path] = await fs.pickFiles('Choose the Godot program', [])
    if (!path) return
    const found = await findGodot(path)
    if (found?.program !== path) return say(T.notGodot, 'err')
    setLocal(saveLocal({ godot: path }))
    setGodot(found)
    void connect(path)
  }

  const onRunEvent = (gen: number) => (e: CodeEvent) => {
    if (gen !== runGen.current) return // a run that was stopped to start this one
    if (e.kind === 'exit') {
      setRunning(false)
      pendingOut.current.push({ kind: 'info', text: e.code === 0 ? 'The game closed.' : `The game ended (code ${e.code}).` })
    } else if (e.kind === 'out' || e.kind === 'err') pendingOut.current.push({ kind: e.kind, text: e.text })
    // A chatty game prints thousands of lines: add them once per frame.
    if (pendingOut.current.length === 1)
      requestAnimationFrame(() => {
        const add = pendingOut.current
        pendingOut.current = []
        setLines((l) => [...l, ...add].slice(-MAX_OUTPUT))
      })
  }

  const run = async (scene?: string) => {
    if (!canRun()) return say(T.desktopOnly)
    if (!godot) return say(T.noGodot, 'err')
    await saveAll()
    const gen = ++runGen.current
    setLines([{ kind: 'info', text: scene ? `Running ${scene}…` : 'Running the game…' }])
    setRunning(true)
    try {
      await startProcess('run', godot.program, ['--path', folder, ...(scene ? [`res://${scene}`] : [])], folder, onRunEvent(gen))
    } catch (e) {
      setRunning(false)
      say(String(e), 'err')
    }
  }

  const runScene = async () => {
    const rel = activeTab?.path
    const scene = rel && (/\.tscn$/i.test(rel) ? rel : rel.replace(/\.[^./]+$/, '.tscn'))
    if (!scene || !(await fs.exists(await abs(scene)))) return say(T.noScene)
    void run(scene)
  }

  const stop = () => {
    runGen.current++
    setRunning(false)
    if (canRun()) void stopProcess('run')
    say('Stopped.')
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    const key = e.key.toLowerCase()
    if ((e.ctrlKey || e.metaKey) && key === 's') void saveAll()
    else if (key === 'f5') void run()
    else if (key === 'f6') void runScene()
    else if (key === 'f8') stop()
    else return
    e.preventDefault()
  }

  const renderDir = (rel: string, depth: number): React.ReactNode =>
    (tree[rel] ?? []).map((e) => {
      const path = rel ? `${rel}/${e.name}` : e.name
      const pad = { paddingLeft: 8 + depth * 14 }
      if (e.isDirectory)
        return (
          <div key={path}>
            <button className="code-tree-row" style={pad} onClick={() => toggleDir(path)}>
              {expanded.has(path) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {e.name}
            </button>
            {expanded.has(path) && renderDir(path, depth + 1)}
          </div>
        )
      const text = isTextFile(e.name)
      return (
        <button key={path} className={`code-tree-row${activeTab?.path === path ? ' is-active' : ''}`} style={pad} disabled={!text} onClick={() => void openFile(path)}>
          {/\.(gd|cs|gdshader)$/i.test(e.name) ? <FileCode2 size={14} /> : <File size={14} />}
          {e.name}
        </button>
      )
    })

  return (
    <div className="code-root" onKeyDown={onKeyDown}>
      <div className="code-bar">
        <button className="btn" onClick={() => void pickFolder()} title={folder || T.openFolder}>
          <FolderOpen size={15} /> {folder ? folder.split(/[\\/]/).filter(Boolean).pop() : T.openFolder}
        </button>
        {folder && (
          <>
            <button className="btn btn-primary" onClick={() => void run()} {...keyHint('f5')}>
              <Play size={15} /> {T.run}
            </button>
            <button className="btn" onClick={() => void runScene()} {...keyHint('f6')}>
              <Clapperboard size={15} /> {T.runScene}
            </button>
            <button className="btn" onClick={stop} disabled={!running} {...keyHint('f8')}>
              <Square size={15} /> {T.stop}
            </button>
            <button className={`code-pill is-${link}`} onClick={() => (godot ? void connect(godot.program) : void pickGodot())} title={godot ? `${godot.version}. Click to connect again.` : T.noGodot}>
              {godot || !canRun() ? T.link[link] : T.findGodot}
            </button>
          </>
        )}
        <span className="code-spacer" />
        <label className="code-effect">
          {T.effect}
          <select className="input" value={local.effect} onChange={(e) => setLocal(saveLocal({ effect: e.target.value as EffectLevel }))}>
            <option value="off">Off</option>
            <option value="subtle">Subtle</option>
            <option value="full">Full</option>
          </select>
        </label>
        <button className="icon-btn" title={T.sound} aria-label={T.sound} aria-pressed={local.sound} disabled={local.effect === 'off'} onClick={() => setLocal(saveLocal({ sound: !local.sound }))}>
          {local.sound ? <Volume2 size={15} /> : <VolumeX size={15} />}
        </button>
      </div>
      <div className="code-main">
        {folder && (
          <aside className="code-tree">
            <button className="icon-btn code-tree-refresh" title={T.refresh} aria-label={T.refresh} onClick={refreshTree}>
              <RefreshCw size={13} />
            </button>
            {renderDir('', 0)}
          </aside>
        )}
        <div className="code-center">
          {folder && (
            <div className="code-tabs" role="tablist">
              {data.tabs.map((t) => (
                <div key={t.id} role="tab" aria-selected={t.id === data.activeId} className={`code-tab${t.id === data.activeId ? ' is-active' : ''}`} title={t.path}>
                  <button className="code-tab-name" onClick={() => update((d) => ({ ...d, activeId: t.id }), { undoable: false })}>
                    {t.path.split('/').pop()}
                    {dirty.has(t.path) && <span className="code-dot" title="Not saved yet (Ctrl+S)" />}
                  </button>
                  <button className="code-tab-close" aria-label={`Close ${t.path}`} onClick={() => void closeTab(t.id)}>
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="code-editor-box">
            {/* The editor lives here; Combo mode adds its sparks and counter on top. */}
            <div className="code-editor" ref={hostRef} />
            {!folder ? (
              <div className="code-empty">
                <h2>{T.noFolderTitle}</h2>
                {T.noFolder.map((p) => (
                  <p key={p}>{p}</p>
                ))}
                <button className="btn btn-primary" onClick={() => void pickFolder()}>
                  <FolderOpen size={15} /> {T.openFolder}
                </button>
              </div>
            ) : (
              !activeTab && <div className="code-empty">{T.noFile}</div>
            )}
          </div>
          {folder && lines.length > 0 && (
            <div className="code-output" aria-label={T.output}>
              <button className="icon-btn code-output-close" aria-label="Clear output" title="Clear output" onClick={() => setLines([])}>
                <X size={12} />
              </button>
              <OutputLines lines={lines} open={(path, line) => void openFile(path, line)} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function OutputLines({ lines, open }: { lines: OutLine[]; open: (path: string, line: number) => void }) {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [lines])
  return (
    <>
      {lines.map((l, i) => {
        const parts: React.ReactNode[] = []
        let at = 0
        for (const link of outputLinks(l.text)) {
          parts.push(
            l.text.slice(at, link.from),
            <button key={link.from} className="code-output-link" onClick={() => open(link.path, link.line)}>
              {l.text.slice(link.from, link.to)}
            </button>,
          )
          at = link.to
        }
        return (
          <div key={i} className={`code-output-line is-${l.kind}`}>
            {parts}
            {l.text.slice(at)}
          </div>
        )
      })}
      <div ref={end} />
    </>
  )
}
