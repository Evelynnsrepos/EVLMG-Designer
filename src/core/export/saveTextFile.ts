import { downloadDir } from '@tauri-apps/api/path'
import { save } from '@tauri-apps/plugin-dialog'
import { getFs, isTauri } from '../fs'

export interface SaveTextFileOptions {
  /** Dialog title, e.g. "Export as Markdown". */
  title: string
  /** Suggested file name including the extension, e.g. `Design doc.md`. */
  defaultName: string
  text: string
  /** File type filter shown in the save dialog, e.g. `{ name: 'Markdown', extensions: ['md'] }`. */
  filter?: { name: string; extensions: string[] }
}

/** Characters Windows forbids in file names are dropped so the suggestion is always valid. */
export function safeFileName(name: string, fallback = 'Untitled'): string {
  const cleaned = name
    // oxlint-disable-next-line no-control-regex -- control characters are invalid in file names
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/[. ]+$/, '')
    .trim()
  return cleaned || fallback
}

/**
 * Export text outside the project (spec 8.6 exports, Q12). On desktop the user
 * picks where to save; in a plain browser the file is downloaded.
 * Returns false when the user cancelled.
 */
export async function saveTextFile(opts: SaveTextFileOptions): Promise<boolean> {
  if (isTauri()) {
    // A bare file name lets Linux pickers reopen a remembered folder that may be gone.
    const defaultPath = await getFs().join(await downloadDir(), opts.defaultName)
    const path = await save({ title: opts.title, defaultPath, filters: opts.filter ? [opts.filter] : undefined })
    if (!path) return false
    await getFs().writeTextAtomic(path, opts.text)
    return true
  }
  const url = URL.createObjectURL(new Blob([opts.text], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = opts.defaultName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}

/**
 * Save a binary export (project zip). The dialog opens in the Downloads folder
 * so the user confirms or changes the location; in a plain browser the file is
 * downloaded. Returns false when the user cancelled.
 */
export async function saveBinaryFile(opts: Omit<SaveTextFileOptions, 'text'> & { bytes: Uint8Array }): Promise<boolean> {
  if (isTauri()) {
    const fs = getFs()
    const defaultPath = await fs.join(await downloadDir(), opts.defaultName)
    const path = await save({ title: opts.title, defaultPath, filters: opts.filter ? [opts.filter] : undefined })
    if (!path) return false
    await fs.writeBinaryAtomic(path, opts.bytes)
    return true
  }
  const url = URL.createObjectURL(new Blob([opts.bytes as BlobPart]))
  const a = document.createElement('a')
  a.href = url
  a.download = opts.defaultName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return true
}
