import { zipSync } from 'fflate'
import { assetBlobUrl } from '@/core/assets'
import { safeFileName, saveBinaryFile, saveTextFile } from '@/core/export'
import { getFs, isTauri } from '@/core/fs'
import type { Id } from '@/core/model'
import { toCSV } from '@/shared/csv'
import { canvasBytes, cardsToPdf, drawSheets, extendIntoBleed, mirrorIntoBleed, MM_PER_INCH, mmToPx, sheetLayout, sheetsToPdf, type SheetLayout } from '@/shared/print'
import { atlasGrid, exportBleed, godotAtlasTexture, godotFolder, homePaper, shopById, shopSize } from './exportFormats'
import { cardArea, composeScene, deckJson, expandCopies, MM, slotColors, ttsFileUrl, ttsSavedObject, ttsSheets, type Card, type CardDoc, type CardNode, type ExportSettings } from './model'
import { cardNodeTypes } from './nodeTypes'
import { loadSceneFonts, preloadImages, renderCard } from './render'
import { deckRows } from './sheetImport'
import { allNodes, cardLabel, ownIcons } from './ui'

export interface ExportDeck {
  d: CardDoc
  title: string
  /** The cards to export (already narrowed to the picked ones). */
  cards: Card[]
  root: string | null
}

type Side = 'front' | 'back'

/** Load fonts and pictures once; returns a function that draws one card side. */
export async function cardPainter(d: CardDoc, cards: Card[], root: string | null) {
  await loadSceneFonts([d.front, d.back, { layers: [], nodes: allNodes(d) }])
  const imageFields = d.fields.filter((f) => f.kind === 'image').map((f) => f.id)
  const paths = [...cards.flatMap((c) => imageFields.map((f) => c.values[f] ?? '')), ...allNodes(d).flatMap((n) => (n.kind === 'image' ? [n.src] : [])), ...(d.icons ?? []).map((i) => i.src)]
  const resolve = await preloadImages(paths, (p) => (root ? assetBlobUrl(root, p) : Promise.resolve(null)))
  const paint = (c: Card, side: Side, dpi: number, o: { bleed?: boolean; mask?: boolean; noText?: boolean; doc?: CardDoc } = {}) => {
    const doc = o.doc ?? d
    const types = cardNodeTypes({ colors: slotColors(d, c.variantId, c.id), fields: d.fields, values: c.values, print: true, icons: ownIcons(d), mask: o.mask })
    const scene = composeScene(d, side, c.id)
    return renderCard(doc, o.noText ? { ...scene, nodes: scene.nodes.filter((n) => n.kind !== 'card-text') } : scene, types, resolve, dpi, o.bleed ?? false)
  }
  return { paint, resolve }
}
export type Paint = Awaited<ReturnType<typeof cardPainter>>['paint']

/**
 * Grow (or crop) a card picture's bleed by `add` pixels on every side without touching the card: the new strip
 * is filled from the picture's edge, mirrored, or with a colour.
 */
export function growBleed(c: HTMLCanvasElement, add: number, fill: ExportSettings['fill'], colour: string): HTMLCanvasElement {
  if (!add) return c
  const out = document.createElement('canvas')
  out.width = c.width + 2 * add
  out.height = c.height + 2 * add
  const g = out.getContext('2d')!
  if (add > 0 && fill === 'colour') {
    g.fillStyle = colour
    g.fillRect(0, 0, out.width, out.height)
  }
  g.drawImage(c, add, add)
  if (add > 0 && fill !== 'colour') {
    const img = g.getImageData(0, 0, out.width, out.height)
    if (fill === 'mirror') mirrorIntoBleed(img.data, out.width, out.height, add)
    else extendIntoBleed(img.data, out.width, out.height, add)
    g.putImageData(img, 0, 0)
  }
  return out
}

/** One card side for print: the card with its own bleed, plus the export's added bleed. The design is never changed. */
export function printSide(paint: Paint, d: CardDoc, s: ExportSettings, c: Card, side: Side, dpi: number, mask = false) {
  const { cardMm, totalMm } = exportBleed(d, s)
  if (s.fill === 'scale' && totalMm > cardMm) {
    // Scale the art (not the text) from the card's bleed out to the total, like Card size's switch, for this export only.
    const from = d.bleedScales ? (d.bleedScaleFromMm ?? cardMm) : cardMm
    return paint(c, side, dpi, { bleed: true, mask, doc: { ...d, bleedMm: totalMm, bleedScales: true, bleedScaleFromMm: from } })
  }
  const add = mmToPx(totalMm, dpi) - mmToPx(cardMm, dpi)
  // Foil masks: a coloured strip is not foil.
  return growBleed(paint(c, side, dpi, { bleed: true, mask }), add, mask && s.fill === 'colour' ? 'edge' : s.fill, s.fillColour)
}

/** A Godot / game side: no bleed, exactly `width` px wide, corners cut round if asked. */
export function gameSide(paint: Paint, d: CardDoc, s: ExportSettings, c: Card, side: Side) {
  const dpi = (s.godotWidth * MM_PER_INCH) / d.widthMm
  const out = paint(c, side, dpi, { noText: s.godotNoText })
  if (s.godotRound && d.cornerMm > 0) {
    const g = out.getContext('2d')!
    g.globalCompositeOperation = 'destination-in'
    g.beginPath()
    g.roundRect(0, 0, out.width, out.height, (d.cornerMm * dpi) / MM_PER_INCH)
    g.fill()
  }
  return out
}

/** Foil masks go to print shops black on white. */
function onWhite(src: HTMLCanvasElement) {
  const c = document.createElement('canvas')
  c.width = src.width
  c.height = src.height
  const g = c.getContext('2d')!
  g.fillStyle = '#fff'
  g.fillRect(0, 0, c.width, c.height)
  g.drawImage(src, 0, 0)
  return c
}

/** Unique file names for cards, by card name. */
function cardFileNames(d: CardDoc, cards: Card[]) {
  const names = new Map<Id, string>()
  const used = new Set<string>()
  for (const c of cards) {
    const want = safeFileName(cardLabel(d, c), 'card')
    let base = want
    for (let n = 2; used.has(base.toLowerCase()); n++) base = `${want} ${n}`
    used.add(base.toLowerCase())
    names.set(c.id, base)
  }
  return names
}

const sameAll = (sides: HTMLCanvasElement[]) => new Set(sides.map((c) => c.toDataURL())).size <= 1
const zip = (files: Record<string, Uint8Array>) => zipSync(files, { level: 0 })
const text = (s: string) => new TextEncoder().encode(s)

/** Run an export with the window's settings. `mask` exports the foil masks of a print export instead. False when the save was cancelled. */
export async function runExport({ d, title, cards, root }: ExportDeck, s: ExportSettings, mask = false): Promise<boolean> {
  if (!cards.length) throw new Error('No cards to export.')
  const name = safeFileName(title)
  if (s.target === 'data') {
    if (s.data === 'csv') return (await saveTextFile({ title: 'Export deck as spreadsheet', defaultName: `${name}.csv`, text: toCSV(deckRows(d, cards)), filter: { name: 'CSV', extensions: ['csv'] } }))
    return (await saveTextFile({ title: 'Export deck', defaultName: `${name}.json`, text: JSON.stringify(deckJson(title, d, cards), null, 2), filter: { name: 'JSON', extensions: ['json'] } }))
  }
  const { paint } = await cardPainter(d, cards, root)
  // The ready deck needs the desktop app (it writes beside Tabletop Simulator's saves); a browser gets the ZIP.
  if (s.target === 'tts') return s.tts === 'ready' && isTauri() ? ttsReadyDeck(d, title, name, cards, paint) : ttsZip(d, name, cards, paint)
  if (s.target === 'godot') return godotZip(d, s, title, name, cards, paint)

  const what = mask ? 'foil masks' : 'print'
  const finish = (c: HTMLCanvasElement) => (mask ? onWhite(c) : c)
  const deck = expandCopies(cards)
  if (s.target === 'home' || s.target === 'photo') {
    const { totalMm } = exportBleed(d, s)
    const photo = s.target === 'photo'
    const dpi = photo ? 300 : s.dpi
    const sides = new Map<string, HTMLCanvasElement>()
    const side = (c: Card, sd: Side) => sides.get(c.id + sd) ?? sides.set(c.id + sd, printSide(paint, d, s, c, sd, dpi, mask)).get(c.id + sd)!
    if (photo) {
      const fold = s.photoBacks === 'fold'
      // Fold: back and front side by side as one wide "card", folded (or cut and glued) along the middle.
      const layout = sheetLayout(homePaper(s), fold ? foldPairSize(d, totalMm) : { w: d.widthMm, h: d.heightMm }, totalMm)
      if (!layout.slots.length) throw new Error('The card is bigger than the photo: pick a bigger photo size.')
      const fronts = deck.map((c) => (fold ? foldPair(side(c, 'front'), side(c, 'back')) : side(c, 'front')))
      const pages = drawSheets(layout, fronts, dpi, totalMm, s.photoBacks === 'photos' ? deck.map((c) => side(c, 'back')) : undefined)
      if (fold) for (const p of pages) foldMarks(p, layout, totalMm, d.widthMm, dpi)
      return photoZip(name, pages.map((p) => scaled(p, s.photoMeasuredMm > 0 ? d.widthMm / s.photoMeasuredMm : 1)), s.photoBacks === 'photos')
    }
    const layout = sheetLayout(homePaper(s), { w: d.widthMm, h: d.heightMm }, totalMm)
    if (!layout.slots.length) throw new Error('The card is bigger than the paper.')
    const pages = drawSheets(layout, deck.map((c) => side(c, 'front')), dpi, totalMm, s.backs ? deck.map((c) => side(c, 'back')) : undefined, { x: s.backX, y: s.backY }).map(finish)
    if (s.homeFormat === 'pdf') return (await saveBinaryFile({ title: 'Export PDF', defaultName: `${name} ${what}.pdf`, bytes: await sheetsToPdf(layout, pages, s.lossless), filter: { name: 'PDF', extensions: ['pdf'] } }))
    if (pages.length === 1) return (await saveBinaryFile({ title: 'Export print sheet', defaultName: `${name} ${what}.png`, bytes: await canvasBytes(pages[0]), filter: { name: 'PNG', extensions: ['png'] } }))
    const files: Record<string, Uint8Array> = {}
    for (let i = 0; i < pages.length; i++) files[`page ${String(i + 1).padStart(2, '0')}.png`] = await canvasBytes(pages[i])
    return (await saveBinaryFile({ title: 'Export print sheets', defaultName: `${name} ${what} pages.zip`, bytes: zip(files), filter: { name: 'Zip', extensions: ['zip'] } }))
  }

  // Print shop.
  const shop = shopById(s.shop)
  const { totalMm } = exportBleed(d, s)
  const exact = shop.sizes.length ? shopSize(shop, { w: d.widthMm, h: d.heightMm }) : null
  if (shop.sizes.length && !exact) throw new Error(`${shop.name} has no card of ${d.widthMm} × ${d.heightMm} mm. Change the card size or pick another print shop.`)
  // Shop sizes: draw so the cut line lands on the shop's own size, then fit the exact pixel size it asks for.
  const dpi = exact ? (exact.w * 300 * MM_PER_INCH) / d.widthMm : s.dpi
  const draw = (c: Card, sd: Side) => {
    const pic = finish(printSide(paint, d, s, c, sd, dpi, mask))
    if (!exact || (pic.width === exact.width && pic.height === exact.height)) return pic
    const out = document.createElement('canvas')
    out.width = exact.width
    out.height = exact.height
    out.getContext('2d')!.drawImage(pic, 0, 0, exact.width, exact.height)
    return out
  }
  const format = shop.id === 'other' ? s.shopFormat : shop.format
  if (format === 'pdf') {
    const sides = new Map<Id, [HTMLCanvasElement, HTMLCanvasElement]>(cards.map((c) => [c.id, [draw(c, 'front'), draw(c, 'back')]]))
    const pages = deck.flatMap((c) => (s.backs ? sides.get(c.id)! : [sides.get(c.id)![0]]))
    const bytes = await cardsToPdf(pages, d.widthMm + 2 * totalMm, d.heightMm + 2 * totalMm, totalMm, s.lossless)
    return (await saveBinaryFile({ title: 'Export PDF', defaultName: `${name} ${what} cards.pdf`, bytes, filter: { name: 'PDF', extensions: ['pdf'] } }))
  }
  const names = cardFileNames(d, cards)
  const files: Record<string, Uint8Array> = {}
  const backs = cards.map((c) => draw(c, 'back'))
  const oneBack = sameAll(backs)
  for (const [i, c] of cards.entries()) {
    files[`${names.get(c.id)}.png`] = await canvasBytes(draw(c, 'front'))
    if (!oneBack) files[`${names.get(c.id)} back.png`] = await canvasBytes(backs[i])
  }
  if (oneBack) files['back.png'] = await canvasBytes(backs[0])
  files['copies.txt'] = text(`${cards.map((c) => `${c.copies} × ${names.get(c.id)}`).join('\n')}\n\n${deck.length} cards in total.\n`)
  return saveBinaryFile({ title: 'Export cards', defaultName: `${name} ${what} cards.zip`, bytes: zip(files), filter: { name: 'Zip', extensions: ['zip'] } })
}

/** A page drawn bigger or smaller around its middle on white (to make up for a photo station that prints off-size). */
function scaled(page: HTMLCanvasElement, k: number) {
  if (Math.abs(k - 1) < 0.001) return page
  const out = document.createElement('canvas')
  out.width = page.width
  out.height = page.height
  const g = out.getContext('2d')!
  g.fillStyle = '#fff'
  g.fillRect(0, 0, out.width, out.height)
  g.drawImage(page, (page.width * (1 - k)) / 2, (page.height * (1 - k)) / 2, page.width * k, page.height * k)
  return out
}

/**
 * Back on the left, front on the right, each with its whole bleed, so the middle has bleed too. Fold backwards
 * along the middle and glue: the two inner cut lines land on each other, and cutting all four sides through both
 * layers gives an even card with the back the right way round.
 */
export function foldPair(front: HTMLCanvasElement, back: HTMLCanvasElement) {
  const out = document.createElement('canvas')
  out.width = 2 * front.width
  out.height = front.height
  const g = out.getContext('2d')!
  g.drawImage(back, 0, 0)
  g.drawImage(front, front.width, 0)
  return out
}

/** The size a fold pair takes on the photo, minus its outer bleed (what `sheetLayout` calls the card). */
export const foldPairSize = (d: CardDoc, bleedMm: number) => ({ w: 2 * (d.widthMm + bleedMm), h: d.heightMm })

/** Marks in the top and bottom margin of every fold pair: both inner cut lines (solid) and the fold (dashed). */
function foldMarks(page: HTMLCanvasElement, layout: SheetLayout, bleed: number, cardW: number, dpi: number) {
  if (!layout.slots.length) return
  const g = page.getContext('2d')!
  const top = layout.slots[0].y + bleed - 1
  const bottom = layout.slots[layout.slots.length - 1].y + layout.cell.h - bleed + 1
  g.strokeStyle = '#000'
  g.lineWidth = Math.max(1, dpi / 300)
  for (const s of layout.slots) {
    for (const [x, dashed] of [[s.x + bleed + cardW, false], [s.x + 2 * bleed + cardW, true], [s.x + 3 * bleed + cardW, false]] as const) {
      g.setLineDash(dashed ? [mmToPx(1, dpi), mmToPx(1, dpi)] : [])
      for (const [y1, y2] of [[0, top], [bottom, layout.page.h]]) {
        g.beginPath()
        g.moveTo(mmToPx(x, dpi), mmToPx(y1, dpi))
        g.lineTo(mmToPx(x, dpi), mmToPx(y2, dpi))
        g.stroke()
      }
    }
  }
  g.setLineDash([])
}

/** Photo station (janky): JPG photos, fronts and (as extra photos to glue on) backs. */
async function photoZip(name: string, pages: HTMLCanvasElement[], backs: boolean) {
  const files: Record<string, Uint8Array> = {}
  const step = backs ? 2 : 1
  for (let i = 0; i < pages.length; i += step) {
    const n = String(i / step + 1).padStart(2, '0')
    files[`photo ${n}${backs ? ' front' : ''}.jpg`] = await canvasBytes(pages[i], 'image/jpeg')
    if (backs) files[`photo ${n} back.jpg`] = await canvasBytes(pages[i + 1], 'image/jpeg')
  }
  return saveBinaryFile({ title: 'Export photos', defaultName: `${name} photos.zip`, bytes: zip(files), filter: { name: 'Zip', extensions: ['zip'] } })
}

/** Godot: card pictures (or one sprite sheet with an AtlasTexture .tres per card) and deck.json with res:// paths. */
async function godotZip(d: CardDoc, s: ExportSettings, title: string, name: string, cards: Card[], paint: Paint) {
  const folder = godotFolder(s.godotFolder)
  const names = cardFileNames(d, cards)
  const fronts = cards.map((c) => gameSide(paint, d, s, c, 'front'))
  const backs = cards.map((c) => gameSide(paint, d, s, c, 'back'))
  const oneBack = sameAll(backs)
  // Every picture: [file name without extension, canvas]; the shared back once.
  const pics: [string, HTMLCanvasElement][] = cards.flatMap((c, i) => [[names.get(c.id)!, fronts[i]] as [string, HTMLCanvasElement], ...(oneBack ? [] : [[`${names.get(c.id)} back`, backs[i]] as [string, HTMLCanvasElement]])])
  if (oneBack) pics.push(['back', backs[0]])
  const files: Record<string, Uint8Array> = {}
  const ext = s.godotSheet ? 'tres' : 'png'
  if (s.godotSheet) {
    const { cols, rows } = atlasGrid(pics.length)
    const w = fronts[0].width
    const h = fronts[0].height
    if (cols * w > 16384 || rows * h > 16384) throw new Error(`The sprite sheet would be ${cols * w} × ${rows * h} px; Godot takes up to 16384. Pick a smaller width or separate pictures.`)
    const sheet = document.createElement('canvas')
    sheet.width = cols * w
    sheet.height = rows * h
    const g = sheet.getContext('2d')!
    pics.forEach(([file, c], i) => {
      const x = (i % cols) * w
      const y = Math.floor(i / cols) * h
      g.drawImage(c, x, y)
      files[`${file}.tres`] = text(godotAtlasTexture(`${folder}cards.png`, x, y, w, h))
    })
    files['cards.png'] = await canvasBytes(sheet)
  } else {
    for (const [file, c] of pics) files[`${file}.png`] = await canvasBytes(c)
  }
  const images = new Map(cards.map((c) => [c.id, `${folder}${names.get(c.id)}.${ext}`]))
  const backPaths = new Map(cards.map((c) => [c.id, `${folder}${oneBack ? 'back' : `${names.get(c.id)} back`}.${ext}`]))
  files['deck.json'] = text(JSON.stringify(deckJson(title, d, cards, images, backPaths), null, 2))
  return saveBinaryFile({ title: 'Export for Godot', defaultName: `${name} Godot.zip`, bytes: zip(files), filter: { name: 'Zip', extensions: ['zip'] } })
}

/** Tabletop Simulator sheet pictures by file name, and what each sheet holds. */
async function ttsFiles(d: CardDoc, cards: Card[], paint: Paint, base: string) {
  const deck = expandCopies(cards)
  const plan = ttsSheets(deck.length)
  if (!plan.length) throw new Error('The deck has no cards.')
  // Keep each sheet within 4096 px, the size Tabletop Simulator loads quickly.
  const res = Math.min(200, Math.floor((4096 * 25.4) / Math.max(...plan.map((p) => Math.max(p.cols * d.widthMm, p.rows * d.heightMm)))))
  const fronts = new Map(cards.map((c) => [c.id, paint(c, 'front', res)]))
  const backsMap = new Map(cards.map((c) => [c.id, paint(c, 'back', res)]))
  const backSides = deck.map((c) => backsMap.get(c.id)!)
  const uniqueBacks = !sameAll([...backsMap.values()])
  const files: Record<string, Uint8Array> = {}
  const sheets: { face: string; back: string; cols: number; rows: number; cards: Card[] }[] = []
  const sheet = (sides: HTMLCanvasElement[], cols: number, rows: number) => {
    const out = document.createElement('canvas')
    out.width = cols * sides[0].width
    out.height = rows * sides[0].height
    const g = out.getContext('2d')!
    sides.forEach((c, i) => g.drawImage(c, (i % cols) * c.width, Math.floor(i / cols) * c.height))
    // The last cell is what Tabletop Simulator shows for a hidden card.
    g.drawImage(backSides[0], (cols - 1) * backSides[0].width, (rows - 1) * backSides[0].height)
    return canvasBytes(out)
  }
  let start = 0
  for (const [i, p] of plan.entries()) {
    const part = plan.length > 1 ? ` ${i + 1}` : ''
    const grid = `${p.cols}x${p.rows} - ${p.count} cards`
    const face = `${base} faces${part} - ${grid}.png`
    const back = uniqueBacks ? `${base} backs${part} - ${grid}.png` : `${base} back.png`
    files[face] = await sheet(deck.slice(start, start + p.count).map((c) => fronts.get(c.id)!), p.cols, p.rows)
    if (uniqueBacks) files[back] = await sheet(backSides.slice(start, start + p.count), p.cols, p.rows)
    sheets.push({ face, back, cols: p.cols, rows: p.rows, cards: deck.slice(start, start + p.count) })
    start += p.count
  }
  if (!uniqueBacks) files[`${base} back.png`] = await canvasBytes(backSides[0])
  return { files, sheets, uniqueBacks, thumbnail: await canvasBytes(fronts.get(deck[0].id)!) }
}

async function ttsZip(d: CardDoc, name: string, cards: Card[], paint: Paint) {
  const { files } = await ttsFiles(d, cards, paint, name)
  return saveBinaryFile({ title: 'Export for Tabletop Simulator', defaultName: `${name} Tabletop Simulator.zip`, bytes: zip(files), filter: { name: 'Zip', extensions: ['zip'] } })
}

async function ttsReadyDeck(d: CardDoc, title: string, name: string, cards: Card[], paint: Paint) {
  const fs = getFs()
  const [{ save }, path] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/api/path')])
  const file = await save({ title: 'Save deck for Tabletop Simulator', defaultPath: await fs.join(await ttsSavedObjectsDir(), `${name}.json`), filters: [{ name: 'Tabletop Simulator deck', extensions: ['json'] }] })
  if (!file) return false
  const dir = await path.dirname(file)
  const base = (await path.basename(file)).replace(/\.json$/i, '')
  const t = await ttsFiles(d, cards, paint, base)
  // The pictures go beside the JSON, which points at them by their full path: they only load on this computer.
  for (const [f, bytes] of Object.entries(t.files)) await fs.writeBinaryAtomic(await fs.join(dir, f), bytes)
  await fs.writeBinaryAtomic(await fs.join(dir, `${base}.png`), t.thumbnail)
  const url = async (f: string) => ttsFileUrl(await fs.join(dir, f))
  const sheets = await Promise.all(t.sheets.map(async (s) => ({ ...s, face: await url(s.face), back: await url(s.back), cards: s.cards.map((c) => ({ name: cardLabel(d, c), description: ttsDescription(d, c) })) })))
  await fs.writeTextAtomic(await fs.join(dir, `${base}.json`), JSON.stringify(ttsSavedObject(title, sheets, t.uniqueBacks, d.widthMm > d.heightMm), null, 2))
  return true
}

/** Where Tabletop Simulator keeps saved objects (Windows, Linux, Mac), so the save dialog starts there; else Downloads. */
async function ttsSavedObjectsDir() {
  const fs = getFs()
  const { homeDir, downloadDir } = await import('@tauri-apps/api/path')
  const home = await homeDir()
  for (const dir of [
    await fs.join(await fs.documentDir(), 'My Games', 'Tabletop Simulator', 'Saves', 'Saved Objects'),
    await fs.join(home, '.local', 'share', 'Tabletop Simulator', 'Saves', 'Saved Objects'),
    await fs.join(home, 'Library', 'Tabletop Simulator', 'Saves', 'Saved Objects'),
  ]) {
    if (await fs.exists(dir).catch(() => false)) return dir
  }
  return downloadDir()
}

/** The card's other fields as "Field: value" lines, for the description Tabletop Simulator shows on hover. */
function ttsDescription(d: CardDoc, c: Card) {
  const first = d.fields.find((f) => f.kind === 'text')
  return d.fields
    .filter((f) => f !== first && f.kind !== 'image' && c.values[f.id])
    .map((f) => `${f.name}: ${c.values[f.id]}`)
    .join('\n')
}

export interface Warning {
  text: string
  cards: Card[]
}

/**
 * Checks before printing: text boxes over the safe line, missing pictures and pictures too small for print.
 * (Empty bleed is checked on the preview picture.)
 */
export async function preflight(d: CardDoc, cards: Card[], resolve: (p: string) => string): Promise<Warning[]> {
  const safe = cardArea(d, 'safe')
  const over = new Set<Card>()
  const missing = new Set<Card>()
  const soft = new Set<Card>()
  const sizes = new Map<string, Promise<number[] | null>>()
  const natural = (url: string) => {
    if (!sizes.has(url)) {
      const img = new Image()
      img.src = url
      sizes.set(url, img.decode().then(() => [img.naturalWidth, img.naturalHeight], () => null))
    }
    return sizes.get(url)!
  }
  for (const c of cards) {
    for (const side of ['front', 'back'] as const) {
      const scene = composeScene(d, side, c.id)
      const hidden = new Set([...scene.layers.filter((l) => l.hidden).map((l) => l.id), ...(d.overrides?.[c.id]?.hidden ?? [])])
      for (const n of scene.nodes as CardNode[]) {
        if (n.hidden || hidden.has(n.layerId)) continue
        const box = n as CardNode & { width?: number; height?: number }
        const w = (box.width ?? 0) * (n.scaleX ?? 1)
        const h = (box.height ?? 0) * (n.scaleY ?? 1)
        if (n.kind === 'card-text' && !n.rotation && (n.x < safe.x || n.y < safe.y || n.x + w > safe.x + safe.width || n.y + h > safe.y + safe.height)) over.add(c)
        const path = n.kind === 'card-image' ? (c.values[n.fieldId] ?? '') : n.kind === 'image' ? n.src : ''
        if (!path) continue
        const url = resolve(path)
        if (!url) {
          missing.add(c)
          continue
        }
        const px = await natural(url)
        // Pixels per inch at the printed size; under 200 looks soft on paper.
        if (px && w > 0 && h > 0 && Math.min(px[0] / (w / MM / MM_PER_INCH), px[1] / (h / MM / MM_PER_INCH)) < 200) soft.add(c)
      }
    }
  }
  const out: Warning[] = []
  if (over.size) out.push({ text: 'A text box crosses the blue safe line and may be cut off', cards: [...over] })
  if (missing.size) out.push({ text: 'A picture is missing', cards: [...missing] })
  if (soft.size) out.push({ text: 'A picture has under 200 pixels per inch at its printed size and will look soft', cards: [...soft] })
  return out
}
