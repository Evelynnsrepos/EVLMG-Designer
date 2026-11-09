import { zipSync } from 'fflate'
import { resolveAssetPath } from '@/core/assets'
import { getFs } from '@/core/fs'
import type { Entity, Id } from '@/core/model'
import { flushAll, loadDocumentNow, useProjectStore } from '@/core/state'
import { toCSV } from '@/shared/csv'
import { mmToPx, makePdf, canvasBytes } from '@/shared/print'
import type { RichTextDoc } from '@/shared/richtext/types'
import { encodeAnimation, makeCanvas, type Exported } from '@/shared/sketch/files/io'
import { aspectOf, cutLabel, formatTime, formatTimecode, fpsOf, linkedText, numberFrames, panelLetter, sceneLabel, type Frame, type Numbered, type StoryboardDoc } from './model'

/** Everything an export needs about one panel, loaded once. */
export interface Prepared {
  frame: Frame
  n: Numbered
  /** The panel's picture at the board's shape (letterboxed), or null when it has none. */
  picture: HTMLCanvasElement | null
  /** Text of the linked Writer part, if any. */
  script: string | null
  characters: string[]
}

const FONT = '"Lexend Deca", system-ui, sans-serif'

async function loadImage(root: string, path: string): Promise<ImageBitmap | null> {
  try {
    const bytes = await getFs().readBinary(await resolveAssetPath(root, path))
    return await createImageBitmap(new Blob([bytes as BlobPart]))
  } catch {
    return null
  }
}

/** Where a panel's picture comes from: its linked drawing (on the drawing's background), else its own picture. */
export async function pictureSource(root: string, f: Frame): Promise<{ path: string; background: string } | null> {
  if (f.sketchId) {
    const d = await loadDocumentNow<{ sticker?: string | null; backgroundColor?: string } | null>(root, 'sketch', f.sketchId, () => null).catch(() => null)
    if (d?.sticker) return { path: d.sticker, background: d.backgroundColor || '#ffffff' }
  }
  return f.image ? { path: f.image, background: '#000000' } : null
}

/** Fit a picture into w × h on a background. */
function fit(img: CanvasImageSource & { width: number; height: number }, w: number, h: number, background: string) {
  const { canvas, ctx } = makeCanvas(w, h)
  ctx.fillStyle = background
  ctx.fillRect(0, 0, w, h)
  const k = Math.min(w / img.width, h / img.height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, (w - img.width * k) / 2, (h - img.height * k) / 2, img.width * k, img.height * k)
  return canvas
}

/** Load pictures, linked Writer text and character names for every panel. */
export async function prepare(root: string, doc: StoryboardDoc, onProgress?: (done: number, total: number) => void): Promise<Prepared[]> {
  await flushAll(root)
  const { w, h } = aspectOf(doc)
  const numbers = numberFrames(doc.frames)
  const characters = useProjectStore.getState().entities.character as Entity[]
  const writers = new Map<Id, RichTextDoc | null>()
  const out: Prepared[] = []
  for (const [i, frame] of doc.frames.entries()) {
    const src = await pictureSource(root, frame)
    const img = src && (await loadImage(root, src.path))
    let script: string | null = null
    if (frame.writer) {
      const id = frame.writer.documentId
      if (!writers.has(id)) {
        const exists = useProjectStore.getState().meta?.documents.some((d) => d.id === id)
        writers.set(id, exists ? ((await loadDocumentNow<{ body?: RichTextDoc } | null>(root, 'writer', id, () => null).catch(() => null))?.body ?? null) : null)
      }
      script = linkedText(writers.get(id), frame.writer.section)
    }
    out.push({
      frame,
      n: numbers[i],
      picture: img ? fit(img, w, h, src!.background) : null,
      script,
      characters: (frame.characterIds ?? []).map((cid) => characters.find((c) => c.id === cid)?.name).filter((x): x is string => !!x),
    })
    img?.close()
    onProgress?.(i + 1, doc.frames.length)
  }
  return out
}

/** What a panel's action column says: its own text, else the linked script. */
const actionText = (p: Prepared) => [p.frame.action.trim() || p.script || '', p.characters.length ? `Characters: ${p.characters.join(', ')}` : ''].filter(Boolean).join('\n')
const cameraText = (f: Frame) => [f.shot, f.camera !== 'Static' ? f.camera : '', f.transition && f.transition !== 'Cut' ? `→ ${f.transition}` : ''].filter(Boolean).join(' · ')

// ---- Text on canvas ------------------------------------------------------------------

/** Wrap text into a box; lines that don't fit end with "…". Returns the height used. */
function textBox(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number, size: number, color = '#222', weight = 400): number {
  ctx.font = `${weight} ${size}px ${FONT}`
  ctx.fillStyle = color
  ctx.textBaseline = 'top'
  const lineH = size * 1.3
  const max = Math.max(1, Math.floor(h / lineH))
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word
      if (ctx.measureText(next).width <= w || !line) line = next
      else {
        lines.push(line)
        line = word
      }
    }
    lines.push(line)
  }
  const shown = lines.slice(0, max)
  if (lines.length > max) {
    let last = shown[max - 1]
    while (last && ctx.measureText(`${last}…`).width > w) last = last.slice(0, -1)
    shown[max - 1] = `${last}…`
  }
  shown.forEach((l, i) => ctx.fillText(l, x, y + i * lineH, w))
  return shown.length * lineH
}

function pictureBox(ctx: CanvasRenderingContext2D, p: Prepared, x: number, y: number, w: number, h: number, aspect: number) {
  // The board's shape, as big as fits the box.
  const k = Math.min(w / aspect, h)
  const bw = k * aspect
  const bh = k
  const bx = x + (w - bw) / 2
  const by = y + (h - bh) / 2
  if (p.picture) ctx.drawImage(p.picture, bx, by, bw, bh)
  else {
    ctx.fillStyle = '#f4f4f4'
    ctx.fillRect(bx, by, bw, bh)
  }
  ctx.strokeStyle = '#222'
  ctx.lineWidth = Math.max(1, w / 300)
  ctx.strokeRect(bx, by, bw, bh)
}

// ---- Print sheets --------------------------------------------------------------------

export type SheetKind = 'columns' | 'grid' | 'large'
export const SHEET_KINDS: { id: SheetKind; label: string; hint: string }[] = [
  { id: 'columns', label: 'Storyboard sheet (5 per page)', hint: 'The classic film and anime board: cut, picture, action, dialogue and time in columns.' },
  { id: 'grid', label: 'Overview (6 per page)', hint: 'Pictures in a grid with short notes under each, landscape. Good to read through quickly.' },
  { id: 'large', label: 'Presentation (1 per page)', hint: 'One big panel per page with its text, landscape. Good for a pitch.' },
]

export interface SheetOptions {
  kind: SheetKind
  /** Paper in mm, portrait. */
  paper: { w: number; h: number }
  title: string
  fps: number
}

const DPI = 150

/** The pages of a printed storyboard. */
export function drawSheetPages(items: Prepared[], doc: StoryboardDoc, o: SheetOptions): HTMLCanvasElement[] {
  const portrait = o.kind === 'columns'
  const pw = mmToPx(portrait ? o.paper.w : o.paper.h, DPI)
  const ph = mmToPx(portrait ? o.paper.h : o.paper.w, DPI)
  const a = aspectOf(doc)
  const aspect = a.w / a.h
  const per = o.kind === 'columns' ? 5 : o.kind === 'grid' ? 6 : 1
  const pages = Math.max(1, Math.ceil(items.length / per))
  const total = items.reduce((s, p) => s + p.frame.seconds, 0)
  const m = pw * 0.05
  const out: HTMLCanvasElement[] = []
  for (let page = 0; page < pages; page++) {
    const { canvas, ctx } = makeCanvas(pw, ph)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, pw, ph)
    const unit = pw / 100
    // Header: title, page, running time.
    textBox(ctx, o.title, m, m * 0.6, pw * 0.6, unit * 3, unit * 2.2, '#000', 600)
    ctx.textAlign = 'right'
    textBox(ctx, `Page ${page + 1} / ${pages} · ${formatTimecode(total, o.fps)}`, pw - m, m * 0.6, pw * 0.35, unit * 3, unit * 1.6, '#555')
    ctx.textAlign = 'left'
    const top = m * 0.6 + unit * 4
    const slice = items.slice(page * per, page * per + per)
    if (o.kind === 'columns') {
      const cols = [0.1, 0.38, 0.27, 0.17, 0.08].map((c) => c * (pw - 2 * m))
      const xs = cols.map((_, i) => m + cols.slice(0, i).reduce((s, c) => s + c, 0))
      const headH = unit * 2.6
      ;['Cut', 'Picture', 'Action / camera', 'Dialogue / sound', 'Time'].forEach((t, i) => textBox(ctx, t, xs[i] + unit * 0.5, top, cols[i] - unit, headH, unit * 1.5, '#000', 600))
      const rowsTop = top + headH
      const rowH = (ph - m - rowsTop) / per
      ctx.strokeStyle = '#999'
      ctx.lineWidth = 1
      for (let r = 0; r <= per; r++) {
        ctx.beginPath()
        ctx.moveTo(m, rowsTop + r * rowH)
        ctx.lineTo(pw - m, rowsTop + r * rowH)
        ctx.stroke()
      }
      slice.forEach((p, r) => {
        const y = rowsTop + r * rowH + unit * 0.6
        const h = rowH - unit * 1.2
        const s = unit * 1.35
        let cy = y
        if (p.n.firstOfScene) cy += textBox(ctx, sceneLabel(p.n), xs[0] + unit * 0.5, cy, cols[0] - unit, s * 2.6 * 1.3, s * 0.9, '#a33', 600)
        textBox(ctx, cutLabel(p.n), xs[0] + unit * 0.5, cy, cols[0] - unit, s * 1.4, s * 1.2, '#000', 700)
        if (p.frame.status) textBox(ctx, p.frame.status, xs[0] + unit * 0.5, y + h - s * 2.3, cols[0] - unit, s * 2.3, s * 0.85, '#555')
        pictureBox(ctx, p, xs[1] + unit * 0.5, y, cols[1] - unit, h, aspect)
        const cam = cameraText(p.frame)
        const used = textBox(ctx, cam, xs[2] + unit * 0.5, y, cols[2] - unit, s * 1.3 * 2, s * 0.95, '#555', 600)
        textBox(ctx, [actionText(p), p.frame.notes ? `Note: ${p.frame.notes}` : ''].filter(Boolean).join('\n'), xs[2] + unit * 0.5, y + used + unit * 0.3, cols[2] - unit, h - used - unit * 0.3, s)
        const dia = [p.frame.dialogue, p.frame.sound ? `♪ ${p.frame.sound}` : ''].filter(Boolean).join('\n')
        textBox(ctx, dia, xs[3] + unit * 0.5, y, cols[3] - unit, h, s)
        textBox(ctx, formatTime(p.frame.seconds, o.fps), xs[4] + unit * 0.5, y, cols[4] - unit, s * 1.4, s, '#000', 600)
        if (p.n.panels > 1 && p.n.panel === p.n.panels - 1) textBox(ctx, `Cut ${formatTime(p.n.cutSeconds, o.fps)}`, xs[4] + unit * 0.5, y + s * 1.6, cols[4] - unit, s * 2.8, s * 0.85, '#555')
      })
      for (const x of [...xs, pw - m]) {
        ctx.beginPath()
        ctx.moveTo(x, top)
        ctx.lineTo(x, ph - m)
        ctx.stroke()
      }
    } else if (o.kind === 'grid') {
      const gap = unit * 1.5
      const cw = (pw - 2 * m - 2 * gap) / 3
      const ch = (ph - m - top - gap) / 2
      slice.forEach((p, i) => {
        const x = m + (i % 3) * (cw + gap)
        const y = top + Math.floor(i / 3) * (ch + gap)
        const picH = Math.min(cw / aspect, ch * 0.62)
        pictureBox(ctx, p, x, y, cw, picH, aspect)
        let ty = y + picH + unit * 0.5
        ty += textBox(ctx, `${cutLabel(p.n)} · ${formatTime(p.frame.seconds, o.fps)} · ${cameraText(p.frame)}`, x, ty, cw, unit * 2, unit * 1.2, '#000', 600)
        if (p.n.firstOfScene) ty += textBox(ctx, sceneLabel(p.n), x, ty, cw, unit * 1.8, unit * 1.1, '#a33', 600)
        const rest = y + ch - ty
        const used = textBox(ctx, actionText(p), x, ty, cw, rest * 0.55, unit * 1.15)
        if (p.frame.dialogue) textBox(ctx, `“${p.frame.dialogue}”`, x, ty + used + unit * 0.3, cw, rest - used - unit * 0.3, unit * 1.15, '#333')
      })
    } else {
      const p = slice[0]
      if (p) {
        const picH = (ph - top - m) * 0.68
        pictureBox(ctx, p, m, top, pw - 2 * m, picH, aspect)
        let ty = top + picH + unit * 1.2
        ty += textBox(ctx, `${p.n.firstOfScene || page === 0 ? `${sceneLabel(p.n)} · ` : ''}${cutLabel(p.n)} · ${formatTime(p.frame.seconds, o.fps)} · ${cameraText(p.frame)}`, m, ty, pw - 2 * m, unit * 2.4, unit * 1.5, '#000', 600)
        const w2 = (pw - 2 * m - unit * 2) / 2
        textBox(ctx, actionText(p), m, ty + unit, w2, ph - m - ty - unit, unit * 1.4)
        textBox(ctx, [p.frame.dialogue && `“${p.frame.dialogue}”`, p.frame.sound && `♪ ${p.frame.sound}`].filter(Boolean).join('\n'), m + w2 + unit * 2, ty + unit, w2, ph - m - ty - unit, unit * 1.4, '#333')
      }
    }
    out.push(canvas)
  }
  return out
}

export async function sheetsPdf(items: Prepared[], doc: StoryboardDoc, o: SheetOptions): Promise<Uint8Array> {
  const portrait = o.kind === 'columns'
  const pages = drawSheetPages(items, doc, o)
  const list = []
  for (const c of pages) list.push({ widthMm: portrait ? o.paper.w : o.paper.h, heightMm: portrait ? o.paper.h : o.paper.w, image: await canvasBytes(c, 'image/jpeg'), pxWidth: c.width, pxHeight: c.height })
  return makePdf(list)
}

// ---- Shot list, script, pictures -----------------------------------------------------

export function shotListCsv(items: Prepared[], fps: number): string {
  const rows = [['Scene', 'Scene name', 'Cut', 'Panel', 'Start', 'Length', 'Seconds', 'Shot', 'Camera', 'Transition', 'Action', 'Dialogue', 'Sound', 'Notes', 'Characters', 'Status', 'Script']]
  for (const p of items) {
    const f = p.frame
    rows.push([String(p.n.scene), p.n.sceneName, String(p.n.cut), panelLetter(p.n.panel), formatTimecode(p.n.start, fps), formatTime(f.seconds, fps), String(Math.round(f.seconds * 1000) / 1000), f.shot, f.camera, f.transition ?? '', f.action, f.dialogue, f.sound, f.notes ?? '', p.characters.join(', '), f.status ?? '', p.script ?? ''])
  }
  return toCSV(rows)
}

/** A readable shooting script: scenes as headings, then every cut with its camera, action and dialogue. */
export function scriptMarkdown(items: Prepared[], title: string, fps: number): string {
  const lines = [`# ${title}`, '']
  for (const p of items) {
    if (p.n.firstOfScene) lines.push(`## ${sceneLabel(p.n)}`, '')
    lines.push(`**${cutLabel(p.n)}** (${formatTime(p.frame.seconds, fps)}) ${cameraText(p.frame)}`)
    const action = actionText(p)
    if (action) lines.push('', action)
    if (p.frame.dialogue) lines.push('', `> ${p.frame.dialogue.replace(/\n/g, '\n> ')}`)
    if (p.frame.sound) lines.push('', `*Sound: ${p.frame.sound}*`)
    if (p.frame.notes) lines.push('', `*Note: ${p.frame.notes}*`)
    lines.push('')
  }
  return lines.join('\n')
}

const pad = (n: number, w: number) => String(n).padStart(w, '0')
export const panelFileName = (n: Numbered) => `S${pad(n.scene, 2)}_C${pad(n.cut, 3)}${n.panels > 1 ? `_${panelLetter(n.panel)}` : ''}.png`

/** Every panel as a PNG, named by scene and cut, in one ZIP. Panels without a picture are left out. */
export async function picturesZip(items: Prepared[]): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {}
  for (const p of items) if (p.picture) files[panelFileName(p.n)] = await canvasBytes(p.picture)
  return zipSync(files, { level: 0 })
}

// ---- Animatic video -----------------------------------------------------------------

export interface VideoOptions {
  format: 'webm' | 'gif'
  subtitles: boolean
  /** Cut number and time in the corner, for review copies. */
  burnIn: boolean
  fps: number
}

/** One animatic frame with optional subtitles and cut label. */
export function animaticFrame(p: Prepared, w: number, h: number, o: Pick<VideoOptions, 'subtitles' | 'burnIn' | 'fps'>) {
  const { canvas, ctx } = makeCanvas(w, h)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)
  if (p.picture) ctx.drawImage(p.picture, 0, 0, w, h)
  const u = Math.min(w, h) / 100
  if (o.subtitles && p.frame.dialogue.trim()) {
    const size = u * 4.2
    ctx.font = `500 ${size}px ${FONT}`
    const lines = p.frame.dialogue.trim().split('\n').slice(0, 3)
    const lh = size * 1.3
    const boxW = Math.min(w * 0.9, Math.max(...lines.map((l) => ctx.measureText(l).width)) + size)
    const y0 = h - u * 8 - lines.length * lh
    ctx.fillStyle = 'rgba(0,0,0,0.65)'
    ctx.fillRect((w - boxW) / 2, y0 - size * 0.3, boxW, lines.length * lh + size * 0.4)
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    lines.forEach((l, i) => ctx.fillText(l, w / 2, y0 + i * lh, w * 0.88))
    ctx.textAlign = 'left'
  }
  if (o.burnIn) {
    const size = u * 3
    ctx.font = `600 ${size}px ${FONT}`
    const label = `${sceneLabel(p.n)} · ${cutLabel(p.n)} · ${formatTimecode(p.n.start, o.fps)}`
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(u * 2, u * 2, ctx.measureText(label).width + size, size * 1.6)
    ctx.fillStyle = '#fff'
    ctx.textBaseline = 'top'
    ctx.fillText(label, u * 2 + size / 2, u * 2 + size * 0.3)
  }
  return canvas
}

/** The animatic as a video (WebM, or GIF where the webview can't make video). Sound is not included yet. */
export async function animaticVideo(items: Prepared[], doc: StoryboardDoc, o: VideoOptions, onProgress?: (done: number) => void): Promise<Exported> {
  const a = aspectOf(doc)
  // shortcut: video has no sound track yet (the WebM muxer writes video only); add an Opus track when WebCodecs audio is checked on Linux.
  return encodeAnimation(
    o.format,
    a.w,
    a.h,
    items.map((p) => ({ ms: Math.round(p.frame.seconds * 1000), draw: () => animaticFrame(p, a.w, a.h, o) })),
    onProgress,
  )
}

/** Slides for the Pitch Deck: one per cut (its first panel's picture, saved as its own copy by the caller), text from action and dialogue. */
export function pitchSlides(items: Prepared[], doc: StoryboardDoc) {
  const fps = fpsOf(doc)
  return items
    .filter((p) => p.n.panel === 0)
    .map((p) => ({
      title: p.n.sceneName || `Scene ${p.n.scene}`,
      text: [actionText(p), p.frame.dialogue && `“${p.frame.dialogue}”`, `${cutLabel({ ...p.n, panels: 1 })} · ${cameraText(p.frame)} · ${formatTime(p.n.cutSeconds, fps)}`].filter(Boolean).join('\n\n'),
      picture: p.picture,
    }))
}
