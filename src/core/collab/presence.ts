import type { Awareness } from 'y-protocols/awareness'
import { create } from 'zustand'
import type { LayoutNode, Panel } from '../model'
import { panelKey, useAppStore, useProjectStore } from '../state'

/**
 * Presence: what teammates are doing right now (never saved). Each device
 * publishes `user`, `location` (the panel it works in), and per canvas or
 * a `pointer` and `selection`; text editors use `cursor` (y-prosemirror carets), all tagged with a panel key.
 */
export interface Point {
  x: number
  y: number
}

export interface RemotePresence {
  clientId: number
  id: string
  name: string
  color: string
  /** Panel key of the active panel, e.g. `brainstorm/<id>`. */
  location: string | null
  pointer: { key: string; x: number; y: number } | null
  selection: { key: string; ids: string[] } | null
  /** One artist at a time (Draw): the drawing this device holds, since when, and its last stroke (ms). */
  drawing: DrawingHold | null
  /** Asking the holder of this drawing to let go. */
  drawRequest: { key: string; at: number } | null
}

export interface DrawingHold {
  key: string
  since: number
  lastStroke: number
}

interface PresenceState {
  remotes: RemotePresence[]
}

export const usePresence = create<PresenceState>()(() => ({ remotes: [] }))

let awareness: Awareness | null = null
let stopWatching: (() => void) | null = null

/** Called by the controller when a shared project goes online or offline. */
export function attachPresence(next: Awareness | null) {
  stopWatching?.()
  stopWatching = null
  awareness = next
  if (!next) {
    usePresence.setState({ remotes: [] })
    return
  }
  const refresh = () => usePresence.setState({ remotes: readRemotes(next) })
  next.on('change', refresh)
  const unsubApp = useAppStore.subscribe(publishLocation)
  const unsubProject = useProjectStore.subscribe((s, prev) => {
    if (s.meta?.layout !== prev.meta?.layout) publishLocation()
  })
  publishLocation()
  refresh()
  stopWatching = () => {
    next.off('change', refresh)
    unsubApp()
    unsubProject()
  }
}

function readRemotes(a: Awareness): RemotePresence[] {
  const out: RemotePresence[] = []
  a.getStates().forEach((state, clientId) => {
    if (clientId === a.clientID) return
    const user = state.user as { id?: string; name?: string; color?: string } | undefined
    if (!user?.id) return
    out.push({
      clientId,
      id: user.id,
      name: user.name || 'Someone',
      color: user.color || '#888',
      location: typeof state.location === 'string' ? state.location : null,
      pointer: (state.pointer as RemotePresence['pointer']) ?? null,
      selection: (state.selection as RemotePresence['selection']) ?? null,
      drawing: (state.drawing as DrawingHold) ?? null,
      drawRequest: (state.drawRequest as RemotePresence['drawRequest']) ?? null,
    })
  })
  return out
}

/** Publish a presence field (canvas pointer, selection) for teammates. No-op when not shared. */
export function setPresence(field: 'pointer' | 'selection' | 'drawing' | 'drawRequest', value: unknown) {
  if (!awareness) return
  const current = awareness.getLocalState()?.[field]
  if (JSON.stringify(current ?? null) === JSON.stringify(value ?? null)) return
  awareness.setLocalStateField(field, value)
}

/** This device's own presence id and published fields; null when not shared. */
export function localPresence(): { clientId: number; drawing: DrawingHold | null } | null {
  if (!awareness) return null
  return { clientId: awareness.clientID, drawing: (awareness.getLocalState()?.drawing as DrawingHold) ?? null }
}

export function isPresenceActive() {
  return awareness !== null
}

function publishLocation() {
  if (!awareness) return
  const { activePanelId } = useAppStore.getState()
  const panel = findPanel(useProjectStore.getState().meta?.layout ?? null, activePanelId)
  const location = panelKey(panel)
  if (awareness.getLocalState()?.location !== location) awareness.setLocalStateField('location', location)
}

function findPanel(node: LayoutNode | null, id: string | null): Panel | null {
  if (!node || !id) return null
  if (node.kind === 'panel') return node.panel.id === id ? node.panel : null
  return findPanel(node.first, id) ?? findPanel(node.second, id)
}

/** Teammates whose active panel shows this key (or any document of this component type). */
export function useTeammatesAt(key: string | null, wholeType = false): RemotePresence[] {
  const remotes = usePresence((s) => s.remotes)
  if (!key) return []
  return remotes.filter((r) => r.location && (r.location === key || (wholeType && r.location.split('/')[0] === key)))
}
