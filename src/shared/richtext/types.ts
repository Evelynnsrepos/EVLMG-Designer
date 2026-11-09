import type { JSONContent } from '@tiptap/core'
import type { Id } from '@/core/model'

/**
 * A rich text document as stored on disk: TipTap/ProseMirror JSON.
 * Prose lives under `text` keys (counted by the project word counter); ids,
 * kinds and image paths live under ignored keys (`id`, `kind`, `src`, `type`).
 */
export type RichTextDoc = JSONContent

/**
 * What a `[[` link points at. `kind` is an entity type (`item`, `character`,
 * `town`, `enemy`) or a kind a consumer adds, such as `article` for the Wiki.
 * Only the id is stored, never the name (spec 3.3).
 */
export interface RefTarget {
  kind: string
  id: Id
}

/** A link target with its current display name, as shown in the `[[` menu. */
export interface RefItem extends RefTarget {
  label: string
  /** Small grey text next to the label, e.g. "Character". */
  hint?: string
  /** Text color, e.g. the entity's rarity color (v0.6). */
  color?: string
  /** 0.28: live values shown on a `![[Name]]` card, e.g. [["Damage", "12"]]. */
  details?: [string, string][]
}

/**
 * Where `[[` links come from and go to. The default provider covers entities;
 * the Wiki combines it with an article provider via `combineRefProviders`.
 */
export interface RefProvider {
  /** Items for the `[[` menu, best match first. */
  search(query: string): RefItem[]
  /** Current name for a stored link; undefined when the target was deleted. */
  resolve(target: RefTarget): RefItem | undefined
  /** Called when the user clicks a link. */
  open?(target: RefTarget): void
  /** Offer "Create ..." in the menu when nothing matches exactly (e.g. a new wiki article). */
  create?(label: string): RefItem | null | Promise<RefItem | null>
  /** Text of the create entry, default `Create "<label>"`. */
  createLabel?(label: string): string
}

/** Asks the user for an image; returns a project-relative asset path (or URL) to store. */
export type ImagePicker = () => Promise<{ src: string; alt?: string } | null>
