import { appDataDir, dirname, documentDir, join, pictureDir } from '@tauri-apps/api/path'
import { open } from '@tauri-apps/plugin-dialog'
import * as fs from '@tauri-apps/plugin-fs'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import type { DirEntry, FileSystem } from './types'

const LAST_FOLDER_KEY = 'egd.lastPickedFolder'

/**
 * Where file pickers start. Without it, Linux file pickers reopen the last folder they remember,
 * even after it was moved or deleted, and then only show an error (e.g. an old project's folder).
 */
async function startFolder(fallback: () => Promise<string>): Promise<string | undefined> {
  try {
    const last = localStorage.getItem(LAST_FOLDER_KEY)
    if (last && (await fs.exists(last))) return last
    return await fallback()
  } catch {
    return undefined
  }
}
function rememberFolder(folder: string) {
  try {
    localStorage.setItem(LAST_FOLDER_KEY, folder)
  } catch {
    // Only a convenience.
  }
}

/** Real disk access through Tauri's fs/dialog plugins (desktop build). */
export class TauriFs implements FileSystem {
  readonly kind = 'tauri' as const

  join(...parts: string[]) {
    return join(...parts)
  }
  documentDir() {
    return documentDir()
  }
  appDataDir() {
    return appDataDir()
  }
  exists(path: string) {
    return fs.exists(path)
  }
  readText(path: string) {
    return fs.readTextFile(path)
  }
  async writeTextAtomic(path: string, text: string) {
    await fs.mkdir(await dirname(path), { recursive: true })
    // A unique name per write: two saves of the same file at once must not share (and steal) one temp file.
    const tmp = `${path}.${Math.random().toString(36).slice(2, 10)}.tmp`
    await fs.writeTextFile(tmp, text)
    await fs.rename(tmp, path)
  }
  readBinary(path: string) {
    return fs.readFile(path)
  }
  async writeBinaryAtomic(path: string, bytes: Uint8Array) {
    await fs.mkdir(await dirname(path), { recursive: true })
    // A unique name per write: two saves of the same file at once must not share (and steal) one temp file.
    const tmp = `${path}.${Math.random().toString(36).slice(2, 10)}.tmp`
    await fs.writeFile(tmp, bytes)
    await fs.rename(tmp, path)
  }
  mkdir(path: string) {
    return fs.mkdir(path, { recursive: true })
  }
  async list(path: string): Promise<DirEntry[]> {
    const entries = await fs.readDir(path)
    return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory }))
  }
  async remove(path: string) {
    if (await fs.exists(path)) await fs.remove(path, { recursive: true })
  }
  copyFile(from: string, to: string) {
    return fs.copyFile(from, to)
  }
  async pickFolder(title: string) {
    const result = await open({ directory: true, multiple: false, title, defaultPath: await startFolder(documentDir) })
    if (typeof result !== 'string') return null
    rememberFolder(await dirname(result))
    return result
  }
  revealInFolder(path: string) {
    return revealItemInDir(path)
  }
  async pickFiles(title: string, extensions: string[]) {
    const result = await open({ multiple: true, title, filters: [{ name: 'Files', extensions }], defaultPath: await startFolder(pictureDir) })
    if (!result) return []
    const paths = Array.isArray(result) ? result : [result]
    if (paths[0]) rememberFolder(await dirname(paths[0]))
    return paths
  }
}
