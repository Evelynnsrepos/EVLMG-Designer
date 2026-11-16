import { create } from 'zustand'
import type { ComponentType, EntityType, Id, LinkTarget } from '@/core/model'
import { useAppStore, useProjectStore } from '@/core/state'
import { openComponent, replaceWithComponent } from '@/shell/editor/actions'
import { leaves } from '@/shell/workspace/layoutTree'

/**
 * Cross-component requests about entities, so lists and the Wiki can hand each
 * other work without importing one another (AGENTS.md rule 3):
 *
 * - focus: "show this entity" — the list of that type selects it and opens its page.
 *
 * Use `openEntity(type, id)` to do both in one call. For "create a wiki article for this
 * entity" (CH-6, EN-7, WK-2) use `openWikiArticleForEntity` from `@/shared/wiki`.
 */
export interface EntityRequest {
  type: EntityType
  id: Id
  /** Increases on every request so asking twice for the same entity still fires. */
  seq: number
}

interface NavigationState {
  focus: EntityRequest | null
}

export const useEntityNavigation = create<NavigationState>()(() => ({ focus: null }))

let seq = 0

/** The component that lists each entity type. */
export const ENTITY_COMPONENT: Record<EntityType, ComponentType> = {
  item: 'item-list',
  character: 'character-list',
  town: 'town-list',
  enemy: 'enemy-list',
}

export function requestEntityFocus(type: EntityType, id: Id) {
  useEntityNavigation.setState({ focus: { type, id, seq: ++seq } })
}

/** Take the pending focus request for `type`, if any. */
export function takeEntityFocus(type: EntityType): EntityRequest | null {
  const focus = useEntityNavigation.getState().focus
  if (!focus || focus.type !== type) return null
  useEntityNavigation.setState({ focus: null })
  return focus
}

/** A place the user can jump to: an entity's page, or a tool with one of its documents. */
export type JumpTarget = LinkTarget

interface JumpHistory {
  back: JumpTarget[]
  forward: JumpTarget[]
}

/** Back/forward history of jumps, like a browser (Alt+Left / Alt+Right). */
export const useJumpHistory = create<JumpHistory>()(() => ({ back: [], forward: [] }))

const MAX_HISTORY = 50
/** The entity page each list shows right now, reported by the lists. */
const shown = new Map<EntityType, Id>()

/** Entity lists call this when their open page changes, so a jump knows where it came from. */
export function reportShownEntity(type: EntityType, id: Id | null) {
  if (id) shown.set(type, id)
  else shown.delete(type)
}

/** Where the user is now: the active panel, or the entity page open in it. */
function currentPlace(): JumpTarget | null {
  const { activePanelId } = useAppStore.getState()
  const panel = leaves(useProjectStore.getState().meta?.layout ?? null).find((p) => p.id === activePanelId)
  if (!panel) return null
  const entityType = (Object.keys(ENTITY_COMPONENT) as EntityType[]).find((t) => ENTITY_COMPONENT[t] === panel.type)
  const id = entityType && shown.get(entityType)
  if (entityType && id) return { kind: 'entity', type: entityType, id }
  return { kind: 'document', type: panel.type, documentId: panel.documentId }
}

const samePlace = (a: JumpTarget | null | undefined, b: JumpTarget | null | undefined) =>
  !!a && !!b && a.kind === b.kind && a.type === b.type && (a.kind === 'entity' ? a.id === (b as typeof a).id : a.documentId === (b as typeof a).documentId)

function show(target: JumpTarget, alone = false) {
  if (target.kind === 'entity') {
    requestEntityFocus(target.type, target.id)
    openComponent(ENTITY_COMPONENT[target.type])
  } else if (alone) void replaceWithComponent(target.type, target.documentId)
  else openComponent(target.type, target.documentId)
}

/**
 * Open any entity or tool document, remembering where the user came from so Back returns there.
 * `alone` shows a tool on its own, like a plain click in the sidebar (the Tool map does that).
 */
export function jumpTo(target: JumpTarget, alone = false) {
  const here = currentPlace()
  if (samePlace(here, target)) return show(target, alone)
  useJumpHistory.setState((h) => ({
    back: here && !samePlace(h.back.at(-1), here) ? [...h.back, here].slice(-MAX_HISTORY) : h.back,
    forward: [],
  }))
  show(target, alone)
}

function step(from: 'back' | 'forward') {
  const h = useJumpHistory.getState()
  const target = h[from].at(-1)
  if (!target) return
  const to = from === 'back' ? 'forward' : 'back'
  const here = currentPlace()
  useJumpHistory.setState({ [from]: h[from].slice(0, -1), [to]: here ? [...h[to], here] : h[to] } as Partial<JumpHistory>)
  show(target)
}

export const jumpBack = () => step('back')
export const jumpForward = () => step('forward')

/** Forget the history (another project was opened). */
export function clearJumpHistory() {
  shown.clear()
  useJumpHistory.setState({ back: [], forward: [] })
}

/** Open the list for `type` with this entity selected. */
export function openEntity(type: EntityType, id: Id) {
  jumpTo({ kind: 'entity', type, id })
}

/** Open a tool at one of its documents, remembering where the user came from. */
export function openDocument(type: ComponentType, documentId: Id | null = null) {
  jumpTo({ kind: 'document', type, documentId })
}
