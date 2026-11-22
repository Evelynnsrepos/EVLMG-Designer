import { newId, type Id } from '@/core/model'

/**
 * Skill / talent tree (roadmap idea). Skills cost points per rank, need other
 * skills first and can need a number of points spent in the tree. The plan is a
 * test build: ranks put into skills against a point budget.
 */

export interface Skill {
  id: Id
  name: string
  /** v0.35 adds stat nodes (+20 HP) and locks (need a key), as on sphere grids and license boards. */
  kind: 'active' | 'passive' | 'stat' | 'lock'
  /** Free text, e.g. "+5% crit chance per rank". */
  effect: string
  maxRank: number
  /** Points per rank. */
  cost: number
  /** Skills that need at least one rank first. */
  requires: Id[]
  /** Points that must be spent in this tree before the first rank. */
  pointsNeeded: number
  image: string | null
  notes: string
  // ---- v0.35 (all optional) ----
  /** Needs any one of `requires` instead of all of them. */
  requireAny?: boolean
  /** Board layouts: a starting cell, free to build from. */
  start?: boolean
  /** Board layouts: the cell this skill sits on. */
  cell?: { x: number; y: number }
  /** Archetype / job / class this skill belongs to; learned at `learnAt` rank of it instead of with points. */
  classId?: Id
  learnAt?: number
  /** Can be carried over to other archetypes (inherited). */
  inheritable?: boolean
}

/** An archetype, job or class (Metaphor archetypes, Final Fantasy jobs). */
export interface SkillClass {
  id: Id
  name: string
  color: string
  maxRank: number
  /** How it is unlocked, in words, e.g. "Bond with Strohl, rank 2". */
  unlockNote: string
  /** Cost to unlock it (e.g. MAG), 0 = free. */
  unlockCost: number
  /** Other classes at a rank first: the advancement line (Warrior 20 -> Gladiator). */
  requires: { classId: Id; rank: number }[]
  /** Skills from other classes it can carry. */
  inheritSlots: number
}

export interface SkillTreeDoc {
  skills: Skill[]
  /** Points at the start, plus `perLevel` for each level up to `level`. `unit` names them (AP, LP, Spheres). */
  budget: { start: number; perLevel: number; level: number; unit?: string }
  /** Ranks put in per skill in the test build. */
  plan: Record<Id, number>
  /** v0.35: a tree drawn from links, or a board of cells (sphere grid, license board). */
  layout?: 'tree' | 'board'
  classes?: SkillClass[]
  /** Test build: rank per class, the class worn, and the skills it inherits. */
  classPlan?: Record<Id, number>
  equipped?: Id | null
  inherited?: Id[]
}

export const SKILL_KINDS = [
  { id: 'active', label: 'Active', color: '#e8590c' },
  { id: 'passive', label: 'Passive', color: '#3e8ef7' },
  { id: 'stat', label: 'Stat boost', color: '#2f9e44' },
  { id: 'lock', label: 'Lock (needs a key)', color: '#495057' },
] as const

export const createSkillTreeDoc = (): SkillTreeDoc => ({ skills: [], budget: { start: 0, perLevel: 1, level: 30 }, plan: {} })

export const normalizeSkillTree = (d: Partial<SkillTreeDoc> | undefined): SkillTreeDoc => {
  const base = createSkillTreeDoc()
  return { ...base, ...d, budget: { ...base.budget, ...d?.budget }, plan: { ...d?.plan }, classes: d?.classes ?? [], classPlan: { ...d?.classPlan }, inherited: d?.inherited ?? [] }
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

export const totalPoints = (d: SkillTreeDoc) => Math.max(0, d.budget.start + d.budget.perLevel * d.budget.level)

/** Skills learned through a class rank are not bought with points. */
const bought = (s: Skill) => !s.classId
export const spent = (d: SkillTreeDoc) => d.skills.reduce((n, s) => n + (bought(s) ? (d.plan[s.id] ?? 0) * s.cost : 0), 0)

/** Points to max out every skill. */
export const fullTreeCost = (skills: Skill[]) => skills.reduce((n, s) => n + (bought(s) ? s.maxRank * s.cost : 0), 0)

export const newClass = (name = 'New archetype'): SkillClass => ({ id: newId(), name, color: '#7048e8', maxRank: 20, unlockNote: '', unlockCost: 0, requires: [], inheritSlots: 0 })

const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1

/** Board: ranked cells reachable from a start cell through ranked neighbours (or a start cell itself). */
function reachable(d: SkillTreeDoc, plan: Record<Id, number>): Set<Id> {
  const on = d.skills.filter((s) => s.cell && (plan[s.id] ?? 0) > 0 && !s.classId)
  const seen = new Set(on.filter((s) => s.start).map((s) => s.id))
  const queue = on.filter((s) => seen.has(s.id))
  while (queue.length) {
    const s = queue.pop()!
    for (const o of on) if (!seen.has(o.id) && near(s.cell!, o.cell!)) {
      seen.add(o.id)
      queue.push(o)
    }
  }
  return seen
}

/** Board: may this cell get its first rank? A start, or next to a cell that has one. */
function boardOpen(d: SkillTreeDoc, s: Skill): boolean {
  if (s.start || !s.cell) return true
  const live = reachable(d, d.plan)
  return d.skills.some((o) => o.cell && live.has(o.id) && near(o.cell, s.cell!))
}

/** The first free board cell, row by row, `width` cells wide. */
export function freeCell(skills: Skill[], width = 8): { x: number; y: number } {
  const used = new Set(skills.filter((s) => s.cell).map((s) => `${s.cell!.x},${s.cell!.y}`))
  for (let i = 0; ; i++) if (!used.has(`${i % width},${Math.floor(i / width)}`)) return { x: i % width, y: Math.floor(i / width) }
}

/** Why a class cannot gain a rank, or null. */
export function cannotRankClass(d: SkillTreeDoc, id: Id): string | null {
  const c = d.classes?.find((x) => x.id === id)
  if (!c) return 'Unknown archetype'
  const rank = d.classPlan?.[id] ?? 0
  if (rank >= c.maxRank) return 'Already at max rank'
  const missing = c.requires.filter((r) => (d.classPlan?.[r.classId] ?? 0) < r.rank)
  if (missing.length) return `Needs ${missing.map((r) => `${d.classes?.find((x) => x.id === r.classId)?.name ?? '?'} rank ${r.rank}`).join(', ')} first`
  return null
}

/** Skills learned through class ranks in the build. */
export function learned(d: SkillTreeDoc): Skill[] {
  return d.skills.filter((s) => s.classId && (d.classPlan?.[s.classId] ?? 0) >= Math.max(1, s.learnAt ?? 1))
}

/** Learned, inheritable skills of other classes the worn class could carry. */
export function inheritable(d: SkillTreeDoc): Skill[] {
  return learned(d).filter((s) => s.inheritable && s.classId !== d.equipped)
}

/** Would class `id` needing `other` make a loop? */
export function classLoop(classes: SkillClass[], id: Id, other: Id): boolean {
  const seen = new Set<Id>()
  const stack = [other]
  while (stack.length) {
    const x = stack.pop()!
    if (x === id) return true
    if (seen.has(x)) continue
    seen.add(x)
    stack.push(...(classes.find((c) => c.id === x)?.requires.map((r) => r.classId) ?? []))
  }
  return false
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

/** Why a rank cannot be added, or null when it can. */
export function cannotAdd(d: SkillTreeDoc, id: Id): string | null {
  const s = d.skills.find((x) => x.id === id)
  if (!s) return 'Unknown skill'
  if (s.classId) return `Learned at ${d.classes?.find((c) => c.id === s.classId)?.name ?? 'its archetype'} rank ${Math.max(1, s.learnAt ?? 1)}`
  const rank = d.plan[id] ?? 0
  if (rank >= s.maxRank) return 'Already at max rank'
  const missing = s.requires.filter((r) => !(d.plan[r] > 0)).map((r) => d.skills.find((x) => x.id === r)?.name ?? '?')
  if (missing.length && (!s.requireAny || missing.length === s.requires.length)) return `Needs ${missing.join(s.requireAny ? ' or ' : ', ')} first`
  if (rank === 0 && d.layout === 'board' && !boardOpen(d, s)) return 'Needs a learned neighbour on the board first'
  if (rank === 0 && spent(d) < s.pointsNeeded) return `Needs ${s.pointsNeeded} points spent in the tree`
  if (spent(d) + s.cost > totalPoints(d)) return 'Not enough points'
  return null
}

/** Why a rank cannot be taken back, or null when it can. */
export function cannotRemove(d: SkillTreeDoc, id: Id): string | null {
  const rank = d.plan[id] ?? 0
  if (rank === 0) return 'No ranks to take back'
  const s = d.skills.find((x) => x.id === id)!
  const after = { ...d, plan: { ...d.plan, [id]: rank - 1 } }
  if (rank === 1) {
    const dependent = d.skills.find((x) => x.requires.includes(id) && d.plan[x.id] > 0 && (!x.requireAny || !x.requires.some((r) => r !== id && d.plan[r] > 0)))
    if (dependent) return `${dependent.name} needs it`
    if (d.layout === 'board') {
      const before = reachable(d, d.plan)
      const now = reachable(d, after.plan)
      const cut = d.skills.find((x) => x.id !== id && before.has(x.id) && !now.has(x.id))
      if (cut) return `${cut.name} would lose its path to a start cell`
    }
  }
  // Skills unlocked by points spent must still have enough spent before them.
  const left = spent(after)
  const blocked = d.skills.find((x) => x.id !== s.id && d.plan[x.id] > 0 && x.pointsNeeded > left - (d.plan[x.id] ?? 0) * x.cost)
  if (blocked) return `${blocked.name} needs ${blocked.pointsNeeded} points spent`
  return null
}
