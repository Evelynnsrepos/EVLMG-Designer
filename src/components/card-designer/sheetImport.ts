import { newId, type AssetPath, type Id } from '@/core/model'
import { composeScene, onEveryCard, seedNewCard, setOverride, type Card, type CardDoc, type CardNode, type Field, type SheetLike } from './model'

/**
 * Fill the deck from a spreadsheet once (0.24.6): each row is a card, each column goes where the user maps it.
 * A column target is a string: 'skip', 'copies', 'variant', 'field:<id>', 'new:<kind>' (a new field named like
 * the column) or 'box:<key>' (a text box with each card's own text: it shows a new field from now on).
 */
export type Target = string

/** A text box with each card's own text. `key` is the template box id, or the `textKey` its per-card copies share. */
export interface OwnBox {
  key: Id
  tpl: boolean
  label: string
}

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i
const ASSET = /^assets\//
/** How a picture's file name is looked up: no folder, no extension, any case. */
export const pictureKey = (name: string) => (name.split(/[\\/]/).pop() ?? '').replace(/\.[^.]+$/, '').trim().toLowerCase()
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
const keyOf = (n: CardNode) => (n.kind === 'card-text' && n.textKey) || n.id

/** A Spreadsheet sheet as rows of text (row 1 first). */
export function sheetRows(sheet: SheetLike): string[][] {
  const rows: string[][] = []
  for (const [a, c] of Object.entries(sheet.cells)) {
    const m = /^([A-Z]+)(\d+)$/.exec(a)
    if (!m || !c.v) continue
    let col = 0
    for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64)
    ;(rows[Number(m[2]) - 1] ??= [])[col - 1] = c.v
  }
  return Array.from(rows, (r) => Array.from(r ?? [], (v) => v ?? ''))
}

/** Boxes on the open card that hold each card's own text (T off), both sides. */
export function ownTextBoxes(doc: CardDoc, cardId: Id | null): OwnBox[] {
  const out: OwnBox[] = []
  for (const side of ['front', 'back'] as const)
    for (const n of composeScene(doc, side, cardId).nodes) {
      if (n.kind !== 'card-text' || !n.ownText) continue
      const tpl = onEveryCard(doc, side, n.id)
      const text = n.text.replace(/\s+/g, ' ').trim()
      out.push({ key: tpl ? n.id : keyOf(n), tpl, label: `${side === 'front' ? 'Front' : 'Back'} text box “${n.name || (text.length > 24 ? text.slice(0, 23) + '…' : text) || 'empty'}”` })
    }
  return out
}

/** First guess per column: same-named fields, Copies/Count and Variant, else a new field of the type the values look like. */
export function guessTargets(doc: CardDoc, rows: string[][]): Target[] {
  return (rows[0] ?? []).map((h, c) => {
    const head = h.trim().toLowerCase()
    if (!head) return 'skip'
    if (head === 'copies' || head === 'count') return 'copies'
    if (head === 'variant') return 'variant'
    const f = doc.fields.find((x) => same(x.name, head))
    if (f) return `field:${f.id}`
    const values = rows.slice(1).map((r) => (r[c] ?? '').trim()).filter(Boolean)
    if (values.length && values.every((v) => IMAGE_FILE.test(v) || ASSET.test(v))) return 'new:image'
    if (values.length && values.every((v) => Number.isFinite(Number(v)))) return 'new:number'
    return 'new:text'
  })
}

/** Picture names a fill needs that are neither project paths nor among `pictures`. */
export function missingPictures(doc: CardDoc, rows: string[][], targets: Target[], pictures: Map<string, AssetPath>): string[] {
  const out = new Set<string>()
  targets.forEach((t, c) => {
    const isImage = t === 'new:image' || (t.startsWith('field:') && doc.fields.find((f) => f.id === t.slice(6))?.kind === 'image')
    if (!isImage) return
    for (const r of rows.slice(1)) {
      const v = (r[c] ?? '').trim()
      if (v && !ASSET.test(v) && !pictures.has(pictureKey(v))) out.add(v)
    }
  })
  return [...out]
}

export interface ImportResult {
  doc: CardDoc
  added: number
  updated: number
  newFields: string[]
  problems: string[]
}

/**
 * Fill cards from `rows` (row 1 = column names). Rows whose name (the deck's first text field) matches a card
 * update that card, the rest become new cards laid out like `fromId`. Empty cells keep the card's value.
 */
export function applyImport(doc: CardDoc, rows: string[][], targets: Target[], fromId: Id | null, pictures: Map<string, AssetPath>): ImportResult {
  const heads = rows[0] ?? []
  const problems: string[] = []
  const newFields: string[] = []
  const fields = [...doc.fields]
  const colField: (Id | null)[] = []
  const boxes: { key: Id; fieldId: Id; name: string }[] = []
  targets.forEach((t, c) => {
    colField[c] = null
    const name = heads[c]?.trim() || `Column ${c + 1}`
    if (t.startsWith('field:')) colField[c] = t.slice(6)
    else if (t.startsWith('new:') || t.startsWith('box:')) {
      let f = t.startsWith('box:') ? fields.find((x) => same(x.name, name)) : undefined
      if (!f) {
        const kind = (t.startsWith('new:') ? t.slice(4) : 'text') as Field['kind']
        f = { id: newId(), name, kind, ...(kind === 'choice' ? { choices: [] } : {}) }
        fields.push(f)
        newFields.push(name)
      }
      colField[c] = f.id
      if (t.startsWith('box:')) boxes.push({ key: t.slice(4), fieldId: f.id, name: f.name })
    }
  })
  const nameField = fields.find((f) => f.kind === 'text')
  const nameCol = nameField ? colField.indexOf(nameField.id) : -1
  const waiting = new Map<string, Card[]>()
  for (const card of doc.cards) {
    const k = (nameField && card.values[nameField.id]?.trim().toLowerCase()) || ''
    if (k) waiting.set(k, [...(waiting.get(k) ?? []), card])
  }

  // New cards take fields the sheet has no column for (like a fixed HP) from the open card.
  const from = doc.cards.find((c) => c.id === fromId) ?? doc.cards[0]
  const unmapped = Object.fromEntries(Object.entries(from?.values ?? {}).filter(([f]) => !colField.includes(f)))
  const cards = [...doc.cards]
  const created: Id[] = []
  let updated = 0
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (!row.some((v) => v?.trim())) continue
    const at = `Row ${r + 1}`
    const name = nameCol >= 0 ? (row[nameCol] ?? '').trim().toLowerCase() : ''
    const old = name ? waiting.get(name)?.shift() : undefined
    const card: Card = old ? { ...old, values: { ...old.values } } : { id: newId(), copies: 1, values: { ...unmapped } }
    targets.forEach((t, c) => {
      const v = (row[c] ?? '').trim()
      if (!v) return
      if (t === 'copies') {
        const n = Number(v)
        if (Number.isInteger(n) && n >= 0) card.copies = n
        else problems.push(`${at}: copies “${v}” is not a whole number.`)
        return
      }
      if (t === 'variant') {
        const found = doc.variants.find((x) => same(x.name, v))
        if (found) card.variantId = found.id
        else problems.push(`${at}: there is no colour variant “${v}”.`)
        return
      }
      const fi = fields.findIndex((x) => x.id === colField[c])
      if (fi < 0) return
      const f = fields[fi]
      if (f.kind === 'number' && !Number.isFinite(Number(v))) return void problems.push(`${at}: ${f.name} “${v}” is not a number.`)
      if (f.kind === 'image') {
        const path = ASSET.test(v) ? v : pictures.get(pictureKey(v))
        if (!path) return void problems.push(`${at}: picture “${v}” was not picked.`)
        card.values[f.id] = path
        return
      }
      if (f.kind === 'choice' && !f.choices?.some((x) => same(x, v))) fields[fi] = { ...f, choices: [...(f.choices ?? []), v] }
      card.values[f.id] = v
    })
    if (old) {
      cards[cards.indexOf(old)] = card
      updated++
    } else {
      cards.push(card)
      created.push(card.id)
    }
  }

  let out: CardDoc = { ...doc, fields, cards }
  for (const id of created) out = seedNewCard(out, id, fromId ?? doc.cards[0]?.id)
  for (const b of boxes) out = linkBox(out, b.key, b.fieldId, b.name)
  return { doc: out, added: created.length, updated, newFields, problems }
}

/**
 * The box shows `{Field}` on every card from now on. A card that got no value from the sheet keeps
 * what its box said, as its value for the field.
 */
function linkBox(doc: CardDoc, key: Id, fieldId: Id, name: string): CardDoc {
  const link = `{${name}}`
  const side = doc.front.nodes.some((n) => n.id === key) ? 'front' : doc.back.nodes.some((n) => n.id === key) ? 'back' : null
  const textOn = (c: Id) => {
    if (side) return doc.overrides?.[c]?.texts?.[key] ?? ''
    const n = Object.values(doc.overrides?.[c]?.nodes ?? {})
      .flat()
      .find((x) => keyOf(x) === key)
    return n?.kind === 'card-text' ? (n.ownText ? n.text : (doc.sharedTexts?.[key] ?? n.text)) : ''
  }
  let out: CardDoc = { ...doc, cards: doc.cards.map((c) => (c.values[fieldId] || !textOn(c.id).trim() ? c : { ...c, values: { ...c.values, [fieldId]: textOn(c.id).trim() } })) }
  if (side) {
    out = { ...out, [side]: { ...out[side], nodes: out[side].nodes.map((n) => (n.id === key && n.kind === 'card-text' ? { ...n, text: link, ownText: undefined } : n)) } }
    for (const c of Object.keys(out.overrides ?? {}))
      if (out.overrides?.[c]?.texts?.[key] !== undefined) out = setOverride(out, c, (o) => ({ ...o, texts: Object.fromEntries(Object.entries(o.texts ?? {}).filter(([k]) => k !== key)) }))
    return out
  }
  // Copies on layers that are not on every card share their text by textKey (like a box on every card).
  const relink = (n: CardNode): CardNode => (n.kind === 'card-text' && keyOf(n) === key ? { ...n, text: link, ownText: undefined, textKey: key } : n)
  return {
    ...out,
    sharedTexts: { ...out.sharedTexts, [key]: link },
    overrides: Object.fromEntries(Object.entries(out.overrides ?? {}).map(([c, o]) => [c, o.nodes ? { ...o, nodes: Object.fromEntries(Object.entries(o.nodes).map(([l, ns]) => [l, ns.map(relink)])) } : o])),
  }
}

/** The deck as spreadsheet rows: one column per field, then Copies and Variant (what a fill reads back). */
export function deckRows(doc: CardDoc, cards = doc.cards): string[][] {
  return [
    [...doc.fields.map((f) => f.name), 'Copies', 'Variant'],
    ...cards.map((c) => [...doc.fields.map((f) => c.values[f.id] ?? ''), String(c.copies), doc.variants.find((v) => v.id === c.variantId)?.name ?? '']),
  ]
}
