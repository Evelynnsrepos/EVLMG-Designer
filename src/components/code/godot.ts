import { LSPClient, LSPPlugin, Workspace, languageServerExtensions, type Transport, type WorkspaceFile } from '@codemirror/lsp-client'
import type { EditorView } from '@codemirror/view'
import { Channel, invoke, isTauri } from '@tauri-apps/api/core'
import { fileUri } from './model'

/** The link to Godot through the app's Rust side (src-tauri/src/code.rs): start it, read its output, talk to its language server. */

export type CodeEvent = { kind: 'out' | 'err'; text: string } | { kind: 'exit'; code: number } | { kind: 'msg'; text: string } | { kind: 'closed' }

/** Running the game and the language server need the desktop app; the browser and phones only edit. */
export const canRun = () => isTauri()

/** Godot on this computer: the saved one, or one that is installed as `godot` / `godot4`. */
export async function findGodot(saved: string): Promise<{ program: string; version: string } | null> {
  if (!canRun()) return null
  for (const program of [saved, 'godot', 'godot4'].filter(Boolean)) {
    const version = await invoke<string | null>('code_engine_version', { program }).catch(() => null)
    if (version) return { program, version }
  }
  return null
}

export function startProcess(id: 'run' | 'lsp', program: string, args: string[], cwd: string, onEvent: (e: CodeEvent) => void): Promise<void> {
  const channel = new Channel<CodeEvent>()
  channel.onmessage = onEvent
  return invoke('code_start', { id, program, args, cwd, onEvent: channel })
}

export const stopProcess = (id: 'run' | 'lsp') => invoke<void>('code_stop', { id })

/** Godot's editor answers here when it is open. */
const EDITOR_PORT = 6005
/** Our own hidden Godot gets another port, so it never fights with an open editor. */
const HIDDEN_PORT = 6008

async function connectPort(port: number, onClosed: () => void): Promise<Transport | null> {
  const handlers = new Set<(value: string) => void>()
  const channel = new Channel<CodeEvent>()
  channel.onmessage = (e) => {
    if (e.kind === 'msg') for (const h of handlers) h(e.text)
    else if (e.kind === 'closed') onClosed()
  }
  try {
    await invoke('code_lsp_connect', { port, onEvent: channel })
  } catch {
    return null
  }
  return {
    send: (message) => void invoke('code_lsp_send', { text: message }).catch(() => {}),
    subscribe: (h) => void handlers.add(h),
    unsubscribe: (h) => void handlers.delete(h),
  }
}

/** One editor shows one file at a time; a jump to another file asks the tool to open it in a tab. */
class GameWorkspace extends Workspace {
  files: (WorkspaceFile & { view: EditorView })[] = []
  private show: (uri: string) => Promise<EditorView | null>
  constructor(client: LSPClient, show: (uri: string) => Promise<EditorView | null>) {
    super(client)
    this.show = show
  }
  syncFiles() {
    const result = []
    for (const file of this.files) {
      const plugin = LSPPlugin.get(file.view)
      // The view may show another tab by now; that tab's own entry is synced instead.
      if (!plugin || plugin.uri !== file.uri || plugin.unsyncedChanges.empty) continue
      result.push({ changes: plugin.unsyncedChanges, file, prevDoc: file.doc })
      file.doc = file.view.state.doc
      file.version++
      plugin.clear()
    }
    return result
  }
  openFile(uri: string, languageId: string, view: EditorView) {
    this.closeFile(uri)
    const file = { uri, languageId, version: 1, doc: view.state.doc, view, getView: () => view }
    this.files.push(file)
    this.client.didOpen(file)
  }
  closeFile(uri: string) {
    if (!this.getFile(uri)) return
    this.files = this.files.filter((f) => f.uri !== uri)
    this.client.didClose(uri)
  }
  displayFile(uri: string) {
    return this.show(uri)
  }
}

/** Hover text comes from another program: keep its formatting, drop anything that could run or load. */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script, style, iframe, object, embed, link, meta, form, img, svg').forEach((el) => el.remove())
  for (const el of doc.body.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      if (attr.name !== 'class' && !(attr.name === 'href' && /^https?:/i.test(attr.value))) el.removeAttribute(attr.name)
    }
  }
  return doc.body.innerHTML
}

export type GodotLink = 'off' | 'starting' | 'on'

/**
 * Connects to Godot's language server for the game in `folder`: the open Godot editor when there is one,
 * otherwise a hidden Godot started in the background (when `godot` is known). Null when neither works.
 */
export async function connectGodot(folder: string, godot: string | null, show: (uri: string) => Promise<EditorView | null>, onState: (s: GodotLink) => void): Promise<LSPClient | null> {
  if (!canRun()) return null
  let client: LSPClient | null = null
  const onClosed = () => {
    client?.disconnect()
    onState('off')
  }
  onState('starting')
  let transport = await connectPort(EDITOR_PORT, onClosed)
  if (!transport && godot) {
    await startProcess('lsp', godot, ['--headless', '--editor', '--lsp-port', String(HIDDEN_PORT), '--path', folder], folder, () => {})
    // A first start imports the game's files; give it up to half a minute.
    for (let i = 0; i < 30 && !transport; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      transport = await connectPort(HIDDEN_PORT, onClosed)
    }
  }
  if (!transport) {
    onState('off')
    return null
  }
  client = new LSPClient({ rootUri: fileUri(folder), workspace: (c) => new GameWorkspace(c, show), sanitizeHTML: sanitizeHtml, extensions: languageServerExtensions() }).connect(transport)
  onState('on')
  return client
}

export async function disconnectGodot(client: LSPClient | null) {
  client?.disconnect()
  if (!canRun()) return
  await invoke('code_lsp_close').catch(() => {})
  await stopProcess('lsp').catch(() => {})
}
