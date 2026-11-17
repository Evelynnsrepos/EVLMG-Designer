import { invoke } from '@tauri-apps/api/core'
import { unzipSync } from 'fflate'
import { Puzzle } from 'lucide-react'
import * as React from 'react'
import { create } from 'zustand'
import { getFs } from '@/core/fs'
import { newId, PLUGIN_ID_PATTERN, type PluginComponentType } from '@/core/model'
import { isSafeEntryPath } from '@/core/project'
import { registerPluginManifest, unregisterPluginManifest, type PanelProps } from '@/core/registry'
import { useDocument, useIntentHandler, useProjectStore } from '@/core/state'
import { useAssetUrl } from '@/core/assets'
import { confirmDialog, promptDialog } from '@/shared/dialogs'
import { RichTextEditor } from '@/shared/richtext'
import { addHotwheelAction, openHotwheel, useHotwheel } from '@/shared/hotwheel'
import { addImageTarget, openComponent, sendImageTo } from '../editor/actions'
import { SendMenu } from '../editor/SendMenu'

/**
 * Plugins (v0.4, docs/PLUGINS.md). A plugin is a folder in `<app data>/plugins/<id>/`
 * with `plugin.json` and one ES module. Plugin code runs inside the app with full
 * access, so installing always goes through PluginWarningDialog first.
 */
export const PLUGIN_API_VERSION = 1

export interface PluginInfo {
  id: string
  name: string
  version: string
  description?: string
  apiVersion: number
  /** Module file inside the plugin folder, default `index.js`. */
  main?: string
  /** Optional stylesheet inside the plugin folder. */
  style?: string
  /** Set by the app: where it was installed from. */
  source?: string
  /** What the plugin says it uses; shown in plain words before installing. Missing = the strongest warning. */
  permissions?: PluginPermission[]
  /** App versions it works with, e.g. ">=0.35" or ">=0.35 <0.40". Other versions show a clear message instead of breaking. */
  needsApp?: string
}

export const PLUGIN_PERMISSIONS = ['files', 'network', 'project'] as const
export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number]

/** Does `version` (e.g. "0.35.0") fit `range` (space-separated >=, >, <=, <, = comparators)? A bad range never fits. */
export function appVersionFits(range: string, version: string): boolean {
  const num = (v: string) => v.split('.').map((p) => parseInt(p, 10) || 0)
  const cmp = (a: number[], b: number[]) => {
    for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0)
    return 0
  }
  const v = num(version)
  return range
    .trim()
    .split(/\s+/)
    .every((part) => {
      const m = /^(>=|<=|>|<|=)?v?(\d+(?:\.\d+){0,2})$/.exec(part)
      if (!m) return false
      const c = cmp(v, num(m[2]!))
      return { '>=': c >= 0, '<=': c <= 0, '>': c > 0, '<': c < 0, '=': c === 0 }[m[1] ?? '=']!
    })
}

export interface InstalledPlugin {
  info: PluginInfo
  error: string | null
}

/** What a plugin module's default export receives. Documented in docs/PLUGINS.md; only add to it. */
export const pluginApi = {
  apiVersion: PLUGIN_API_VERSION,
  React,
  useDocument,
  useProjectStore,
  openComponent,
  confirmDialog,
  promptDialog,
  RichTextEditor,
  newId,
  // v0.18 Hotwheel (additions to API 1)
  useHotwheel,
  addHotwheelAction,
  openHotwheel,
  // v0.28 pictures between tools (additions to API 1)
  SendMenu,
  sendImageTo,
  addImageTarget,
  useIntentHandler,
  useAssetUrl,
}

export type PluginApi = typeof pluginApi

interface PluginModule {
  default: (api: PluginApi) => { View: React.ComponentType<PanelProps> }
}

export const usePlugins = create<{ installed: InstalledPlugin[] }>()(() => ({ installed: [] }))

export const pluginType = (id: string): PluginComponentType => `plugin.${id}`

async function pluginsDir() {
  const fs = getFs()
  return fs.join(await fs.appDataDir(), 'plugins')
}

/** Throws with a readable message when plugin.json is not usable. */
export function validateInfo(raw: unknown): PluginInfo {
  const info = raw as Partial<PluginInfo>
  if (!info || typeof info !== 'object') throw new Error('plugin.json is not an object.')
  if (typeof info.id !== 'string' || !PLUGIN_ID_PATTERN.test(info.id)) throw new Error('plugin.json needs an "id" of lowercase letters, digits and dashes.')
  if (typeof info.name !== 'string' || !info.name.trim()) throw new Error('plugin.json needs a "name".')
  if (typeof info.version !== 'string') throw new Error('plugin.json needs a "version".')
  if (info.apiVersion !== PLUGIN_API_VERSION) throw new Error(`This plugin is made for plugin API ${info.apiVersion}; this app supports ${PLUGIN_API_VERSION}.`)
  for (const f of [info.main, info.style]) if (f !== undefined && (typeof f !== 'string' || !isSafeEntryPath(f))) throw new Error('plugin.json has an invalid file name.')
  if (info.permissions !== undefined && (!Array.isArray(info.permissions) || info.permissions.some((p) => !PLUGIN_PERMISSIONS.includes(p))))
    throw new Error(`plugin.json "permissions" can only list ${PLUGIN_PERMISSIONS.join(', ')}.`)
  if (info.needsApp !== undefined && typeof info.needsApp !== 'string') throw new Error('plugin.json "needsApp" must be text like ">=0.35".')
  return info as PluginInfo
}

async function loadPlugin(dir: string, info: PluginInfo) {
  const fs = getFs()
  const type = pluginType(info.id)
  const code = await fs.readText(await fs.join(dir, ...(info.main ?? 'index.js').split('/')))
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  try {
    const mod = (await import(/* @vite-ignore */ url)) as PluginModule
    const { View } = mod.default(pluginApi)
    if (!View) throw new Error('The plugin did not return a View.')
    if (info.style) {
      document.getElementById(`plugin-style-${info.id}`)?.remove()
      const el = document.createElement('style')
      el.id = `plugin-style-${info.id}`
      el.textContent = await fs.readText(await fs.join(dir, ...info.style.split('/')))
      document.head.appendChild(el)
    }
    registerPluginManifest({
      type,
      name: info.name,
      description: info.description ?? '',
      icon: Puzzle,
      specSection: 'Plugin',
      multiDocument: true,
      newDocumentTitle: `Untitled ${info.name}`,
      View: React.lazy(async () => ({ default: View })),
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

const getAppVersion = () => import('@tauri-apps/api/app').then((m) => m.getVersion()).catch(() => '')

/** Load every installed plugin; a broken plugin is listed with its error and skipped. */
export async function loadAllPlugins() {
  const fs = getFs()
  const root = await pluginsDir()
  if (!(await fs.exists(root))) return
  const installed: InstalledPlugin[] = []
  for (const entry of await fs.list(root)) {
    if (!entry.isDirectory) continue
    const dir = await fs.join(root, entry.name)
    let info: PluginInfo | null = null
    try {
      info = validateInfo(JSON.parse(await fs.readText(await fs.join(dir, 'plugin.json'))))
      if (info.needsApp) {
        const app = await getAppVersion()
        if (app && !appVersionFits(info.needsApp, app)) throw new Error(`Made for app version ${info.needsApp}; this is ${app}. Look for a newer version of the plugin.`)
      }
      await loadPlugin(dir, info)
      installed.push({ info, error: null })
    } catch (e) {
      installed.push({ info: info ?? { id: entry.name, name: entry.name, version: '?', apiVersion: 0 }, error: (e as Error).message })
    }
  }
  usePlugins.setState({ installed })
}

export interface PluginPackage {
  info: PluginInfo
  /** Paths relative to the plugin folder. */
  files: Record<string, Uint8Array>
}

/** Unpack and check a plugin zip without installing it. plugin.json may sit at the top or in one folder (GitHub zips). */
export function readPluginZip(bytes: Uint8Array, source: string): PluginPackage {
  let all: Record<string, Uint8Array>
  try {
    all = unzipSync(bytes, { filter: (f) => !f.name.endsWith('/') })
  } catch {
    throw new Error('This is not a valid zip file.')
  }
  const names = Object.keys(all)
  const manifest = names.find((n) => n === 'plugin.json') ?? names.find((n) => /^[^/]+\/plugin\.json$/.test(n))
  if (!manifest) throw new Error('No plugin.json found. Is this an Eve.Lopment Games Designer plugin?')
  const prefix = manifest.slice(0, -'plugin.json'.length)
  const files: Record<string, Uint8Array> = {}
  for (const name of names) {
    if (!name.startsWith(prefix)) continue
    const rel = name.slice(prefix.length)
    if (!isSafeEntryPath(rel)) throw new Error(`Unsafe path in plugin: ${name}`)
    files[rel] = all[name]
  }
  const info = validateInfo(JSON.parse(new TextDecoder().decode(files['plugin.json'])))
  if (!files[info.main ?? 'index.js']) throw new Error(`The plugin file ${info.main ?? 'index.js'} is missing.`)
  return { info: { ...info, source }, files }
}

/** Write a checked package to the plugins folder (replacing an older version) and load it. */
export async function installPlugin(pkg: PluginPackage) {
  const fs = getFs()
  const dir = await fs.join(await pluginsDir(), pkg.info.id)
  if (await fs.exists(dir)) await fs.remove(dir)
  for (const [rel, data] of Object.entries(pkg.files)) {
    const path = await fs.join(dir, ...rel.split('/'))
    if (rel === 'plugin.json') continue
    if (/\.(js|mjs|css|json|md|txt)$/i.test(rel)) await fs.writeTextAtomic(path, new TextDecoder().decode(data))
    else await fs.writeBinaryAtomic(path, data)
  }
  await fs.writeTextAtomic(await fs.join(dir, 'plugin.json'), JSON.stringify(pkg.info, null, 2))
  await loadAllPluginsAfterChange()
}

export async function uninstallPlugin(id: string) {
  const fs = getFs()
  await fs.remove(await fs.join(await pluginsDir(), id))
  unregisterPluginManifest(pluginType(id))
  document.getElementById(`plugin-style-${id}`)?.remove()
  usePlugins.setState((s) => ({ installed: s.installed.filter((p) => p.info.id !== id) }))
}

async function loadAllPluginsAfterChange() {
  for (const p of usePlugins.getState().installed) unregisterPluginManifest(pluginType(p.info.id))
  await loadAllPlugins()
}

/** `https://github.com/owner/repo` (with or without .git, a trailing slash or a subpath) -> owner and repo. */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i.exec(url.trim())
  return m ? { owner: m[1], repo: m[2] } : null
}

export async function downloadFromGitHub(url: string): Promise<PluginPackage> {
  const repo = parseGitHubUrl(url)
  if (!repo) throw new Error('Enter a GitHub repository link like https://github.com/name/plugin.')
  const bytes = new Uint8Array(await invoke<ArrayBuffer>('plugin_download', repo))
  return readPluginZip(bytes, `https://github.com/${repo.owner}/${repo.repo}`)
}
