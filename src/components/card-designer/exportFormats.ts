import { MM_PER_INCH, PAGE_SIZES, type Size } from '@/shared/print'
import type { CardDoc, ExportRecord, ExportSettings } from './model'

/** What the export window starts with; a deck keeps the user's changes in `CardDoc.exportSettings`. */
export const DEFAULT_EXPORT: ExportSettings = {
  target: 'home',
  cards: 'all',
  picked: [],
  addBleedMm: 0,
  fill: 'edge',
  fillColour: '#ffffff',
  dpi: 300,
  lossless: false,
  paper: 'a4',
  paperW: 210,
  paperH: 297,
  homeFormat: 'pdf',
  backs: true,
  backX: 0,
  backY: 0,
  shop: 'mpc',
  photo: '10x15',
  photoMeasuredMm: 0,
  photoBacks: 'fold',
  shopFormat: 'pdf',
  tts: 'ready',
  godotWidth: 512,
  godotSheet: false,
  godotRound: true,
  godotNoText: false,
  godotFolder: 'res://cards/',
  data: 'json',
  matchDeck: '',
}

export const exportSettings = (d: CardDoc): ExportSettings => ({ ...DEFAULT_EXPORT, ...d.exportSettings })

export interface PrintShop {
  id: string
  name: string
  /** Bleed on every side, in inches (or mm for `bleedMm`). */
  bleedIn: number
  format: 'png' | 'pdf'
  /** Card sizes the shop prints, trim size in inches; none = any size. */
  sizes: { name: string; w: number; h: number }[]
  hint: string
}

/**
 * Print shop presets. Pixel sizes come from the shops' own templates (300 DPI): MakePlayingCards poker is
 * 822 × 1122 px (2.5 × 3.5 in + 36 px a side), The Game Crafter poker 825 × 1125 px (1/8 in a side).
 */
export const PRINT_SHOPS: PrintShop[] = [
  {
    id: 'mpc',
    name: 'MakePlayingCards',
    bleedIn: 0.12,
    format: 'png',
    sizes: [
      { name: 'Poker', w: 2.5, h: 3.5 },
      { name: 'Bridge', w: 2.25, h: 3.5 },
      { name: 'Tarot', w: 2.75, h: 4.75 },
      { name: 'Mini', w: 1.75, h: 2.5 },
      { name: 'Micro', w: 1.25, h: 1.75 },
      { name: 'Large', w: 3.5, h: 5.75 },
      { name: 'Square', w: 3.5, h: 3.5 },
      { name: 'Small square', w: 2, h: 2 },
      { name: 'Business', w: 2, h: 3.5 },
      { name: 'Domino', w: 1.75, h: 3.5 },
    ],
    hint: 'One PNG per card side at the size MakePlayingCards asks for. Upload them and set the numbers from copies.txt. Keep text 36 px inside the cut line.',
  },
  {
    id: 'tgc',
    name: 'The Game Crafter',
    bleedIn: 0.125,
    format: 'png',
    sizes: [
      { name: 'Poker', w: 2.5, h: 3.5 },
      { name: 'Bridge', w: 2.25, h: 3.5 },
      { name: 'Tarot', w: 2.75, h: 4.75 },
      { name: 'Mini', w: 1.75, h: 2.5 },
      { name: 'Micro', w: 1.25, h: 1.75 },
      { name: 'Jumbo', w: 3.5, h: 5.5 },
      { name: 'Euro poker', w: 2.48, h: 3.46 },
      { name: 'US game', w: 2.2, h: 3.43 },
      { name: 'Business', w: 2, h: 3.5 },
      { name: 'Domino', w: 1.75, h: 3.5 },
    ],
    hint: 'One PNG per card side at the size The Game Crafter asks for (it takes no PDFs). Check the size against its template for your product before ordering.',
  },
  { id: 'pdf-mm', name: 'Print shop PDF, 3 mm bleed', bleedIn: 3 / MM_PER_INCH, format: 'pdf', sizes: [], hint: 'One card per page with 3 mm bleed, what most European print shops ask for. Each front is followed by its back.' },
  { id: 'pdf-in', name: 'Print shop PDF, 1/8 inch bleed', bleedIn: 0.125, format: 'pdf', sizes: [], hint: 'One card per page with 1/8 inch (3.175 mm) bleed, what most US print shops ask for. Each front is followed by its back.' },
  { id: 'other', name: 'Other print shop', bleedIn: 0, format: 'pdf', sizes: [], hint: 'Pick the bleed and file type your print shop asks for.' },
]

/**
 * Photo print sizes (mm) of photo stations, like the ones in drugstores (janky printing). Every photo is made at
 * exactly this shape, so the station has nothing to crop.
 */
export const PHOTO_SIZES: { id: string; name: string; w: number; h: number }[] = [
  { id: '9x13', name: '9 × 13 cm', w: 90, h: 130 },
  { id: '10x15', name: '10 × 15 cm', w: 100, h: 150 },
  { id: '13x18', name: '13 × 18 cm', w: 130, h: 180 },
  { id: '15x20', name: '15 × 20 cm', w: 150, h: 200 },
  { id: '20x30', name: '20 × 30 cm', w: 200, h: 300 },
]

export const shopById = (id: string) => PRINT_SHOPS.find((s) => s.id === id) ?? PRINT_SHOPS[0]

/**
 * The shop's size for this card (turned for landscape cards), within 2 % on each side, plus the exact pixel size
 * of one exported side at 300 DPI with the shop's bleed. `null` when the shop has no such card.
 */
export function shopSize(shop: PrintShop, cardMm: { w: number; h: number }) {
  const wide = cardMm.w > cardMm.h
  const close = (a: number, b: number) => Math.abs(a - b) <= 0.02 * b
  const s = shop.sizes.find((z) => close(cardMm.w, (wide ? z.h : z.w) * MM_PER_INCH) && close(cardMm.h, (wide ? z.w : z.h) * MM_PER_INCH))
  if (!s) return null
  const [w, h] = wide ? [s.h, s.w] : [s.w, s.h]
  return { name: s.name, w, h, width: Math.round((w + 2 * shop.bleedIn) * 300), height: Math.round((h + 2 * shop.bleedIn) * 300) }
}

/** The shop size nearest to the card's, for the "no such card" hint. */
export function nearestShopSize(shop: PrintShop, cardMm: { w: number; h: number }) {
  const [a, b] = [Math.min(cardMm.w, cardMm.h), Math.max(cardMm.w, cardMm.h)]
  const dist = (z: { w: number; h: number }) => Math.hypot(z.w * MM_PER_INCH - a, z.h * MM_PER_INCH - b)
  return [...shop.sizes].sort((x, y) => dist(x) - dist(y))[0]
}

/** Columns and rows for a sprite sheet of `n` equal cells, about square. */
export function atlasGrid(n: number) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)))
  return { cols, rows: Math.max(1, Math.ceil(n / cols)) }
}

/** A Godot 4 AtlasTexture: one card cut out of the sprite sheet at `sheetPath` (res://…). */
export function godotAtlasTexture(sheetPath: string, x: number, y: number, w: number, h: number) {
  return `[gd_resource type="AtlasTexture" load_steps=2 format=3]\n\n[ext_resource type="Texture2D" path="${sheetPath}" id="1"]\n\n[resource]\natlas = ExtResource("1")\nregion = Rect2(${x}, ${y}, ${w}, ${h})\n`
}

/** A Godot folder as res://…/ */
export function godotFolder(f: string) {
  const path = f.trim().replace(/\\/g, '/').replace(/^res:\/\//, '').replace(/^\/+|\/+$/g, '')
  return `res://${path ? `${path}/` : ''}`
}

/** The bleed an export uses: the card's own bleed plus what the export adds (a shop preset sets the total). */
export function exportBleed(d: Pick<CardDoc, 'bleedMm'>, s: ExportSettings) {
  const shop = s.target === 'shop' ? shopById(s.shop) : null
  const totalMm = shop && shop.id !== 'other' ? shop.bleedIn * MM_PER_INCH : Math.max(0, d.bleedMm + s.addBleedMm)
  return { cardMm: d.bleedMm, totalMm, addedMm: totalMm - d.bleedMm }
}

/** Paper for home printing. */
export function homePaper(s: ExportSettings): Size {
  if (s.target === 'photo') {
    const p = PHOTO_SIZES.find((x) => x.id === s.photo) ?? PHOTO_SIZES[1]
    return { w: p.w, h: p.h }
  }
  const p = PAGE_SIZES.find((x) => x.id === s.paper)
  return p ? { w: p.w, h: p.h } : { w: Math.max(50, s.paperW), h: Math.max(50, s.paperH) }
}

/** Exports of the same kind replace each other in the log: one per target, and per shop for print shops. */
export const exportKey = (s: ExportSettings) => (s.target === 'shop' ? `shop:${s.shop}` : s.target)

const TARGET_NAMES: Record<ExportSettings['target'], string> = { home: 'Print at home', shop: 'Print shop', photo: 'Photo station (janky)', tts: 'Tabletop Simulator', godot: 'Godot', data: 'Data' }
const FILL_NAMES: Record<ExportSettings['fill'], string> = { edge: 'stretch the edge', mirror: 'mirror the edge', scale: 'scale the art', colour: 'one colour' }
const mm = (v: number) => `${Math.round(v * 100) / 100} mm`

/**
 * Everything that decides how an export comes out, as lines a person can read. Two exports with the same lines
 * come out the same (for the same card design), so this is also how the window tells whether two decks match.
 */
type CardSize = { widthMm: number; heightMm: number; bleedMm: number }

/** `detail` adds how the bleed is made up (card bleed + added, fill), which only compares between decks with the same card bleed. */
export function settingLines(s: ExportSettings, card: CardSize, detail = true): string[] {
  const lines = [`${TARGET_NAMES[s.target]}${s.target === 'shop' ? `: ${shopById(s.shop).name}` : ''}`, `Card ${mm(card.widthMm)} × ${mm(card.heightMm)}`]
  if (s.target === 'home' || s.target === 'shop' || s.target === 'photo') {
    const b = exportBleed(card, s)
    lines.push(`Bleed ${mm(b.totalMm)} in total`)
    if (detail) lines.push(`Card bleed ${mm(b.cardMm)} + added ${mm(b.addedMm)}${b.addedMm > 0.001 ? `, ${FILL_NAMES[s.fill]}${s.fill === 'colour' ? ` ${s.fillColour}` : ''}` : ''}`)
  }
  const shopPdf = s.target === 'shop' && (s.shop === 'other' ? s.shopFormat : shopById(s.shop).format) === 'pdf'
  if (s.target === 'home') {
    const paper = homePaper(s)
    lines.push(`${PAGE_SIZES.find((p) => p.id === s.paper)?.name ?? `${mm(paper.w)} × ${mm(paper.h)}`}, ${s.homeFormat.toUpperCase()}, ${s.dpi} DPI${s.lossless && s.homeFormat === 'pdf' ? ', lossless' : ''}`)
    lines.push(s.backs ? `Backs on every other page, moved ${mm(s.backX)} → ${mm(s.backY)} ↓` : 'No backs')
  }
  if (s.target === 'shop') {
    if (s.shop === 'other') lines.push(s.shopFormat === 'pdf' ? 'PDF, one card per page' : 'PNG for every card side')
    if (!shopById(s.shop).sizes.length) lines.push(`${s.dpi} DPI`)
    if (shopPdf) lines.push(`${s.backs ? 'With backs' : 'No backs'}${s.lossless ? ', lossless' : ''}`)
  }
  if (s.target === 'photo') {
    lines.push(`${PHOTO_SIZES.find((p) => p.id === s.photo)?.name ?? s.photo} photos`)
    lines.push(`Backs: ${s.photoBacks === 'fold' ? 'next to the front, to fold' : s.photoBacks === 'photos' ? 'on extra photos' : 'none'}${s.photoMeasuredMm > 0 ? `, scaled for a measured ${mm(s.photoMeasuredMm)}` : ''}`)
  }
  if (s.target === 'tts') lines.push(s.tts === 'ready' ? 'Ready deck' : 'Card sheets (ZIP)')
  if (s.target === 'godot') lines.push(`${s.godotWidth} px wide, ${s.godotSheet ? 'one sprite sheet + .tres' : 'a PNG per card'}${s.godotRound ? ', round corners' : ''}${s.godotNoText ? ', without text' : ''}, ${godotFolder(s.godotFolder)}`)
  if (s.target === 'data') lines.push(s.data === 'csv' ? 'Spreadsheet (CSV)' : 'Deck JSON')
  return lines
}

export const recordCard = (r: ExportRecord): CardSize => ({ widthMm: r.widthMm, heightMm: r.heightMm, bleedMm: r.cardBleedMm })

/** Whether two exports come out the same. Decks with different card bleeds still match when the total bleed does. */
export function sameExport(a: ExportSettings, ac: CardSize, b: ExportSettings, bc: CardSize) {
  const detail = Math.abs(ac.bleedMm - bc.bleedMm) < 0.001
  return settingLines(a, ac, detail).join('\n') === settingLines(b, bc, detail).join('\n')
}

/** The deck with this export at the top of its log (replacing the last one of the same kind). */
export function logExport(d: CardDoc, s: ExportSettings, cards: number, at = new Date().toISOString()): CardDoc {
  const r: ExportRecord = { key: exportKey(s), at, settings: { ...s, picked: [] }, widthMm: d.widthMm, heightMm: d.heightMm, cardBleedMm: d.bleedMm, cards }
  return { ...d, exportLog: [r, ...(d.exportLog ?? []).filter((x) => x.key !== r.key)].slice(0, 30) }
}

/**
 * Settings that make this deck come out like record `r`: the same choices and the same total bleed (the added bleed
 * makes up for a different card bleed). Which cards to export and the deck to match stay this deck's own.
 */
export function settingsFrom(r: ExportRecord, d: Pick<CardDoc, 'bleedMm'>, cur: ExportSettings): ExportSettings {
  const addBleedMm = Math.round((r.settings.addBleedMm + r.cardBleedMm - d.bleedMm) * 1000) / 1000
  return { ...DEFAULT_EXPORT, ...r.settings, cards: cur.cards, picked: cur.picked, matchDeck: cur.matchDeck, addBleedMm }
}
