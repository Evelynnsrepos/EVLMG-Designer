import { BrowserFs, MemoryFs } from './memoryFs'
import { TauriFs } from './tauriFs'
import type { FileSystem } from './types'

export type { DirEntry, FileSystem } from './types'
export { MemoryFs, BrowserFs }

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

let current: FileSystem | null = null

/** The active file system: Tauri on desktop, localStorage-backed in a plain browser. */
export function getFs(): FileSystem {
  if (!current) current = isTauri() ? new TauriFs() : new BrowserFs()
  return current
}

/**
 * Desktop: lets the app reach a project folder outside the person's own folders (another drive, a USB stick).
 * Rust only accepts folders that hold a project.json (src-tauri/src/scope.rs). Elsewhere it does nothing.
 */
export async function allowProjectFolder(root: string): Promise<void> {
  if (!isTauri()) return
  const { invoke } = await import('@tauri-apps/api/core')
  // The phone app has no such command and no such limit.
  await invoke('fs_allow_project', { path: root }).catch(() => {})
}

/** Tests swap in a MemoryFs. */
export function setFs(fs: FileSystem) {
  current = fs
}

/** Strip characters Windows forbids in folder names (spec 2, platform rules). */
export function safeFolderName(name: string): string {
  const cleaned = name
    // oxlint-disable-next-line no-control-regex -- control characters are invalid in file names
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/[. ]+$/, '')
    .trim()
  return cleaned || 'Untitled Project'
}
