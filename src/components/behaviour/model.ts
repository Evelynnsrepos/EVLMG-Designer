import { newId, type Id } from '@/core/model'
import { addNodes, createScene, type BuiltinNode, type ConnectorNode, type NodeBase, type Scene } from '@/shared/canvas'

/**
 * Behaviour Designer (missing tools phase 5): how an enemy or NPC decides what
 * to do. States are boxes (Idle, Chase, Search), arrows between them carry a
 * condition in plain words (sees the player, health below 30%). A daily
 * routine strip is for NPCs who live by the clock.
 */

export interface StateNode extends NodeBase {
  kind: 'bh-state'
  title: string
  /** What it does while in this state. */
  does: string
  /** Move speed while in it; null = not set. */
  speed: number | null
  /** An ability from Abilities & Spells it uses here. */
  abilityId: Id | null
  /** Where it starts. */
  start?: boolean
  fillColor?: string
}

export const CONDITION_KINDS = [
  { id: 'sees', label: 'Sees the player', unit: 'within m' },
  { id: 'hears', label: 'Hears a noise', unit: 'within m' },
  { id: 'lost', label: 'Loses sight of the player', unit: 'for s' },
  { id: 'health', label: 'Health below', unit: '%' },
  { id: 'timer', label: 'After some time', unit: 's' },
  { id: 'time', label: 'Time of day is', unit: 'hour' },
  { id: 'arrived', label: 'Reaches the spot', unit: '' },
  { id: 'flag', label: 'A flag is set', unit: '' },
  { id: 'custom', label: 'Something else', unit: '' },
] as const
export type ConditionKind = (typeof CONDITION_KINDS)[number]['id']

export interface Condition {
  /** Which kind of condition (kept under `mode`, a key the word counter skips). */
  mode: ConditionKind
  value: number
  flagId?: Id | null
  /** Own words for "Something else", or a note. */
  text: string
}

/** An arrow between two states: the shared connector plus its condition. */
export interface LinkNode extends ConnectorNode {
  cond?: Condition
}

export type BehaviourItem = StateNode | LinkNode | BuiltinNode

export interface RoutineBlock {
  id: Id
  /** HH:MM */
  from: string
  to: string
  place: string
  does: string
}

export interface BehaviourDoc {
  scene: Scene<BehaviourItem>
  routine: RoutineBlock[]
  /** Enemies and characters that use this behaviour. */
  users: { type: 'enemy' | 'character'; id: Id }[]
}

export const isState = (n: NodeBase | undefined): n is StateNode => n?.kind === 'bh-state'
export const isLink = (n: NodeBase | undefined): n is LinkNode => n?.kind === 'connector'

export const STATE_W = 190
export const STATE_H = 78

export const newState = (layerId: Id, x: number, y: number, title = 'New state', does = ''): StateNode => ({ id: newId(), kind: 'bh-state', layerId, x, y, title, does, speed: null, abilityId: null })

export function describeCondition(c: Condition | undefined, flagName?: (id: Id) => string): string {
  if (!c) return ''
  const k = CONDITION_KINDS.find((x) => x.id === c.mode)
  switch (c.mode) {
    case 'sees':
    case 'hears':
      return `${k!.label.toLowerCase()}${c.value ? ` within ${c.value} m` : ''}`
    case 'lost':
      return `loses the player${c.value ? ` for ${c.value} s` : ''}`
    case 'health':
      return `health below ${c.value}%`
    case 'timer':
      return `after ${c.value} s`
    case 'time':
      return `at ${String(Math.floor(c.value)).padStart(2, '0')}:00`
    case 'arrived':
      return 'reaches the spot'
    case 'flag':
      return c.flagId && flagName ? `${flagName(c.flagId)} is set` : 'a flag is set'
    case 'custom':
      return c.text || 'something else'
  }
}

export const link = (layerId: Id, fromId: Id, toId: Id, cond: Condition): LinkNode => ({ id: newId(), kind: 'connector', layerId, x: 0, y: 0, fromId, toId, cond, label: describeCondition(cond) })

/** The zombie example a new behaviour starts with. */
export function createBehaviourDoc(): BehaviourDoc {
  let scene = createScene<BehaviourItem>()
  const L = scene.layers[0].id
  const idle = { ...newState(L, 0, 0, 'Idle', 'Stands still, groans now and then'), start: true }
  const wander = newState(L, 0, 260, 'Wander', 'Shuffles around slowly')
  const hear = newState(L, 400, -170, 'Go to noise', 'Walks to where the sound came from')
  const chase = newState(L, 800, 0, 'Chase', 'Runs at the player')
  const attack = newState(L, 1200, 0, 'Attack', 'Bites and grabs')
  const search = newState(L, 800, 260, 'Search', 'Looks around the last place it saw the player')
  scene = addNodes(scene, [idle, wander, hear, chase, attack, search])
  scene = addNodes(scene, [
    link(L, idle.id, wander.id, { mode: 'timer', value: 10, text: '' }),
    link(L, wander.id, idle.id, { mode: 'timer', value: 20, text: '' }),
    link(L, idle.id, hear.id, { mode: 'hears', value: 20, text: '' }),
    link(L, hear.id, chase.id, { mode: 'sees', value: 15, text: '' }),
    link(L, idle.id, chase.id, { mode: 'sees', value: 10, text: '' }),
    link(L, chase.id, attack.id, { mode: 'custom', value: 0, text: 'close enough to bite' }),
    link(L, attack.id, chase.id, { mode: 'custom', value: 0, text: 'player steps away' }),
    link(L, chase.id, search.id, { mode: 'lost', value: 3, text: '' }),
    link(L, search.id, chase.id, { mode: 'sees', value: 15, text: '' }),
    link(L, search.id, idle.id, { mode: 'timer', value: 15, text: '' }),
  ])
  return { scene, routine: [], users: [] }
}

export const statesOf = (s: Scene<BehaviourItem>) => s.nodes.filter(isState)
export const linksFrom = (s: Scene<BehaviourItem>, id: Id) => s.nodes.filter(isLink).filter((l) => l.fromId === id)

/** States that can't be reached from the start state, and states with no way out. */
export function checkGraph(s: Scene<BehaviourItem>): { unreachable: Id[]; deadEnds: Id[]; startId: Id | null } {
  const states = statesOf(s)
  const start = states.find((x) => x.start) ?? states[0]
  if (!start) return { unreachable: [], deadEnds: [], startId: null }
  const seen = new Set([start.id])
  const queue = [start.id]
  while (queue.length) for (const l of linksFrom(s, queue.shift()!)) if (!seen.has(l.toId)) (seen.add(l.toId), queue.push(l.toId))
  return {
    startId: start.id,
    unreachable: states.filter((x) => !seen.has(x.id)).map((x) => x.id),
    deadEnds: states.filter((x) => !linksFrom(s, x.id).some((l) => l.toId !== x.id)).map((x) => x.id),
  }
}

/** Minutes since midnight for HH:MM; NaN when malformed. */
export const minutesOf = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t)
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN
}
