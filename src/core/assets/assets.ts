import { convertFileSrc } from '@tauri-apps/api/core'
import { create } from 'zustand'
import { getFs } from '../fs'
import { newId, type AssetPath } from '../model'

/**
 * Asset import (spec 2.1, MB-7, BB-4): images and audio are copied into the
 * project's `assets/images/` or `assets/audio/` as `<uuid>.<ext>`, and
 * components store the returned relative path (`assets/images/<uuid>.png`).
 * Stored paths always use `/`; `resolveAssetPath` turns them into real paths.
 */
export type AssetKind = 'image' | 'audio'

export interface ImportedAsset {
  /** Relative path to store in your document, e.g. `assets/images/<uuid>.png`. */
  path: AssetPath
  kind: AssetKind
  /** The original file name, handy as a default title. */
  name: string
}

export const ASSET_EXTENSIONS: Record<AssetKind, readonly string[]> = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'],
  audio: ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'webm'],
}

const FOLDER: Record<AssetKind, string> = { image: 'images', audio: 'audio' }

const MIME_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/opus': 'opus',
  'audio/webm': 'webm',
}

const EXTENSION_MIME: Record<string, string> = {
  ...Object.fromEntries(Object.entries(MIME_EXTENSION).map(([mime, ext]) => [ext, mime])),
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  oga: 'audio/ogg',
}

/** Lower-case extension of a file name or path, without the dot ('' if none). */
export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(i + 1).toLowerCase() : ''
}

export function assetKindOfExtension(ext: string): AssetKind | null {
  const e = ext.toLowerCase()
  if (ASSET_EXTENSIONS.image.includes(e)) return 'image'
  if (ASSET_EXTENSIONS.audio.includes(e)) return 'audio'
  return null
}

/** MIME type for a stored asset path, used for blob URLs and `<audio>` sources. */
export function mimeOf(path: string): string {
  return EXTENSION_MIME[extensionOf(path)] ?? 'application/octet-stream'
}

/** Which kinds a caller accepts: one kind, or both. */
export type AcceptKind = AssetKind | 'any'

function accepts(accept: AcceptKind, kind: AssetKind) {
  return accept === 'any' || accept === kind
}

async function targetFor(root: string, kind: AssetKind, ext: string) {
  const fs = getFs()
  const file = `${newId()}.${ext}`
  const path: AssetPath = `assets/${FOLDER[kind]}/${file}`
  const abs = await fs.join(root, 'assets', FOLDER[kind], file)
  await fs.mkdir(await fs.join(root, 'assets', FOLDER[kind]))
  return { path, abs }
}

/** Copy a file from disk (file picker result) into the project. Null if the type is not supported. */
export async function importAssetFromPath(root: string, sourcePath: string, accept: AcceptKind = 'any'): Promise<ImportedAsset | null> {
  const ext = extensionOf(sourcePath)
  const kind = assetKindOfExtension(ext)
  if (!kind || !accepts(accept, kind)) return null
  const { path, abs } = await targetFor(root, kind, ext === 'jpeg' ? 'jpg' : ext)
  await getFs().copyFile(sourcePath, abs)
  return { path, kind, name: sourcePath.split(/[\\/]/).pop() ?? sourcePath }
}

/**
 * Save a Blob or File (drag and drop, clipboard paste, microphone recording)
 * into the project. Null if the type is not supported.
 */
export async function importAssetFromBlob(root: string, blob: Blob, accept: AcceptKind = 'any', name?: string): Promise<ImportedAsset | null> {
  const fileName = name ?? (blob instanceof File ? blob.name : '')
  const mime = blob.type.split(';')[0].trim().toLowerCase()
  const ext = MIME_EXTENSION[mime] ?? extensionOf(fileName)
  const kind = assetKindOfExtension(ext)
  if (!kind || !accepts(accept, kind)) return null
  const { path, abs } = await targetFor(root, kind, ext === 'jpeg' ? 'jpg' : ext)
  await getFs().writeBinaryAtomic(abs, new Uint8Array(await blob.arrayBuffer()))
  return { path, kind, name: fileName || `${kind === 'image' ? 'Image' : 'Audio'}.${ext}` }
}

/**
 * Asked before the file picker whenever images are wanted (v0.12, the drawings shelf in shared/drawingShelf):
 * resolves to the picked pictures, 'file' to open the file picker, or null when the user cancelled.
 */
export type ImageChooser = (root: string, title: string) => Promise<ImportedAsset[] | 'file' | null>
let imageChooser: ImageChooser | null = null
export function setImageChooser(chooser: ImageChooser | null) {
  imageChooser = chooser
}

/** Open the file picker and import every chosen file (MB-7). For images, your drawings are offered first. */
export async function pickAndImportAssets(root: string, accept: AcceptKind, title?: string): Promise<ImportedAsset[]> {
  const extensions = accept === 'any' ? [...ASSET_EXTENSIONS.image, ...ASSET_EXTENSIONS.audio] : [...ASSET_EXTENSIONS[accept]]
  const defaultTitle = accept === 'audio' ? 'Choose audio files' : accept === 'image' ? 'Choose images' : 'Choose images or audio'
  if (accept !== 'audio' && imageChooser) {
    const chosen = await imageChooser(root, title ?? defaultTitle)
    if (chosen === null) return []
    if (chosen !== 'file') return chosen
  }
  const paths = await getFs().pickFiles(title ?? defaultTitle, extensions)
  const out: ImportedAsset[] = []
  for (const p of paths) {
    const asset = await importAssetFromPath(root, p, accept)
    if (asset) out.push(asset)
  }
  return out
}

/** Files carried by a drop event or a paste event. */
export function filesFromDataTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return []
  if (dt.files && dt.files.length > 0) return Array.from(dt.files)
  const out: File[] = []
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file) out.push(file)
  }
  return out
}

/** True if a drag carries files, for showing a drop highlight in `dragover`. */
export function dragHasFiles(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types ?? []).includes('Files')
}

/**
 * Import everything usable from a drop (`event.dataTransfer`) or paste
 * (`event.clipboardData`) event. Unsupported files are skipped.
 */
export async function importAssetsFromDataTransfer(root: string, dt: DataTransfer | null, accept: AcceptKind = 'any'): Promise<ImportedAsset[]> {
  const out: ImportedAsset[] = []
  for (const file of filesFromDataTransfer(dt)) {
    const asset = await importAssetFromBlob(root, file, accept)
    if (asset) out.push(asset)
  }
  return out
}

/** Absolute path of a stored asset path. */
export async function resolveAssetPath(root: string, path: AssetPath): Promise<string> {
  return getFs().join(root, ...path.split('/').filter(Boolean))
}

const blobUrls = new Map<string, string>()

/** Bumped when asset files appear on disk from outside the app's own import (collaboration). */
export const useAssetsVersion = create<{ version: number }>()(() => ({ version: 0 }))
export function bumpAssets() {
  useAssetsVersion.setState((s) => ({ version: s.version + 1 }))
}

/**
 * A URL an `<img>` or `<audio>` can load. Desktop: Tauri's asset protocol.
 * Browser dev build: a blob URL read from the fake disk (cached).
 * Null if the file is missing, so callers can show the placeholder.
 */
export async function assetUrl(root: string, path: AssetPath | null | undefined): Promise<string | null> {
  if (!path) return null
  const fs = getFs()
  const abs = await resolveAssetPath(root, path)
  // Missing files (e.g. still arriving from a teammate) show the placeholder until bumpAssets().
  if (fs.kind === 'tauri') return (await fs.exists(abs)) ? convertFileSrc(abs) : null
  return assetBlobUrl(root, path)
}

/**
 * v0.24.3: a blob URL for a canvas that gets read back (exports, thumbnails).
 * Pictures from Tauri's asset protocol count as another site, so a canvas that
 * draws them can't be saved ("The operation is insecure").
 */
export async function assetBlobUrl(root: string, path: AssetPath | null | undefined): Promise<string | null> {
  if (!path) return null
  const fs = getFs()
  const abs = await resolveAssetPath(root, path)
  const cached = blobUrls.get(abs)
  if (cached) return cached
  if (!(await fs.exists(abs))) return null
  const bytes = await fs.readBinary(abs)
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeOf(path) }))
  blobUrls.set(abs, url)
  return url
}
