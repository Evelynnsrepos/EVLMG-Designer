export interface DirEntry {
  name: string
  isDirectory: boolean
}

/**
 * The only way app code touches the disk. Paths are absolute and must be
 * built with `join` (never by concatenating `/` or `\`) so they work on
 * Windows and Linux (spec 2, platform rules).
 */
export interface FileSystem {
  readonly kind: 'tauri' | 'browser' | 'memory'
  join(...parts: string[]): Promise<string>
  documentDir(): Promise<string>
  appDataDir(): Promise<string>
  exists(path: string): Promise<boolean>
  readText(path: string): Promise<string>
  /** Writes to a `<path>.<random>.tmp` file and renames over the target, so a crash never leaves half a file (spec 11). */
  writeTextAtomic(path: string, text: string): Promise<void>
  /** Raw bytes, for images and audio in `assets/`. */
  readBinary(path: string): Promise<Uint8Array>
  /** Atomic like writeTextAtomic. */
  writeBinaryAtomic(path: string, bytes: Uint8Array): Promise<void>
  mkdir(path: string): Promise<void>
  list(path: string): Promise<DirEntry[]>
  remove(path: string): Promise<void>
  copyFile(from: string, to: string): Promise<void>
  /** Ask the user to choose a folder; null if cancelled. */
  pickFolder(title: string): Promise<string | null>
  /** Open the OS file manager at this path (PM-7). */
  revealInFolder(path: string): Promise<void>
  /** Ask the user to choose files to import (images, audio); no extensions means any file. */
  pickFiles(title: string, extensions: string[]): Promise<string[]>
}
