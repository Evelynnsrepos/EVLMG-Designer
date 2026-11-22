import { newId, type Id } from '@/core/model'
import { dateNumber, formatDate, type CalendarDoc } from '@/shared/calendar'
import { addNodes, createScene, getNode, type NodeBase, type Rect, type Scene } from '@/shared/canvas'

/**
 * Timeline Creator data (spec 8.1). The x axis is time: the main line runs
 * from x = 0 to x = length, and when start and end years are set, a
 * position's year is read off that axis (TL-8). Branches are alternative
 * timelines that split off a line at a point in time and run parallel to it
 * on their own lane (TL-5, TL-7). Events sit on a line at a time position.
 *
 * Both kinds are drawn in world space by the Timeline itself (`absolute`),
 * so events can only slide along their line.
 */

export interface TimelineLine extends NodeBase {
  kind: 'tl-line'
  /** x = where the line starts in time (for a branch: the split point), y = its lane. */
  length: number
  /** The one main line every branch descends from. */
  main?: boolean
  /** The line a branch splits off (absent on the main line). */
  parentId?: Id
  /** Branch name (TL-7). */
  name: string
  lineColor: string
}

/** A link to an entity or wiki article (`kind` = `character`, `article`, ...). TL-9. */
export interface TimelineLink {
  kind: string
  targetId: Id
}

export interface TimelineEvent extends NodeBase {
  kind: 'tl-event'
  lineId: Id
  /** x = time position on the axis; y is unused (events follow their line). */
  text: string
  /** Optional image, a project asset path (TL-3). */
  src?: string | null
  links: TimelineLink[]
  /** v0.35: the Calendar entry this event follows (linked timelines). */
  calendarEntryId?: Id
}

export type TimelineItem = TimelineLine | TimelineEvent

export interface TimelineDoc {
  /** Both optional (TL-1). Whole years, may be negative. */
  startYear: number | null
  endYear: number | null
  scene: Scene<TimelineItem>
}

export const MAIN_LENGTH = 1200
/** Horizontal run of the curve from the parent line into a branch's lane. */
export const BRANCH_STUB = 90
export const LANE_GAP = 220
export const MIN_LINE_LENGTH = 120

/** Branch colors (user content colors, so fixed values are fine). */
export const BRANCH_COLORS = ['#d46cf0', '#8fb4ff', '#5fd3a0', '#ffd166', '#ff9061', '#ff6b9a', '#9aa0ad']

export const TIMELINE_TEXT = {
  branchName: (n: number) => `Branch ${n}`,
}

export const isLine = (n: NodeBase | undefined): n is TimelineLine => n?.kind === 'tl-line'
export const isEvent = (n: NodeBase | undefined): n is TimelineEvent => n?.kind === 'tl-event'

export function createDefaultTimeline(): TimelineDoc {
  const scene = createScene<TimelineItem>()
  const main: TimelineLine = { id: newId(), kind: 'tl-line', layerId: scene.layers[0].id, x: 0, y: 0, length: MAIN_LENGTH, main: true, name: '', lineColor: '' }
  return { startYear: null, endYear: null, scene: addNodes(scene, [main]) }
}

export function lines(scene: Scene<TimelineItem>): TimelineLine[] {
  return scene.nodes.filter(isLine)
}

export function events(scene: Scene<TimelineItem>): TimelineEvent[] {
  return scene.nodes.filter(isEvent)
}

export function mainLine(scene: Scene<TimelineItem>): TimelineLine | undefined {
  return scene.nodes.find((n): n is TimelineLine => isLine(n) && !!n.main)
}

export const lineEnd = (l: TimelineLine) => l.x + l.length

/** Where events may sit on a line: after a branch's curve, up to its end. */
export function lineRange(l: TimelineLine): [number, number] {
  return [l.main ? l.x : l.x + BRANCH_STUB, lineEnd(l)]
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// ---- years (TL-8) ----

export interface YearAxis {
  start: number
  end: number
  /** Main line length: the x where `end` falls. */
  length: number
}

/** The year scale, or null when years are not both set (events then just keep their order). */
export function yearAxis(doc: Pick<TimelineDoc, 'startYear' | 'endYear'>, length: number): YearAxis | null {
  const { startYear: start, endYear: end } = doc
  if (start === null || end === null || start === end || length <= 0) return null
  return { start, end, length }
}

export function yearAt(axis: YearAxis, x: number): number {
  return Math.round(axis.start + (x / axis.length) * (axis.end - axis.start))
}

export function xOfYear(axis: YearAxis, year: number): number {
  return ((year - axis.start) / (axis.end - axis.start)) * axis.length
}

/** Snap a position to a whole year when years are set. */
export function snapX(axis: YearAxis | null, x: number): number {
  return axis ? xOfYear(axis, yearAt(axis, x)) : x
}

/** About `target` evenly spaced, round year steps (1, 2, 5, 10, 20, 50, ...) for the axis labels. */
export function yearTicks(axis: YearAxis, target = 10): number[] {
  const span = Math.abs(axis.end - axis.start)
  const raw = span / target
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1)))
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow)
  const lo = Math.min(axis.start, axis.end)
  const hi = Math.max(axis.start, axis.end)
  const out: number[] = []
  for (let y = Math.ceil(lo / step) * step; y <= hi; y += step) out.push(y)
  return out
}

// ---- editing ----

/** Event tool click on a line (TL-2). */
export function addEvent(scene: Scene<TimelineItem>, lineId: Id, x: number): { scene: Scene<TimelineItem>; event: TimelineEvent | null } {
  const line = getNode(scene, lineId)
  if (!isLine(line)) return { scene, event: null }
  const [lo, hi] = lineRange(line)
  const event: TimelineEvent = { id: newId(), kind: 'tl-event', layerId: line.layerId, lineId, x: clamp(x, lo, hi), y: 0, text: '', links: [] }
  return { scene: addNodes(scene, [event]), event }
}

/** Is any line already using this lane over [x0, x1]? */
function laneTaken(scene: Scene<TimelineItem>, y: number, x0: number, x1: number) {
  return lines(scene).some((l) => Math.abs(l.y - y) < LANE_GAP / 2 && l.x < x1 && lineEnd(l) > x0)
}

/** Branch tool click (TL-5): a new line splitting off `parentId` at time x, on the nearest free lane below. */
export function addBranch(scene: Scene<TimelineItem>, parentId: Id, x: number): { scene: Scene<TimelineItem>; branch: TimelineLine | null } {
  const parent = getNode(scene, parentId)
  if (!isLine(parent)) return { scene, branch: null }
  const splitX = clamp(x, parent.x, lineEnd(parent))
  const length = Math.max(MIN_LINE_LENGTH * 3, lineEnd(parent) - splitX)
  let y = parent.y + LANE_GAP
  while (laneTaken(scene, y, splitX, splitX + length)) y += LANE_GAP
  const count = lines(scene).filter((l) => !l.main).length
  const branch: TimelineLine = {
    id: newId(),
    kind: 'tl-line',
    layerId: parent.layerId,
    x: splitX,
    y,
    length,
    parentId: parent.id,
    name: TIMELINE_TEXT.branchName(count + 1),
    lineColor: BRANCH_COLORS[(count + 1) % BRANCH_COLORS.length],
  }
  return { scene: addNodes(scene, [branch]), branch }
}

/** The shortest a line may get without dropping its events or the branches that split off it. */
export function minLength(scene: Scene<TimelineItem>, line: TimelineLine): number {
  let far = lineRange(line)[0] + MIN_LINE_LENGTH
  for (const n of scene.nodes) {
    if (isEvent(n) && n.lineId === line.id) far = Math.max(far, n.x + 10)
    if (isLine(n) && n.parentId === line.id) far = Math.max(far, n.x + 10)
  }
  return far - line.x
}

/**
 * Resizing the main line stretches the whole timeline, so every event keeps
 * its year (the axis maps 0..length to start..end).
 */
export function stretchTimeline(scene: Scene<TimelineItem>, newLength: number): Scene<TimelineItem> {
  const main = mainLine(scene)
  if (!main || main.length <= 0 || newLength === main.length) return scene
  const f = newLength / main.length
  return {
    ...scene,
    nodes: scene.nodes.map((n) => {
      if (isLine(n)) return { ...n, x: n.x * f, length: n.length * f }
      if (isEvent(n)) return { ...n, x: n.x * f }
      return n
    }),
  }
}

export function setLineLength(scene: Scene<TimelineItem>, id: Id, length: number): Scene<TimelineItem> {
  const line = getNode(scene, id)
  if (!isLine(line)) return scene
  const l = Math.max(minLength(scene, line), length)
  if (line.main) return stretchTimeline(scene, l)
  return { ...scene, nodes: scene.nodes.map((n) => (n.id === id ? { ...line, length: l } : n)) }
}

/** Every line descending from `id` (branches of branches), including itself. */
export function lineFamily(scene: Scene<TimelineItem>, id: Id): Set<Id> {
  const family = new Set([id])
  let size = 0
  while (size !== family.size) {
    size = family.size
    for (const l of lines(scene)) if (l.parentId && family.has(l.parentId)) family.add(l.id)
  }
  return family
}

/**
 * Keep the timeline consistent after any change (delete, undo, duplicate):
 * exactly one main line, every branch and event on a line that exists,
 * events inside their line.
 */
export function normalizeTimeline(scene: Scene<TimelineItem>): Scene<TimelineItem> {
  let nodes = scene.nodes
  let changed = false
  const mains = nodes.filter((n): n is TimelineLine => isLine(n) && !!n.main)
  if (mains.length === 0) {
    const layerId = scene.layers[0]?.id ?? ''
    nodes = [{ id: newId(), kind: 'tl-line', layerId, x: 0, y: 0, length: MAIN_LENGTH, main: true, name: '', lineColor: '' }, ...nodes]
    changed = true
  } else if (mains.length > 1) {
    // e.g. a duplicated main line becomes a branch of the real one
    const keep = mains[0]
    nodes = nodes.map((n) => (isLine(n) && n.main && n.id !== keep.id ? { ...n, main: undefined, parentId: keep.id, name: n.name || TIMELINE_TEXT.branchName(1), lineColor: n.lineColor || BRANCH_COLORS[1] } : n))
    changed = true
  }

  // Drop branches whose parent chain is broken, then events without a line.
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const alive = new Map<Id, boolean>()
  const lineAlive = (id: Id, seen = new Set<Id>()): boolean => {
    const known = alive.get(id)
    if (known !== undefined) return known
    const l = byId.get(id)
    let ok = false
    if (isLine(l) && !seen.has(id)) {
      seen.add(id)
      ok = !!l.main || (!!l.parentId && lineAlive(l.parentId, seen))
    }
    alive.set(id, ok)
    return ok
  }
  const kept = nodes.filter((n) => (isLine(n) ? lineAlive(n.id) : isEvent(n) ? lineAlive(n.lineId) : true))
  if (kept.length !== nodes.length) {
    nodes = kept
    changed = true
  }

  const lineMap = new Map(nodes.filter(isLine).map((l) => [l.id, l]))
  const clamped = nodes.map((n) => {
    if (!isEvent(n)) return n
    const [lo, hi] = lineRange(lineMap.get(n.lineId)!)
    const x = clamp(n.x, lo, hi)
    return x === n.x && n.y === 0 ? n : { ...n, x, y: 0 }
  })
  if (clamped.some((n, i) => n !== nodes[i])) {
    nodes = clamped
    changed = true
  }
  return changed ? { ...scene, nodes } : scene
}

// ---- event cards ----

export const CARD_WIDTH = 170
export const CARD_PAD = 8
export const CARD_FONT = 13
export const CARD_LINE_HEIGHT = 1.25
export const CARD_MAX_TEXT = Math.round(CARD_FONT * CARD_LINE_HEIGHT * 6)
export const CARD_IMAGE = 92
export const YEAR_ROW = 18
export const LINK_ROW = 16
/** Gap between the line and the lowest card. */
export const STEM = 26

export type MeasureText = (text: string, fontSize: number, width: number) => number

export function cardHeight(ev: TimelineEvent, measure: MeasureText, showYear: boolean): number {
  let h = CARD_PAD * 2
  if (showYear) h += YEAR_ROW
  h += ev.text ? Math.min(CARD_MAX_TEXT, measure(ev.text, CARD_FONT, CARD_WIDTH - CARD_PAD * 2)) : CARD_FONT * CARD_LINE_HEIGHT
  if (ev.src) h += CARD_IMAGE + 6
  if (ev.links.length) h += LINK_ROW
  return h
}

/**
 * How far above its line each event's card sits: cards that would overlap a
 * neighbour on the same line are lifted above it, so close events stay readable.
 */
export function layoutCards(scene: Scene<TimelineItem>, measure: MeasureText, showYear: boolean): Map<Id, { lift: number; height: number }> {
  const out = new Map<Id, { lift: number; height: number }>()
  const byLine = new Map<Id, TimelineEvent[]>()
  for (const e of events(scene)) byLine.set(e.lineId, [...(byLine.get(e.lineId) ?? []), e])
  for (const list of byLine.values()) {
    list.sort((a, b) => a.x - b.x)
    const placed: { x0: number; x1: number; bottom: number; top: number }[] = []
    for (const e of list) {
      const height = cardHeight(e, measure, showYear)
      const x0 = e.x - CARD_WIDTH / 2
      const x1 = x0 + CARD_WIDTH
      let bottom = STEM
      for (;;) {
        const top = bottom + height
        const hit = placed.find((p) => p.x0 < x1 + 6 && p.x1 > x0 - 6 && p.bottom < top + 6 && p.top > bottom - 6)
        if (!hit) break
        bottom = hit.top + 8
      }
      placed.push({ x0, x1, bottom, top: bottom + height })
      out.set(e.id, { lift: bottom, height })
    }
  }
  return out
}

/** World rectangle of an event's card, given its line's lane. */
export function cardRect(ev: TimelineEvent, lineY: number, card: { lift: number; height: number }): Rect {
  return { x: ev.x - CARD_WIDTH / 2, y: lineY - card.lift - card.height, width: CARD_WIDTH, height: card.height }
}

// ---- linked calendar (v0.35) ----

/**
 * Make the main line show the calendar's entries: one event per entry (not
 * repeats), placed by day between the game's start and end (or the first and
 * last entry). Events no longer in the calendar are removed. Returns the same
 * scene when nothing changed, so it is safe to run on every render.
 */
export function syncCalendar(scene: Scene<TimelineItem>, c: CalendarDoc): Scene<TimelineItem> {
  const main = mainLine(scene)
  if (!main) return scene
  const list = (c.entries ?? []).filter((e) => e.onTimeline !== false && (e.repeat ?? 'none') === 'none').map((e) => ({ e, n: dateNumber(c, e) }))
  const ns = list.map((x) => x.n)
  const lo = c.gameStart ? dateNumber(c, c.gameStart) : Math.min(...ns)
  const hi = c.gameEnd ? dateNumber(c, c.gameEnd) : Math.max(...ns)
  const years = new Set(list.map((x) => x.e.year))
  const xOf = (n: number) => (hi > lo ? clamp((n - lo) / (hi - lo), 0, 1) * main.length : main.length / 2)
  const byEntry = new Map(events(scene).filter((ev) => ev.calendarEntryId).map((ev) => [ev.calendarEntryId!, ev]))
  const wanted = new Set(list.map((x) => x.e.id))
  let changed = false
  const nodes: TimelineItem[] = []
  for (const n of scene.nodes) {
    if (isEvent(n) && n.calendarEntryId && !wanted.has(n.calendarEntryId)) {
      changed = true
      continue
    }
    nodes.push(n)
  }
  for (const { e, n } of list) {
    const text = `${formatDate(c, e, years.size > 1)} · ${e.title}`
    const x = xOf(n)
    const old = byEntry.get(e.id)
    if (!old) {
      nodes.push({ id: newId(), kind: 'tl-event', layerId: main.layerId, lineId: main.id, x, y: 0, text, links: [], calendarEntryId: e.id })
      changed = true
    } else if (old.text !== text || Math.abs(old.x - x) > 0.01 || old.lineId !== main.id) {
      const i = nodes.indexOf(old)
      nodes[i] = { ...old, text, x, lineId: main.id }
      changed = true
    }
  }
  return changed ? { ...scene, nodes } : scene
}
