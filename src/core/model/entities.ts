import type { Id } from './ids'
import type { ComponentType } from './components'

/**
 * Entities (spec 3.3): records that live once per project in
 * `entities/<collection>.json` and are referenced by ID from anywhere.
 */
export type EntityType = 'item' | 'character' | 'town' | 'enemy'

export const ENTITY_TYPES: readonly EntityType[] = ['item', 'character', 'town', 'enemy']

/** File name (without .json) under `entities/` for each entity type. */
export const ENTITY_COLLECTION: Record<EntityType, string> = {
  item: 'items',
  character: 'characters',
  town: 'towns',
  enemy: 'enemies',
}

/** Value stored for a category on an entity; shape depends on Category.kind. */
export type CategoryValue = string | number | boolean | null

/** A path relative to the project folder, e.g. `assets/images/<id>.png`. */
export type AssetPath = string

export interface EntityBase {
  id: Id
  name: string
  description: string
  notes: string
  /** null = show the pink/black checkerboard placeholder (IT-2). */
  image: AssetPath | null
  /** Keyed by Category id. */
  categories: Record<Id, CategoryValue>
  /** v0.12: links made by hand on the entry page ("Link to…"), to any entry or tool document. */
  connections?: LinkTarget[]
  /** v0.16: an animated sprite from a Pixel Art file (and the tag that plays), shown instead of the picture. */
  sprite?: { doc: Id; tag?: Id } | null
  createdAt: string
  updatedAt: string
}

/** Something a link or a jump can point at: an entry, or a tool with one of its documents (null = the tool's only one). */
export type LinkTarget = { kind: 'entity'; type: EntityType; id: Id } | { kind: 'document'; type: ComponentType; documentId: Id | null }

/** Named numbers that calculators can read (IT-9, EN-3). */
export type StatBlock = Record<string, number>

export interface Item extends EntityBase {
  type: 'item'
  stats: StatBlock
}

/** A link from one entity to another, e.g. "Mother of" -> Aria (CH-5). */
export interface EntityLink {
  id: Id
  label: string
  targetType: EntityType
  targetId: Id
}

export interface Character extends EntityBase {
  type: 'character'
  links: EntityLink[]
}

export interface Town extends EntityBase {
  type: 'town'
  links: EntityLink[]
}

export interface DropRow {
  id: Id
  itemId: Id
  amountMin: number
  amountMax: number
  /** 0..100 */
  chancePercent: number
}

/** Stat growth per level, shared with the Level Calculator (LV-3, EN-3). */
export interface StatGrowth {
  stat: string
  mode: 'flat' | 'percent'
  perLevel: number
}

export interface Enemy extends EntityBase {
  type: 'enemy'
  levelMin: number
  levelMax: number
  stats: StatBlock
  growth: StatGrowth[]
  /** Element or type name -> damage multiplier (1 = neutral). */
  resistances: Record<string, number>
  dropTable: DropRow[]
  timeToDefeatSeconds: number | null
  respawnNote: string
  /** Town ids where the enemy appears (EN-6). */
  foundIn: Id[]
}

export type Entity = Item | Character | Town | Enemy

export type EntityOf<T extends EntityType> = Extract<Entity, { type: T }>

/** Custom categories / associations, shared by every entity type (3.4). */
export type CategoryKind = 'dropdown' | 'text' | 'number' | 'boolean'

export type CategoryScope = { mode: 'all' } | { mode: 'selected'; ids: Id[] } | { mode: 'none' }

/** How one dropdown option looks (v0.6 rarities): stored per option name. */
export interface OptionStyle {
  /** User content color, e.g. '#f5a623'. */
  color: string
  border: 'none' | 'solid' | 'double' | 'glow'
  /** One of the icon names in shared/categories/styles.tsx, or null. */
  icon: string | null
  /** Rating, e.g. 1 to 5 stars or any number like 4.5; null = none. */
  rating?: number | null
  /** Your own picture as the icon (`assets/images/<uuid>.png`); wins over `icon`. */
  image?: AssetPath | null
  /** Values of the category's own fields (`Category.fields`), keyed by field id. */
  values?: Record<Id, string | number | null>
}

/** A field every option of a styled category has, e.g. "Drop rate %" or "Sell multiplier". */
export interface StyleField {
  id: Id
  name: string
  kind: 'number' | 'text'
}

/** How a styled category shows its options (the Rarities window). */
export interface StyleDisplay {
  /** Frame cards and pictures with the option's border. */
  borders: boolean
  /** Show each option's rating as stars, as a number, or not at all. */
  rating: 'none' | 'stars' | 'number'
}

export interface Category {
  id: Id
  name: string
  kind: CategoryKind
  /** Only used when kind === 'dropdown'. */
  options: string[]
  /** Colors, borders and icons per option (dropdowns only). Missing = plain options. */
  styles?: Record<string, OptionStyle>
  /** Missing = borders on, no rating. */
  display?: StyleDisplay
  /** Your own fields for every option (rarity systems), shown on pages and in the wiki. */
  fields?: StyleField[]
  /** Which entities show this category, per entity type (IT-5). */
  appliesTo: Partial<Record<EntityType, CategoryScope>>
  builtIn: boolean
}
