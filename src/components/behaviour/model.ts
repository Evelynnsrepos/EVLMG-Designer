import { newId, type Id } from '@/core/model'
import { addNodes, createScene } from '@/shared/canvas/scene'
import type { BuiltinNode, ConnectorNode, NodeBase, Scene } from '@/shared/canvas/types'

/**
 * Behaviour Designer (missing tools phase 5): how an enemy, NPC or any other actor decides
 * what to do. States are boxes, arrows between them carry conditions (one or several, all or
 * any of them), checked in a set order. Groups hold states: an arrow out of a group leaves from
 * every state inside it (phases, "any state"), an arrow into a group enters its entry state.
 * Variables, own fields and own condition types make it fit any kind of game.
 * A daily routine strip is for actors who live by the clock.
 *
 * Every field added after the first version is optional, so older documents load unchanged.
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
  /** Values of the document's own fields (field id -> value). */
  values?: Record<Id, string | number>
  /** Variable changes when it enters this state. */
  onEnter?: VarChange[]
}

/** A box around states: a phase, a mode, a sub-behaviour. */
export interface GroupNode extends NodeBase {
  kind: 'bh-group'
  title: string
  width: number
  height: number
  /** The state an arrow into the group goes to; null = the top-left state inside. */
  entryId?: Id | null
}

export type CompareOp = '<' | '<=' | '=' | '!=' | '>=' | '>'
export const COMPARE_OPS: CompareOp[] = ['<', '<=', '=', '!=', '>=', '>']

export interface Variable {
  id: Id
  name: string
  initial: number
}
export interface VarChange {
  varId: Id
  op: 'set' | 'add'
  value: number
}
export interface OwnField {
  id: Id
  name: string
  kind: 'number' | 'text'
}
/** A condition type the user made, e.g. "Ammo is low" or "Card in hand". */
export interface OwnKind {
  id: Id
  label: string
  /** What the number means ("cards", "%"); empty = no number. */
  unit: string
}

/** Built-in condition types. `dist` marks the ones measured in the document's distance unit. */
export const CONDITION_KINDS = [
  { id: 'always', unit: '' },
  { id: 'sees', unit: 'dist' },
  { id: 'hears', unit: 'dist' },
  { id: 'lost', unit: 's' },
  { id: 'health', unit: '%' },
  { id: 'timer', unit: 's' },
  { id: 'time', unit: 'hour' },
  { id: 'arrived', unit: '' },
  { id: 'var', unit: '' },
  { id: 'flag', unit: '' },
  { id: 'custom', unit: '' },
] as const
export type BuiltinKind = (typeof CONDITION_KINDS)[number]['id']

export interface Condition {
  /** A built-in kind or the id of an own kind (kept under `mode`, a key the word counter skips). */
  mode: BuiltinKind | Id
  value: number
  flagId?: Id | null
  varId?: Id | null
  op?: CompareOp
  /** "is not": the condition is true when the check is false. */
  not?: boolean
  /** Own words for "Something else", or a note. */
  text: string
}

/** An arrow from a state or group to a state or group: the shared connector plus its conditions. */
export interface LinkNode extends ConnectorNode {
  /** First version: one condition. Still written (the first of `conds`) so older apps read something. */
  cond?: Condition
  conds?: Condition[]
  /** all = every condition must be true (and), any = one is enough (or). */
  join?: 'all' | 'any'
  /** Arrows out of the same state are checked from low to high; the first that is true wins. */
  priority?: number
}

export type BehaviourItem = StateNode | GroupNode | LinkNode | BuiltinNode

export interface RoutineBlock {
  id: Id
  /** HH:MM */
  from: string
  to: string
  place: string
  does: string
  /** Weekdays it happens on, 0 = Monday; missing or empty = every day. */
  days?: number[]
  /** The state it is in during this block. */
  stateId?: Id | null
}

export interface BehaviourDoc {
  scene: Scene<BehaviourItem>
  routine: RoutineBlock[]
  /** Enemies and characters that use this behaviour. */
  users: { type: 'enemy' | 'character'; id: Id }[]
  vars?: Variable[]
  fields?: OwnField[]
  kinds?: OwnKind[]
  /** Word for distances: m, tiles, px, squares… Default m. */
  distanceUnit?: string
}

export const isState = (n: NodeBase | undefined): n is StateNode => n?.kind === 'bh-state'
export const isGroup = (n: NodeBase | undefined): n is GroupNode => n?.kind === 'bh-group'
export const isLink = (n: NodeBase | undefined): n is LinkNode => n?.kind === 'connector'

export const STATE_W = 190
export const STATE_H = 78

export const newState = (layerId: Id, x: number, y: number, title = 'New state', does = ''): StateNode => ({ id: newId(), kind: 'bh-state', layerId, x, y, title, does, speed: null, abilityId: null })
export const newGroup = (layerId: Id, x: number, y: number, width = 480, height = 300, title = 'New group'): GroupNode => ({ id: newId(), kind: 'bh-group', layerId, x, y, width, height, title, entryId: null })

export const condsOf = (l: LinkNode): Condition[] => l.conds ?? (l.cond ? [l.cond] : [])

/** Words for describing conditions; the view passes the translated ones. */
export interface Words {
  always: string
  sees: string
  hears: string
  lost: string
  health: string
  timer: string
  time: string
  arrived: string
  flag: string
  flagSet: string
  custom: string
  not: string
  and: string
  or: string
  within: string
}
export const EN_WORDS: Words = {
  always: 'always',
  sees: 'sees the target',
  hears: 'hears a noise',
  lost: 'loses the target',
  health: 'health below',
  timer: 'after',
  time: 'at',
  arrived: 'reaches the spot',
  flag: 'a flag',
  flagSet: 'is set',
  custom: 'something else',
  not: 'not',
  and: 'and',
  or: 'or',
  within: 'within',
}

export interface DescribeCtx {
  words?: Words
  flagName?: (id: Id) => string
  varName?: (id: Id) => string
  kinds?: OwnKind[]
  distance?: string
}

export function describeCondition(c: Condition | undefined, ctx: DescribeCtx = {}): string {
  if (!c) return ''
  const w = ctx.words ?? EN_WORDS
  const dist = ctx.distance || 'm'
  const text = ((): string => {
    switch (c.mode) {
      case 'always':
        return w.always
      case 'sees':
      case 'hears':
        return `${w[c.mode]}${c.value ? ` ${w.within} ${c.value} ${dist}` : ''}`
      case 'lost':
        return `${w.lost}${c.value ? ` (${c.value} s)` : ''}`
      case 'health':
        return `${w.health} ${c.value}%`
      case 'timer':
        return `${w.timer} ${c.value} s`
      case 'time':
        return `${w.time} ${String(Math.floor(c.value)).padStart(2, '0')}:00`
      case 'arrived':
        return w.arrived
      case 'flag':
        return c.flagId && ctx.flagName ? `${ctx.flagName(c.flagId)} ${w.flagSet}` : `${w.flag} ${w.flagSet}`
      case 'var':
        return `${c.varId && ctx.varName ? ctx.varName(c.varId) : '?'} ${c.op ?? '>='} ${c.value}`
      case 'custom':
        return c.text || w.custom
      default: {
        const k = ctx.kinds?.find((x) => x.id === c.mode)
        if (!k) return c.text || w.custom
        return k.unit ? `${k.label} ${c.value} ${k.unit}` : k.label
      }
    }
  })()
  return c.not ? `${w.not} ${text}` : text
}

export function describeLink(l: Pick<LinkNode, 'cond' | 'conds' | 'join'>, ctx: DescribeCtx = {}): string {
  const cs = condsOf(l as LinkNode)
  const w = ctx.words ?? EN_WORDS
  if (!cs.length) return w.always
  return cs.map((c) => describeCondition(c, ctx)).join(` ${l.join === 'any' ? w.or : w.and} `)
}

/** A new arrow out of `fromId`, checked after the ones already there. */
export function link(scene: Scene<BehaviourItem>, layerId: Id, fromId: Id, toId: Id, conds: Condition[], join: 'all' | 'any' = 'all'): LinkNode {
  const priority = Math.max(-1, ...scene.nodes.filter(isLink).filter((l) => l.fromId === fromId).map((l) => l.priority ?? 0)) + 1
  return { id: newId(), kind: 'connector', layerId, x: 0, y: 0, fromId, toId, conds, cond: conds[0], join, priority, label: describeLink({ conds, join }) }
}

/** The example a new behaviour starts with: a creature that idles, follows noises and chases. */
export function createBehaviourDoc(): BehaviourDoc {
  let scene = createScene<BehaviourItem>()
  const L = scene.layers[0].id
  const noises: Variable = { id: newId(), name: 'noises_heard', initial: 0 }
  const vn = (id: Id) => (id === noises.id ? noises.name : id)
  const idle = { ...newState(L, 0, 0, 'Idle', 'Stands still, groans now and then'), start: true }
  const wander = newState(L, 0, 260, 'Wander', 'Shuffles around slowly')
  const hear: StateNode = { ...newState(L, 400, -170, 'Go to noise', 'Walks to where the sound came from'), onEnter: [{ varId: noises.id, op: 'add', value: 1 }] }
  const chase = newState(L, 800, 0, 'Chase', 'Runs at the target')
  const attack = newState(L, 1200, 0, 'Attack', 'Bites and grabs')
  const search = newState(L, 800, 260, 'Search', 'Looks around the last place it saw the target')
  scene = addNodes(scene, [idle, wander, hear, chase, attack, search])
  const add = (from: Id, to: Id, conds: Condition[], join: 'all' | 'any' = 'all') => {
    const l = link(scene, L, from, to, conds, join)
    scene = addNodes(scene, [{ ...l, label: describeLink(l, { varName: vn }) }])
  }
  add(idle.id, chase.id, [{ mode: 'sees', value: 10, text: '' }])
  add(idle.id, hear.id, [{ mode: 'hears', value: 20, text: '' }])
  add(idle.id, wander.id, [{ mode: 'timer', value: 10, text: '' }])
  add(wander.id, idle.id, [{ mode: 'timer', value: 20, text: '' }])
  add(hear.id, chase.id, [{ mode: 'sees', value: 15, text: '' }, { mode: 'var', varId: noises.id, op: '>=', value: 3, text: '' }], 'any')
  add(hear.id, idle.id, [{ mode: 'arrived', value: 0, text: '' }])
  add(chase.id, attack.id, [{ mode: 'custom', value: 0, text: 'close enough to bite' }])
  add(attack.id, chase.id, [{ mode: 'custom', value: 0, text: 'target steps away' }])
  add(chase.id, search.id, [{ mode: 'lost', value: 3, text: '' }])
  add(search.id, chase.id, [{ mode: 'sees', value: 15, text: '' }])
  add(search.id, idle.id, [{ mode: 'timer', value: 15, text: '' }])
  return { scene, routine: [], users: [], vars: [noises], fields: [], kinds: [], distanceUnit: 'm' }
}

export const statesOf = (s: Scene<BehaviourItem>) => s.nodes.filter(isState)
export const groupsOf = (s: Scene<BehaviourItem>) => s.nodes.filter(isGroup)

const inside = (g: GroupNode, st: StateNode) => {
  const cx = st.x + STATE_W / 2
  const cy = st.y + STATE_H / 2
  return cx >= g.x && cx <= g.x + g.width && cy >= g.y && cy <= g.y + g.height
}
/** States whose middle is inside the group's box (groups can sit inside each other). */
export const statesIn = (s: Scene<BehaviourItem>, g: GroupNode) => statesOf(s).filter((st) => inside(g, st))
export const groupsAround = (s: Scene<BehaviourItem>, st: StateNode) => groupsOf(s).filter((g) => inside(g, st))

const byPriority = (a: LinkNode, b: LinkNode) => (a.priority ?? 0) - (b.priority ?? 0)
/** Arrows leaving this exact node (state or group), in the order they are checked. */
export const linksFrom = (s: Scene<BehaviourItem>, id: Id) => s.nodes.filter(isLink).filter((l) => l.fromId === id).sort(byPriority)

/** Every arrow that can take a state somewhere: its own first, then those of the groups around it (innermost first). */
export function outgoing(s: Scene<BehaviourItem>, stateId: Id): LinkNode[] {
  const st = statesOf(s).find((x) => x.id === stateId)
  if (!st) return []
  const groups = groupsAround(s, st).sort((a, b) => a.width * a.height - b.width * b.height)
  return [...linksFrom(s, stateId), ...groups.flatMap((g) => linksFrom(s, g.id))]
}

/** The state an arrow ends in: the state itself, or the entry of a group. */
export function resolveTarget(s: Scene<BehaviourItem>, id: Id): Id | null {
  const n = s.nodes.find((x) => x.id === id)
  if (isState(n)) return n.id
  if (!isGroup(n)) return null
  const members = statesIn(s, n)
  if (n.entryId && members.some((m) => m.id === n.entryId)) return n.entryId
  return [...members].sort((a, b) => a.y - b.y || a.x - b.x)[0]?.id ?? null
}

/** States that can't be reached from the start state, and states with no way out. */
export function checkGraph(s: Scene<BehaviourItem>): { unreachable: Id[]; deadEnds: Id[]; startId: Id | null } {
  const states = statesOf(s)
  const start = states.find((x) => x.start) ?? states[0]
  if (!start) return { unreachable: [], deadEnds: [], startId: null }
  const seen = new Set([start.id])
  const queue = [start.id]
  while (queue.length) {
    for (const l of outgoing(s, queue.shift()!)) {
      const to = resolveTarget(s, l.toId)
      if (to && !seen.has(to)) (seen.add(to), queue.push(to))
    }
  }
  const leaves = (x: StateNode) => outgoing(s, x.id).some((l) => {
    const to = resolveTarget(s, l.toId)
    return to !== null && to !== x.id
  })
  return {
    startId: start.id,
    unreachable: states.filter((x) => !seen.has(x.id)).map((x) => x.id),
    deadEnds: states.filter((x) => !leaves(x)).map((x) => x.id),
  }
}

export const initialValues = (d: BehaviourDoc): Record<Id, number> => Object.fromEntries((d.vars ?? []).map((v) => [v.id, v.initial]))

export function applyEnter(st: StateNode | undefined, values: Record<Id, number>): Record<Id, number> {
  const next = { ...values }
  for (const c of st?.onEnter ?? []) next[c.varId] = c.op === 'set' ? c.value : (next[c.varId] ?? 0) + c.value
  return next
}

export function compare(a: number, op: CompareOp, b: number): boolean {
  switch (op) {
    case '<':
      return a < b
    case '<=':
      return a <= b
    case '=':
      return a === b
    case '!=':
      return a !== b
    case '>=':
      return a >= b
    case '>':
      return a > b
  }
}

/** For Try it: true/false for variable checks and "always", null where the person trying has to decide. */
export function evalCondition(c: Condition, values: Record<Id, number>): boolean | null {
  let r: boolean | null = null
  if (c.mode === 'always') r = true
  else if (c.mode === 'var' && c.varId) r = compare(values[c.varId] ?? 0, c.op ?? '>=', c.value)
  if (r === null) return null
  return c.not ? !r : r
}
/** All known: the result; some unknown: null (unless "any" already has a true one or "all" a false one). */
export function evalLink(l: LinkNode, values: Record<Id, number>): boolean | null {
  const rs = condsOf(l).map((c) => evalCondition(c, values))
  if (!rs.length) return true
  if (l.join === 'any') return rs.includes(true) ? true : rs.includes(null) ? null : false
  return rs.includes(false) ? false : rs.includes(null) ? null : true
}

/** Minutes since midnight for HH:MM; NaN when malformed. */
export const minutesOf = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t)
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN
}
export const hhmm = (minutes: number) => {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
export const onDay = (b: RoutineBlock, day: number | null) => day === null || !b.days?.length || b.days.includes(day)

/** A block moved by `dm` minutes (move), or with its end moved (end); snaps to 15 minutes. */
export function shiftBlock(b: RoutineBlock, dm: number, mode: 'move' | 'end'): RoutineBlock {
  const snap = Math.round(dm / 15) * 15
  if (mode === 'end') {
    const len = (((minutesOf(b.to) - minutesOf(b.from)) % 1440) + 1440) % 1440 || 1440
    return { ...b, to: hhmm(minutesOf(b.from) + Math.min(1440, Math.max(15, len + snap))) }
  }
  return { ...b, from: hhmm(minutesOf(b.from) + snap), to: hhmm(minutesOf(b.to) + snap) }
}

/**
 * The behaviour as a plain state machine for the engine export: names next to ids, transitions in
 * the order to check them, conditions with their type and values.
 */
export function toStateMachine(d: BehaviourDoc, flagName: (id: Id) => string = (id) => id) {
  const s = d.scene
  const states = statesOf(s)
  const groups = groupsOf(s)
  const varName = (id: Id) => d.vars?.find((v) => v.id === id)?.name ?? id
  const fieldName = (id: Id) => d.fields?.find((f) => f.id === id)?.name ?? id
  const nameOf = (id: Id) => (s.nodes.find((n) => n.id === id) as StateNode | GroupNode | undefined)?.title ?? id
  const isEnd = (id: Id) => {
    const n = s.nodes.find((x) => x.id === id)
    return isState(n) || isGroup(n)
  }
  return {
    start: checkGraph(s).startId,
    distanceUnit: d.distanceUnit || 'm',
    variables: (d.vars ?? []).map((v) => ({ uid: v.id, name: v.name, initial: v.initial })),
    fields: (d.fields ?? []).map((f) => ({ uid: f.id, name: f.name, kind: f.kind })),
    conditionTypes: (d.kinds ?? []).map((k) => ({ uid: k.id, name: k.label, unit: k.unit })),
    states: states.map((st) => ({
      uid: st.id,
      name: st.title,
      does: st.does,
      speed: st.speed,
      ability: st.abilityId,
      groups: groupsAround(s, st).map((x) => x.id),
      fields: Object.fromEntries(Object.entries(st.values ?? {}).map(([k, v]) => [fieldName(k), v])),
      onEnter: (st.onEnter ?? []).map((c) => ({ variable: varName(c.varId), op: c.op, value: c.value })),
    })),
    groups: groups.map((x) => ({ uid: x.id, name: x.title, entry: resolveTarget(s, x.id), states: statesIn(s, x).map((m) => m.id) })),
    transitions: s.nodes
      .filter(isLink)
      .filter((l) => isEnd(l.fromId) && resolveTarget(s, l.toId) !== null)
      .sort(byPriority)
      .map((l) => ({
        uid: l.id,
        from: l.fromId,
        fromName: nameOf(l.fromId),
        fromGroup: groups.some((x) => x.id === l.fromId),
        to: resolveTarget(s, l.toId),
        toName: nameOf(l.toId),
        priority: l.priority ?? 0,
        join: l.join ?? 'all',
        conditions: condsOf(l).map((c) => ({
          type: (d.kinds ?? []).find((k) => k.id === c.mode)?.label ?? c.mode,
          value: c.value,
          not: !!c.not,
          ...(c.mode === 'var' ? { variable: c.varId ? varName(c.varId) : null, op: c.op ?? '>=' } : {}),
          ...(c.mode === 'flag' ? { flag: c.flagId ? flagName(c.flagId) : null } : {}),
          ...(c.text ? { text: c.text } : {}),
        })),
        text: describeLink(l, { flagName, varName, kinds: d.kinds, distance: d.distanceUnit }),
      })),
    routine: d.routine.map((b) => ({ from: b.from, to: b.to, place: b.place, does: b.does, days: b.days?.length ? b.days : null, state: b.stateId ?? null })),
    users: d.users.map((u) => ({ type: u.type, uid: u.id })),
  }
}

/** Move the arrow at place `i` among those leaving `fromId` one step earlier (-1) or later (1); renumbers them 0, 1, 2… */
export function reorder(s: Scene<BehaviourItem>, fromId: Id, i: number, by: -1 | 1): Scene<BehaviourItem> {
  const list = linksFrom(s, fromId)
  const j = i + by
  if (!list[i] || !list[j]) return s
  ;[list[i], list[j]] = [list[j], list[i]]
  const at = new Map(list.map((l, k) => [l.id, k]))
  return { ...s, nodes: s.nodes.map((n) => (at.has(n.id) ? { ...n, priority: at.get(n.id) } : n)) }
}
