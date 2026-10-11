import type { ComponentType } from './components'
import type { AssetPath } from './entities'
import type { Id } from './ids'

/** Bump when a stored file shape changes, and add a migration in core/project/migrate.ts. */
export const SCHEMA_VERSION = 1

/** Every JSON file the app writes is wrapped like this (spec 2.1). */
export interface Versioned<T> {
  schemaVersion: number
  data: T
}

/** A document that a component owns, stored at `components/<type>/<id>.json`. */
export interface DocumentRef {
  id: Id
  type: ComponentType
  title: string
  createdAt: string
  updatedAt: string
}

/** An open panel in the tiling workspace. documentId is null for single-document components. */
export interface Panel {
  id: Id
  type: ComponentType
  documentId: Id | null
}

export type SplitDirection = 'row' | 'column'

/** The tiling workspace is a binary tree of splits with panels at the leaves (ED-3). */
export type LayoutNode =
  | { kind: 'panel'; panel: Panel }
  | { kind: 'split'; direction: SplitDirection; ratio: number; first: LayoutNode; second: LayoutNode }

export interface ProjectMeta {
  id: Id
  name: string
  description: string
  enabledComponents: ComponentType[]
  /** Documents of multi-document components, listed in the sidebar (SB-4). */
  documents: DocumentRef[]
  layout: LayoutNode | null
  sidebarCollapsed: boolean
  /** Per-project colors and wallpaper; missing means the app defaults. */
  theme?: ProjectTheme
  /** v0.12: a font per tool (family name), chosen with Aa in the tool's header; missing = the app font. */
  fonts?: Partial<Record<ComponentType, string>>
  /** v0.13: starred tools, shown at the top of the sidebar in this order. */
  favorites?: ComponentType[]
  /** v0.13: a colour per tool in the sidebar, for organising. */
  toolColors?: Partial<Record<ComponentType, string>>
  /** v0.13: sidebar folders, each holding tools in its own order. */
  folders?: SidebarFolder[]
  /** v0.13: an optional picture for the project, shown on its card on the start screen. */
  image?: AssetPath | null
  createdAt: string
  updatedAt: string
}

/** Colors are CSS hex strings, null = theme default. Percentages are 0..100 unless noted. */
export interface ProjectTheme {
  accent: string | null
  background: string | null
  wallpaper: AssetPath | null
  /** Wallpaper blur in px. */
  blur: number
  dim: number
  /** 100 = unchanged. */
  contrast: number
  tint: string | null
  tintStrength: number
  /** How solid panels are over the wallpaper. */
  panelOpacity: number
}

export const DEFAULT_PROJECT_THEME: ProjectTheme = {
  accent: null,
  background: null,
  wallpaper: null,
  blur: 0,
  dim: 30,
  contrast: 100,
  tint: null,
  tintStrength: 25,
  panelOpacity: 80,
}

/** Summary shown on a launcher card (PM-2, PM-3). */
export interface ProjectStats {
  words: number
  images: number
}

/** An entry in the app-level recent projects list (PM-6). */
export interface RecentProject {
  path: string
  name: string
  description: string
  lastOpened: string
  stats: ProjectStats
  /** The project's picture (from its meta), so the start screen needn't open every project. */
  image?: string | null
}

/** A folder in the sidebar (v0.13). */
export interface SidebarFolder {
  id: Id
  name: string
  color?: string | null
  collapsed?: boolean
  tools: ComponentType[]
}
