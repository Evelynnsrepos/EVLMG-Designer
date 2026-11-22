import { newId, type Id } from '@/core/model'

/**
 * Skill / talent tree. Skills cost points per rank, need other skills first
 * and can need points spent in the tree. Since v0.35 the parts are general
 * building blocks: your own node types, several currencies, "needs N of
 * these", a grid where nodes open next to learned ones, and groups (classes,
 * jobs, weapons, branches) that rank up, teach skills and can carry skills
 * from other groups. The plan is a test build against the budgets.
 */

export interface Skill {
  id: Id
  name: string
  /** A node type id from the tree's types (active and passive by default). */
  kind: string
  /** Free text, e.g. "+5% crit chance per rank". */
  effect: string
  maxRank: number
  /** Cost per rank, in `currencyId` (none = the main points). */
  cost: number
  /** Skills that need at least one rank first. */
  requires: Id[]
  /** Points that must be spent in this tree before the first rank. */
  pointsNeeded: number
  image: string | null
  notes: string
  // ---- v0.35 (all optional) ----
  currencyId?: Id
  /** How many of `requires` are needed: 0 or missing = all, 1 = any one, N = N of them. */
  needCount?: number
  /** Character level needed first. */
  minLevel?: number
  /** Anything else it needs, in words (a key item, a quest). */
  needsText?: string
  /** Grid: free to start from. */
  start?: boolean
  /** Grid: the cell this node sits on. */
  cell?: { x: number; y: number }
  /** Taught by a group at `learnAt` rank instead of bought. */
  groupId?: Id
  learnAt?: number
  /** Other groups can carry it once learned. */
  carryable?: boolean
}

export interface NodeType {
  id: string
  label: string
  color: string
}

export interface Currency {
  id: Id
  name: string
  start: number
  perLevel: number
}

/** A class, job, weapon or branch that ranks up and teaches its skills. */
export interface SkillGroup {
  id: Id
  name: string
  color: string
  maxRank: number
  /** How it is unlocked, in words. */
  unlockNote: string
  /** Cost to unlock, in `unlockCurrencyId` (none = main points); 0 = free. */
  unlockCost: number
  unlockCurrencyId?: Id
  /** Other groups at a rank first. */
  requires: { groupId: Id; rank: number }[]
  /** Skills from other groups it can carry while active. */
  carrySlots: number
}

export interface SkillTreeDoc {
  skills: Skill[]
  /** Main points: at the start, plus `perLevel` for each level up to `level`. `unit` names them. */
  budget: { start: number; perLevel: number; level: number; unit?: string }
  /** Ranks put in per skill in the test build. */
  plan: Record<Id, number>
  // ---- v0.35 (all optional) ----
  layout?: 'tree' | 'grid'
  /** Grid: a node opens next to a learned one (off = only its links count). */
  gridOpensNext?: boolean
  types?: NodeType[]
  currencies?: Currency[]
  groups?: SkillGroup[]
  /** Only one group is active at a time (the others' skills need a carry slot). */
  oneGroupActive?: boolean
  /** Test build: rank per group, the active group and the skills it carries. */
  groupRanks?: Record<Id, number>
  activeGroup?: Id | null
  carried?: Id[]
}

export const DEFAULT_TYPES: NodeType[] = [
  { id: 'active', label: 'Active', color: '#e8590c' },
  { id: 'passive', label: 'Passive', color: '#3e8ef7' },
]
/** Kept for older imports. */
export const SKILL_KINDS = DEFAULT_TYPES

export const MAIN = '' // currency id of the main points

export const createSkillTreeDoc = (): SkillTreeDoc => ({ skills: [], budget: { start: 0, perLevel: 1, level: 30 }, plan: {} })

export const normalizeSkillTree = (d: Partial<SkillTreeDoc> | undefined): SkillTreeDoc => {
  const base = createSkillTreeDoc()
  return {
    ...base,
    ...d,
    budget: { ...base.budget, ...d?.budget },
    plan: { ...d?.plan },
    types: d?.types?.length ? d.types : DEFAULT_TYPES,
    currencies: d?.currencies ?? [],
    groups: d?.groups ?? [],
    groupRanks: { ...d?.groupRanks },
    carried: d?.carried ?? [],
  }
}

export const newSkill = (name = 'New skill'): Skill => ({
  id: newId(),
  name,
  kind: 'passive',
  effect: '',
  maxRank: 1,
  cost: 1,
  requires: [],
  pointsNeeded: 0,
  image: null,
  notes: '',
})
export const newGroup = (name = 'New group'): SkillGroup => ({ id: newId(), name, color: '#7048e8', maxRank: 10, unlockNote: '', unlockCost: 0, requires: [], carrySlots: 0 })
export const newCurrency = (name = 'New currency'): Currency => ({ id: newId(), name, start: 0, perLevel: 0 })
export const newType = (label = 'New type'): NodeType => ({ id: newId(), label, color: '#2f9e44' })

export const typeOf = (d: SkillTreeDoc, s: Skill) => (d.types ?? DEFAULT_TYPES).find((t) => t.id === s.kind)

/** Skills taught by a group rank are not bought. */
const bought = (s: Skill) => !s.groupId

export const currencyName = (d: SkillTreeDoc, id: Id | undefined) => (id ? d.currencies?.find((c) => c.id === id)?.name : undefined) ?? (d.budget.unit || 'points')

/** Budget of one currency at the planned level. */
export function totalOf(d: SkillTreeDoc, currencyId: Id = MAIN): number {
  const c = currencyId ? d.currencies?.find((x) => x.id === currencyId) : null
  const b = c ?? d.budget
  return Math.max(0, b.start + b.perLevel * d.budget.level)
}
export const totalPoints = (d: SkillTreeDoc) => totalOf(d, MAIN)

/** Spent of one currency: bought ranks plus unlocked groups. */
export function spentOf(d: SkillTreeDoc, currencyId: Id = MAIN): number {
  const ranks = d.skills.reduce((n, s) => n + (bought(s) && (s.currencyId ?? MAIN) === currencyId ? (d.plan[s.id] ?? 0) * s.cost : 0), 0)
  const groups = (d.groups ?? []).reduce((n, g) => n + ((d.groupRanks?.[g.id] ?? 0) > 0 && (g.unlockCurrencyId ?? MAIN) === currencyId ? g.unlockCost : 0), 0)
  return ranks + groups
}
/** Main points spent on ranks: what "points spent in the tree" counts. */
export const spent = (d: SkillTreeDoc) => d.skills.reduce((n, s) => n + (bought(s) ? (d.plan[s.id] ?? 0) * s.cost : 0), 0)

/** Cost to max out every bought skill, per currency name. */
export function fullTreeCost(d: SkillTreeDoc): string {
  const sums = new Map<string, number>()
  for (const s of d.skills) if (bought(s)) sums.set(currencyName(d, s.currencyId), (sums.get(currencyName(d, s.currencyId)) ?? 0) + s.maxRank * s.cost)
  return [...sums].map(([k, v]) => `${v} ${k}`).join(' + ') || '0 points'
}

/** Would `skill` requiring `other` make a loop? */
export function wouldLoop(skills: Skill[], skillId: Id, otherId: Id): boolean {
  const seen = new Set<Id>()
  const stack = [otherId]
  while (stack.length) {
    const id = stack.pop()!
    if (id === skillId) return true
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...(skills.find((s) => s.id === id)?.requires ?? []))
  }
  return false
}

const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1
const gridRule = (d: SkillTreeDoc) => d.layout === 'grid' && d.gridOpensNext !== false

/** Grid: ranked cells reachable from a start cell through ranked neighbours. */
function reachable(d: SkillTreeDoc, plan: Record<Id, number>): Set<Id> {
  const on = d.skills.filter((s) => s.cell && (plan[s.id] ?? 0) > 0 && bought(s))
  const seen = new Set(on.filter((s) => s.start).map((s) => s.id))
  const queue = on.filter((s) => seen.has(s.id))
  while (queue.length) {
    const s = queue.pop()!
    for (const o of on)
      if (!seen.has(o.id) && near(s.cell!, o.cell!)) {
        seen.add(o.id)
        queue.push(o)
      }
  }
  return seen
}

/** The first free grid cell, row by row, `width` cells wide. */
export function freeCell(skills: Skill[], width = 8): { x: number; y: number } {
  const used = new Set(skills.filter((s) => s.cell).map((s) => `${s.cell!.x},${s.cell!.y}`))
  for (let i = 0; ; i++) if (!used.has(`${i % width},${Math.floor(i / width)}`)) return { x: i % width, y: Math.floor(i / width) }
}

/** How many links a skill needs. */
export const needed = (s: Skill) => (s.needCount && s.needCount > 0 ? Math.min(s.needCount, s.requires.length) : s.requires.length)

/** Why a rank cannot be added, or null when it can. */
export function cannotAdd(d: SkillTreeDoc, id: Id): string | null {
  const s = d.skills.find((x) => x.id === id)
  if (!s) return 'Unknown skill'
  if (s.groupId) return `Learned at ${d.groups?.find((c) => c.id === s.groupId)?.name ?? 'its group'} rank ${Math.max(1, s.learnAt ?? 1)}`
  const rank = d.plan[id] ?? 0
  if (rank >= s.maxRank) return 'Already at max rank'
  const have = s.requires.filter((r) => d.plan[r] > 0).length
  if (have < needed(s)) {
    const missing = s.requires.filter((r) => !(d.plan[r] > 0)).map((r) => d.skills.find((x) => x.id === r)?.name ?? '?')
    const n = needed(s)
    return n === s.requires.length ? `Needs ${missing.join(', ')} first` : `Needs ${n - have} more of: ${missing.join(', ')}`
  }
  if (rank === 0 && s.minLevel && d.budget.level < s.minLevel) return `Needs level ${s.minLevel}`
  if (rank === 0 && gridRule(d) && !s.start && s.cell) {
    const live = reachable(d, d.plan)
    if (!d.skills.some((o) => o.cell && live.has(o.id) && near(o.cell, s.cell!))) return 'Needs a learned neighbour on the grid first'
  }
  if (rank === 0 && spent(d) < s.pointsNeeded) return `Needs ${s.pointsNeeded} points spent in the tree`
  const cur = s.currencyId ?? MAIN
  if (spentOf(d, cur) + s.cost > totalOf(d, cur)) return `Not enough ${currencyName(d, s.currencyId)}`
  return null
}

/** Why a rank cannot be taken back, or null when it can. */
export function cannotRemove(d: SkillTreeDoc, id: Id): string | null {
  const rank = d.plan[id] ?? 0
  if (rank === 0) return 'No ranks to take back'
  const s = d.skills.find((x) => x.id === id)!
  const after = { ...d, plan: { ...d.plan, [id]: rank - 1 } }
  if (rank === 1) {
    const dependent = d.skills.find((x) => x.requires.includes(id) && d.plan[x.id] > 0 && x.requires.filter((r) => after.plan[r] > 0).length < needed(x))
    if (dependent) return `${dependent.name} needs it`
    if (gridRule(d)) {
      const was = reachable(d, d.plan)
      const now = reachable(d, after.plan)
      const cut = d.skills.find((x) => x.id !== id && was.has(x.id) && !now.has(x.id))
      if (cut) return `${cut.name} would lose its path to a start cell`
    }
  }
  // Skills unlocked by points spent must still have enough spent before them.
  const left = spent(after)
  const blocked = d.skills.find((x) => x.id !== s.id && d.plan[x.id] > 0 && x.pointsNeeded > left - (d.plan[x.id] ?? 0) * x.cost)
  if (blocked) return `${blocked.name} needs ${blocked.pointsNeeded} points spent`
  return null
}

/** Why a group cannot gain a rank, or null. */
export function cannotRankGroup(d: SkillTreeDoc, id: Id): string | null {
  const g = d.groups?.find((x) => x.id === id)
  if (!g) return 'Unknown group'
  const rank = d.groupRanks?.[id] ?? 0
  if (rank >= g.maxRank) return 'Already at max rank'
  const missing = g.requires.filter((r) => (d.groupRanks?.[r.groupId] ?? 0) < r.rank)
  if (missing.length) return `Needs ${missing.map((r) => `${d.groups?.find((x) => x.id === r.groupId)?.name ?? '?'} rank ${r.rank}`).join(', ')} first`
  const cur = g.unlockCurrencyId ?? MAIN
  if (rank === 0 && g.unlockCost > 0 && spentOf(d, cur) + g.unlockCost > totalOf(d, cur)) return `Not enough ${currencyName(d, g.unlockCurrencyId)} to unlock`
  return null
}

/** Why a group cannot lose a rank, or null. */
export function cannotUnrankGroup(d: SkillTreeDoc, id: Id): string | null {
  const rank = d.groupRanks?.[id] ?? 0
  if (rank === 0) return 'No ranks to take back'
  const other = d.groups?.find((g) => (d.groupRanks?.[g.id] ?? 0) > 0 && g.requires.some((r) => r.groupId === id && r.rank === rank))
  return other ? `${other.name} needs it` : null
}

/** Skills learned through group ranks in the build. */
export function learned(d: SkillTreeDoc): Skill[] {
  return d.skills.filter((s) => s.groupId && (d.groupRanks?.[s.groupId] ?? 0) >= Math.max(1, s.learnAt ?? 1))
}

/** Learned, carryable skills of other groups the active group could carry. */
export function carryable(d: SkillTreeDoc): Skill[] {
  return learned(d).filter((s) => s.carryable && s.groupId !== d.activeGroup)
}

/** Would group `id` needing `other` make a loop? */
export function groupLoop(groups: SkillGroup[], id: Id, other: Id): boolean {
  const seen = new Set<Id>()
  const stack = [other]
  while (stack.length) {
    const x = stack.pop()!
    if (x === id) return true
    if (seen.has(x)) continue
    seen.add(x)
    stack.push(...(groups.find((c) => c.id === x)?.requires.map((r) => r.groupId) ?? []))
  }
  return false
}
