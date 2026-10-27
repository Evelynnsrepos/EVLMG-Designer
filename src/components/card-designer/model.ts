import { newId, type Id } from '@/core/model'
import { addLayer, createScene, type BuiltinNode, type NodeBase, type Scene } from '@/shared/canvas'

/**
 * Card Designer (0.22): a card template (front and back, each a layered canvas), colour slots that
 * recolour every card at once, and a deck: one row per card whose values fill the template's `{Field}` text.
 * World units: MM per millimetre; the trim box starts at 0,0 and the bleed lies outside it.
 */

export const MM = 10

/** Text on a card; `{Name}` shows the card's value for the field "Name". */
export interface CardTextNode extends NodeBase {
  kind: 'card-text'
  foil?: boolean
  text: string
  width: number
  height: number
  fontSize: number
  fontFamily: string
  bold?: boolean
  italic?: boolean
  align?: 'left' | 'center' | 'right'
  textColor?: string
  /** Colour slot that overrides textColor. */
  textSlotId?: Id
}

/** A picture box filled from the card's value for an image field (or the placeholder). */
export interface CardImageNode extends NodeBase {
  kind: 'card-image'
  foil?: boolean
  width: number
  height: number
  fieldId: Id
}

/** Built-in shapes may take their colours from slots too. */
export type SlotKeys = { fillSlotId?: Id; strokeSlotId?: Id }
/** `foil`: printed in foil (shown with a shine; exported as a black foil mask for print shops). */
export type CardNode = ((BuiltinNode & SlotKeys) | CardTextNode | CardImageNode) & { foil?: boolean }

export interface ColorSlot {
  id: Id
  name: string
  color: string
}

/** Other colours for some slots (red faction, rare cards…). A card picks one. */
export interface Variant {
  id: Id
  name: string
  colors: { slotId: Id; color: string }[]
}

export interface Field {
  id: Id
  name: string
  /** 'number' only takes numbers (stats like Attack, Health, Cost). */
  kind: 'text' | 'number' | 'image'
}

export interface Card {
  id: Id
  copies: number
  variantId?: Id
  /** By field id; image fields hold an asset path. */
  values: Record<Id, string>
}

export interface CardDoc {
  widthMm: number
  heightMm: number
  bleedMm: number
  cornerMm: number
  front: Scene<CardNode>
  back: Scene<CardNode>
  slots: ColorSlot[]
  variants: Variant[]
  fields: Field[]
  cards: Card[]
  /** Cards come live from a Spreadsheet sheet instead of `cards`: row 1 names the fields. */
  sheet?: { documentId: Id; sheetId: Id }
  /** Own icons for `:name:` in text, besides the built-in ones. */
  icons?: { id: Id; name: string; src: string }[]
  /** 0.24: false while a new deck waits for its card size; missing = an older deck, already started. */
  started?: boolean
  /** Layers whose items each card can change for itself (the template's items are the starting point). */
  perCardLayers?: Id[]
  /** What one card changes for itself, by card id (also works for cards from a Spreadsheet row). */
  overrides?: Record<Id, CardOverride>
}

export interface CardOverride {
  /** Colour slots unlinked from the deck: slot id → this card's colour. */
  colors?: Record<Id, string>
  /** This card's own items on per-card layers: layer id → items. */
  nodes?: Record<Id, CardNode[]>
  /** Layers turned off on this card. */
  hidden?: Id[]
}

export { CARD_SIZES } from '@/shared/print'

export const DEFAULT_FONT = 'Lexend Deca'

/** A ready-to-edit poker card: background, art, frame and text layers wired to colour slots and fields. */
export function createCardDoc(): CardDoc {
  const w = 63 * MM
  const h = 88 * MM
  const b = 3 * MM
  const slot = (name: string, color: string): ColorSlot => ({ id: newId(), name, color })
  const slots = [slot('Background', '#f4ecd8'), slot('Frame', '#7a3b2e'), slot('Text', '#1c1d22'), slot('Accent', '#d9a441')]
  const [bg, frame, text, accent] = slots
  const field = (name: string, kind: Field['kind'] = 'text'): Field => ({ id: newId(), name, kind })
  const fields = [field('Name'), field('Cost', 'number'), field('Type'), field('Rules'), field('Art', 'image')]
  const art = fields[4]

  const front = createScene<CardNode>('Background')
  const L = (s: Scene<CardNode>, name: string) => {
    const r = addLayer(s, { name })
    return [r.scene, r.id] as const
  }
  let s = front
  const bgL = s.layers[0].id
  let artL, frameL, textL
  ;[s, artL] = L(s, 'Art')
  ;[s, frameL] = L(s, 'Frame')
  ;[s, textL] = L(s, 'Text')
  const t = (layerId: Id, x: number, y: number, width: number, height: number, str: string, fontSize: number, extra: Partial<CardTextNode> = {}): CardTextNode => ({
    id: newId(), kind: 'card-text', layerId, x, y, width, height, text: str, fontSize, fontFamily: DEFAULT_FONT, textSlotId: text.id, align: 'left', ...extra,
  })
  s.nodes = [
    { id: newId(), kind: 'rect', layerId: bgL, x: -b, y: -b, width: w + 2 * b, height: h + 2 * b, fillColor: bg.color, fillSlotId: bg.id, strokeWidth: 0, name: 'Background' },
    { id: newId(), kind: 'card-image', layerId: artL, x: 40, y: 110, width: w - 80, height: 360, fieldId: art.id, name: 'Art' },
    { id: newId(), kind: 'rect', layerId: frameL, x: 25, y: 25, width: w - 50, height: h - 50, strokeColor: frame.color, strokeSlotId: frame.id, strokeWidth: 12, cornerRadius: 20, name: 'Frame' },
    { id: newId(), kind: 'ellipse', layerId: frameL, x: w - 120, y: 35, width: 80, height: 80, fillColor: accent.color, fillSlotId: accent.id, strokeColor: frame.color, strokeSlotId: frame.id, strokeWidth: 6, name: 'Cost circle' },
    t(textL, 50, 50, w - 190, 50, '{Name}', 40, { fontFamily: 'Cinzel', bold: true }),
    t(textL, w - 120, 58, 80, 40, '{Cost}', 36, { align: 'center', bold: true }),
    t(textL, 50, 485, w - 100, 36, '{Type}', 26, { italic: true }),
    t(textL, 50, 535, w - 100, 270, '{Rules}', 28),
  ]

  let back = createScene<CardNode>('Background')
  const backBg = back.layers[0].id
  let backText
  ;[back, backText] = L(back, 'Text')
  back.nodes = [
    { id: newId(), kind: 'rect', layerId: backBg, x: -b, y: -b, width: w + 2 * b, height: h + 2 * b, fillColor: frame.color, fillSlotId: frame.id, strokeWidth: 0, name: 'Background' },
    { id: newId(), kind: 'rect', layerId: backBg, x: 45, y: 45, width: w - 90, height: h - 90, strokeColor: accent.color, strokeSlotId: accent.id, strokeWidth: 6, cornerRadius: 16, name: 'Border' },
    t(backText, 60, h / 2 - 40, w - 120, 80, 'My Game', 56, { align: 'center', fontFamily: 'Cinzel Decorative', bold: true, textSlotId: accent.id }),
  ]

  const cards: Card[] = [
    { id: newId(), copies: 1, values: { [fields[0].id]: 'Fire Bolt', [fields[1].id]: '2', [fields[2].id]: 'Spell', [fields[3].id]: 'Deal 3 damage to one enemy.' } },
  ]
  return { widthMm: 63, heightMm: 88, bleedMm: 3, cornerMm: 3, front: s, back, slots, variants: [], fields, cards, started: false }
}

/** Slot colours for a card: the base colours, its variant's colours on top, then the card's own unlinked colours. */
export function slotColors(doc: Pick<CardDoc, 'slots' | 'variants' | 'overrides'>, variantId?: Id, cardId?: Id): Map<Id, string> {
  const map = new Map(doc.slots.map((s) => [s.id, s.color]))
  for (const c of doc.variants.find((v) => v.id === variantId)?.colors ?? []) if (map.has(c.slotId)) map.set(c.slotId, c.color)
  for (const [id, c] of Object.entries((cardId && doc.overrides?.[cardId]?.colors) || {})) if (map.has(id)) map.set(id, c)
  return map
}

/** Change one card's override (empty overrides are dropped). */
export function setOverride(doc: CardDoc, cardId: Id, fn: (o: CardOverride) => CardOverride): CardDoc {
  const o = fn(doc.overrides?.[cardId] ?? {})
  const empty = !Object.keys(o.colors ?? {}).length && !Object.keys(o.nodes ?? {}).length && !(o.hidden ?? []).length
  const { [cardId]: _, ...rest } = doc.overrides ?? {}
  return { ...doc, overrides: empty ? rest : { ...rest, [cardId]: o } }
}

const sameNodes = (a: CardNode[], b: CardNode[]) => a.length === b.length && a.every((n, i) => n === b[i])

/**
 * One side as a card shows it: the template with the card's own items on per-card layers, and the layers
 * it turned off hidden and locked. Without overrides this is the template itself (same object).
 */
export function composeScene(doc: CardDoc, side: 'front' | 'back', cardId: Id | null | undefined): Scene<CardNode> {
  const tpl = doc[side]
  const ov = cardId ? doc.overrides?.[cardId] : undefined
  if (!ov) return tpl
  const own = ov.nodes ?? {}
  const off = new Set(ov.hidden ?? [])
  const per = (doc.perCardLayers ?? []).filter((l) => own[l] && tpl.layers.some((x) => x.id === l))
  return {
    ...tpl,
    layers: off.size ? tpl.layers.map((l) => (off.has(l.id) ? { ...l, hidden: true, locked: true } : l)) : tpl.layers,
    nodes: [...tpl.nodes.filter((n) => !per.includes(n.layerId)), ...per.flatMap((l) => own[l])],
  }
}

/**
 * Store an edit made on a composed side: items on per-card layers go to the card (only when they
 * changed, so other cards keep following the template), everything else to the template.
 */
export function splitScene(doc: CardDoc, side: 'front' | 'back', cardId: Id | null | undefined, next: Scene<CardNode>): CardDoc {
  const before = composeScene(doc, side, cardId)
  if (before === doc[side] && !(cardId && doc.perCardLayers?.length)) return { ...doc, [side]: next }
  const tpl = doc[side]
  const per = new Set(cardId ? (doc.perCardLayers ?? []) : [])
  const off = new Set((cardId && doc.overrides?.[cardId]?.hidden) || [])
  // Layers turned off for this card keep the template's own hidden/locked state.
  const layers = next.layers.map((l) => {
    const t = tpl.layers.find((x) => x.id === l.id)
    return off.has(l.id) && t ? { ...l, hidden: t.hidden, locked: t.locked } : l
  })
  let out: CardDoc = { ...doc, [side]: { ...next, layers, nodes: [...next.nodes.filter((n) => !per.has(n.layerId)), ...tpl.nodes.filter((n) => per.has(n.layerId))] } }
  for (const l of per) {
    const now = next.nodes.filter((n) => n.layerId === l)
    if (!sameNodes(now, before.nodes.filter((n) => n.layerId === l))) out = setOverride(out, cardId!, (o) => ({ ...o, nodes: { ...o.nodes, [l]: now } }))
  }
  return out
}

/** Scale the whole design (both sides and every card's own items) to a new card size. */
export function resizeDesign(doc: CardDoc, widthMm: number, heightMm: number): CardDoc {
  const sx = widthMm / doc.widthMm
  const sy = heightMm / doc.heightMm
  if (sx === 1 && sy === 1) return doc
  const scale = (n: CardNode): CardNode => {
    const m = { ...n, x: n.x * sx, y: n.y * sy } as CardNode & { width?: number; height?: number; fontSize?: number; points?: number[] }
    if (m.width !== undefined) m.width *= sx
    if (m.height !== undefined) m.height *= sy
    if (m.fontSize !== undefined) m.fontSize *= Math.min(sx, sy)
    if (m.points) m.points = m.points.map((v, i) => v * (i % 2 ? sy : sx))
    return m
  }
  const side = (s: Scene<CardNode>) => ({ ...s, nodes: s.nodes.map(scale) })
  const overrides = Object.fromEntries(
    Object.entries(doc.overrides ?? {}).map(([id, o]) => [id, o.nodes ? { ...o, nodes: Object.fromEntries(Object.entries(o.nodes).map(([l, ns]) => [l, ns.map(scale)])) } : o]),
  )
  return { ...doc, widthMm, heightMm, front: side(doc.front), back: side(doc.back), overrides }
}

/** Replace `{Field}` with the card's values (field names ignore case). Unknown names stay as typed. */
export function fillText(text: string, fields: Field[], values: Record<Id, string> | null): string {
  if (!values) return text
  return text.replace(/\{([^{}]+)\}/g, (all, name: string) => {
    const f = fields.find((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase())
    return f ? (values[f.id] ?? '') : all
  })
}

/** A node with its slot colours applied. */
export function applySlots<N extends CardNode>(n: N, colors: Map<Id, string>): N {
  const c = n as N & SlotKeys & CardTextNode
  const fill = c.fillSlotId && colors.get(c.fillSlotId)
  const stroke = c.strokeSlotId && colors.get(c.strokeSlotId)
  const text = c.textSlotId && colors.get(c.textSlotId)
  if (!fill && !stroke && !text) return n
  return { ...n, ...(fill ? { fillColor: fill } : {}), ...(stroke ? { strokeColor: stroke } : {}), ...(text ? { textColor: text } : {}) }
}

/** Renaming a field keeps the template's `{Old}` text working. */
export function renameFieldInScene(scene: Scene<CardNode>, oldName: string, newName: string): Scene<CardNode> {
  const re = new RegExp(`\\{\\s*${oldName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}`, 'gi')
  return { ...scene, nodes: scene.nodes.map((n) => (n.kind === 'card-text' ? { ...n, text: n.text.replace(re, `{${newName}}`) } : n)) }
}

/** Minimal shape of a Spreadsheet document (read only here). */
export interface SheetLike {
  id: Id
  name: string
  cells: Record<string, { v: string }>
}

const colName = (col: number) => {
  let s = ''
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/**
 * Cards from a sheet: row 1 holds field names, every following row with any value is a card.
 * Columns named "Copies" (or "Count") and "Variant" set those; other names match fields (ignoring case).
 * Formulas should already be results here (`evaluatedSheet`).
 */
export function cardsFromSheet(sheet: SheetLike, fields: Field[], variants: Variant[]): Card[] {
  const cell = (c: number, r: number) => (sheet.cells[`${colName(c)}${r + 1}`]?.v ?? '').trim()
  let lastCol = -1
  let lastRow = 0
  for (const a of Object.keys(sheet.cells)) {
    const m = /^([A-Z]+)(\d+)$/.exec(a)
    if (!m || !sheet.cells[a].v?.trim()) continue
    let col = 0
    for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64)
    lastCol = Math.max(lastCol, col - 1)
    lastRow = Math.max(lastRow, Number(m[2]) - 1)
  }
  const heads = Array.from({ length: lastCol + 1 }, (_, c) => cell(c, 0).toLowerCase())
  const cards: Card[] = []
  for (let r = 1; r <= lastRow; r++) {
    const row = heads.map((_, c) => cell(c, r))
    if (!row.some(Boolean)) continue
    const values: Record<Id, string> = {}
    let copies = 1
    let variantId: Id | undefined
    heads.forEach((h, c) => {
      if (h === 'copies' || h === 'count') copies = row[c] === '' ? 1 : Math.max(0, Math.floor(Number(row[c]) || 0))
      else if (h === 'variant') variantId = variants.find((v) => v.name.toLowerCase() === row[c].toLowerCase())?.id
      else {
        const f = fields.find((x) => x.name.trim().toLowerCase() === h)
        if (f) values[f.id] = row[c]
      }
    })
    cards.push({ id: `row-${r + 1}`, copies, variantId, values })
  }
  return cards
}

/** Every printed card in deck order (copies repeated). */
export const expandCopies = (cards: Card[]) => cards.flatMap((c) => Array.from({ length: Math.max(0, c.copies) }, () => c))

/** The deck as JSON for game engines and other tools (format "evlmg-deck", version 1). */
export function deckJson(name: string, doc: CardDoc, cards: Card[], images?: Map<Id, string>) {
  return {
    format: 'evlmg-deck',
    version: 1,
    name,
    card: { widthMm: doc.widthMm, heightMm: doc.heightMm, bleedMm: doc.bleedMm, cornerMm: doc.cornerMm },
    fields: doc.fields.map((f) => ({ id: f.id, name: f.name, type: f.kind })),
    colorSlots: doc.slots.map((s) => ({ id: s.id, name: s.name, color: s.color })),
    variants: doc.variants.map((v) => ({ id: v.id, name: v.name, colors: Object.fromEntries(v.colors.map((c) => [c.slotId, c.color])) })),
    cards: cards.map((c) => ({
      id: c.id,
      copies: c.copies,
      variant: c.variantId ?? null,
      values: Object.fromEntries(doc.fields.map((f) => [f.name, jsonValue(f, c.values[f.id] ?? '')])),
      ...(images?.has(c.id) ? { image: images.get(c.id) } : {}),
    })),
  }
}

/** Number fields export as numbers when they hold one; anything else stays text. */
function jsonValue(f: Field, v: string): string | number {
  return f.kind === 'number' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v
}

/** `:sword:` style icon names in a text. */
export const ICON_TOKEN = /:([a-z0-9_-]+):/gi

export interface LaidOutItem {
  kind: 'text' | 'icon'
  /** The word, or the icon name. */
  value: string
  x: number
  width: number
}

/**
 * Lay out text with inline icons (each icon is one font size wide), wrapping words at `width`.
 * Returns the lines with item positions and each line's width, for alignment.
 */
export function layoutRichText(text: string, isIcon: (name: string) => boolean, measure: (word: string) => number, width: number, fontSize: number) {
  const lines: { items: LaidOutItem[]; width: number }[] = [{ items: [], width: 0 }]
  const space = measure(' ')
  let pendingSpace = false
  for (const part of text.split(/(\n|:[a-z0-9_-]+:|[ \t]+)/i)) {
    if (!part) continue
    let line = lines[lines.length - 1]
    if (part === '\n') {
      lines.push({ items: [], width: 0 })
      pendingSpace = false
      continue
    }
    if (/^[ \t]+$/.test(part)) {
      pendingSpace = line.items.length > 0
      continue
    }
    const icon = /^:([a-z0-9_-]+):$/i.exec(part)
    const kind: LaidOutItem['kind'] = icon && isIcon(icon[1].toLowerCase()) ? 'icon' : 'text'
    const w = kind === 'icon' ? fontSize : measure(part)
    let x = line.width + (pendingSpace ? space : 0)
    if (line.items.length && x + w > width) {
      line = { items: [], width: 0 }
      lines.push(line)
      x = 0
    }
    line.items.push({ kind, value: kind === 'icon' ? icon![1].toLowerCase() : part, x, width: w })
    line.width = x + w
    pendingSpace = false
  }
  return lines
}
