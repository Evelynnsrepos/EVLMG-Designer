import { newId, type Id } from '@/core/model'
import { richTextToPlainText } from '@/shared/richtext/doc'
import type { RichTextDoc } from '@/shared/richtext/types'

/**
 * Storyboard data (v0.10, grown into a studio board in v0.27). Every field added after v0.10 is optional,
 * so boards made by older versions (desktop and mobile) open unchanged and older versions still open new boards.
 *
 * A frame is one **panel**. Panels are grouped into **cuts** (a panel with `sameCut` continues the cut above it)
 * and cuts into **scenes** (a panel with `sceneStart` begins a new scene). Numbers are worked out, never stored,
 * so moving panels around keeps the numbering right.
 */

export const SHOTS = ['Establishing', 'Wide', 'Full', 'Medium', 'Medium close-up', 'Close-up', 'Extreme close-up', 'Two shot', 'Over the shoulder', 'Point of view', 'Aerial', 'Low angle', 'High angle', 'Dutch angle', 'Insert'] as const
export const CAMERA = ['Static', 'Pan', 'Tilt', 'Zoom in', 'Zoom out', 'Truck in (T.U.)', 'Truck out (T.B.)', 'Dolly', 'Tracking', 'Follow', 'Crane', 'Handheld', 'Shake', 'Rack focus', 'Cut'] as const
export const TRANSITIONS = ['Cut', 'Fade in', 'Fade out', 'Fade to black', 'Dissolve', 'Wipe', 'Match cut', 'Smash cut'] as const
export const STATUSES = ['Rough', 'Clean', 'Needs changes', 'Approved'] as const
export const FPS_CHOICES = [24, 25, 30, 60] as const

/** Board shapes; the size is what a new drawing for a panel gets. */
export const ASPECTS = [
  { id: '16:9', label: '16:9 (YouTube, TV, games)', w: 1920, h: 1080 },
  { id: '9:16', label: '9:16 (Shorts, TikTok)', w: 1080, h: 1920 },
  { id: '4:3', label: '4:3', w: 1440, h: 1080 },
  { id: '1:1', label: '1:1', w: 1080, h: 1080 },
  { id: '2.39:1', label: '2.39:1 (cinema)', w: 2560, h: 1072 },
] as const
export type AspectId = (typeof ASPECTS)[number]['id']

export type Status = (typeof STATUSES)[number]

/** A link from a panel to a Writer document, optionally to one of its headings. */
export interface WriterLink {
  documentId: Id
  /** The heading's text; null = the whole document. */
  section: string | null
}

export interface Frame {
  id: Id
  image: string | null
  /** Older boards only have the first 8 shots and camera moves; any string from the lists above is fine. */
  shot: string
  camera: string
  seconds: number
  action: string
  dialogue: string
  sound: string
  // v0.27, all optional:
  /** This panel starts a new scene. */
  sceneStart?: boolean
  /** The scene's name (only read on a panel with `sceneStart`, or the first panel). */
  scene?: string
  /** This panel belongs to the same cut as the one before it (cut 12 panel B). */
  sameCut?: boolean
  /** Free notes for the team: layout, effects, colour, timing. */
  notes?: string
  /** How this cut goes into the next one. */
  transition?: string
  status?: Status
  /** Character List entries in this panel (ids). */
  characterIds?: Id[]
  /** A Draw drawing made for this panel; its picture wins over `image` and updates when the drawing changes. */
  sketchId?: Id
  writer?: WriterLink
  /** A sound or voice clip (project audio asset) that starts with this panel in the animatic. */
  audio?: string
}

export interface StoryboardDoc {
  frames: Frame[]
  aspect?: AspectId
  fps?: number
  /** Music or a voice track (project audio asset) under the whole animatic. */
  soundtrack?: string | null
  /** Title-safe and action-safe lines over the picture. */
  safeArea?: boolean
}

export const newFrame = (patch: Partial<Frame> = {}): Frame => ({ id: newId(), image: null, shot: 'Wide', camera: 'Static', seconds: 3, action: '', dialogue: '', sound: '', ...patch })
export const createStoryboardDoc = (): StoryboardDoc => ({ frames: [newFrame()], aspect: '16:9', fps: 24 })

export const aspectOf = (doc: StoryboardDoc) => ASPECTS.find((a) => a.id === doc.aspect) ?? ASPECTS[0]
export const fpsOf = (doc: StoryboardDoc) => (doc.fps && doc.fps > 0 ? doc.fps : 24)

/** A frame nobody has touched yet (the one a new storyboard starts with). */
export const isBlank = (f: Frame) => !f.image && !f.action && !f.dialogue && !f.sound && !f.sketchId && !f.writer && !f.notes

// ---- Numbering ------------------------------------------------------------------------

export interface Numbered {
  /** 1-based. */
  scene: number
  sceneName: string
  /** 1-based, counted through the whole board like on an anime board. */
  cut: number
  /** 0-based panel inside the cut. */
  panel: number
  /** How many panels the cut has. */
  panels: number
  /** Seconds the whole cut lasts. */
  cutSeconds: number
  /** Seconds from the start of the board to this panel. */
  start: number
  /** First panel of its scene. */
  firstOfScene: boolean
}

/** Scene, cut and panel numbers and start times for every frame. */
export function numberFrames(frames: Frame[]): Numbered[] {
  const out: Numbered[] = []
  let scene = 0
  let sceneName = ''
  let cut = 0
  let start = 0
  for (const [i, f] of frames.entries()) {
    const newScene = i === 0 || !!f.sceneStart
    if (newScene) {
      scene++
      sceneName = f.scene?.trim() ?? ''
    }
    const newCut = i === 0 || newScene || !f.sameCut
    if (newCut) cut++
    const prev = out[i - 1]
    out.push({ scene, sceneName, cut, panel: newCut ? 0 : prev.panel + 1, panels: 1, cutSeconds: 0, start, firstOfScene: newScene })
    start += f.seconds
  }
  // Second pass: panel counts and cut lengths.
  for (let i = 0; i < out.length; ) {
    let j = i
    let secs = 0
    while (j < out.length && out[j].cut === out[i].cut) secs += frames[j++].seconds
    for (let k = i; k < j; k++) {
      out[k].panels = j - i
      out[k].cutSeconds = secs
    }
    i = j
  }
  return out
}

/** "C12", or "C12 B" when the cut has several panels. */
export function cutLabel(n: Numbered): string {
  return n.panels > 1 ? `C${n.cut} ${panelLetter(n.panel)}` : `C${n.cut}`
}

/** A, B, … Z, AA, AB … */
export function panelLetter(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

export const sceneLabel = (n: Numbered) => (n.sceneName ? `Scene ${n.scene}: ${n.sceneName}` : `Scene ${n.scene}`)

// ---- Timing ---------------------------------------------------------------------------

/** Seconds as seconds + frames, the way animators write it: 3.5 s at 24 fps = "3+12". */
export function formatTime(seconds: number, fps: number): string {
  const total = Math.max(0, Math.round(seconds * fps))
  return `${Math.floor(total / fps)}+${String(total % fps).padStart(2, '0')}`
}

/** Timecode for a running time: 1:02+05 (minutes:seconds+frames). */
export function formatTimecode(seconds: number, fps: number): string {
  const total = Math.max(0, Math.round(seconds * fps))
  const secs = Math.floor(total / fps)
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}+${String(total % fps).padStart(2, '0')}`
}

/**
 * What someone types as a length: "3+12" (seconds + frames), "36k" or "36f" (frames), "3.5" or "3,5" (seconds).
 * Returns seconds, at least one frame, or null when it can't be read.
 */
export function parseTime(text: string, fps: number): number | null {
  const t = text.trim().toLowerCase().replace(',', '.')
  let secs: number | null = null
  let m: RegExpMatchArray | null
  if ((m = t.match(/^(\d+)\s*\+\s*(\d+)$/))) secs = Number(m[1]) + Number(m[2]) / fps
  else if ((m = t.match(/^(\d+)\s*[kf]$/))) secs = Number(m[1]) / fps
  else if ((m = t.match(/^(\d+(?:\.\d+)?)\s*s?$/))) secs = Number(m[1])
  if (secs === null || !Number.isFinite(secs)) return null
  // Whole frames only, at least one.
  return Math.max(1, Math.round(secs * fps)) / fps
}

// ---- Writer ---------------------------------------------------------------------------

export interface WriterSection {
  /** The heading's text; null for the part before the first heading. */
  heading: string | null
  text: string
  /** Paragraphs (and other blocks) as plain text, for "one panel per paragraph". */
  paragraphs: string[]
}

/** A Writer document cut at its headings. */
export function writerSections(body: RichTextDoc | undefined | null): WriterSection[] {
  const sections: WriterSection[] = []
  let cur: { heading: string | null; nodes: RichTextDoc[] } = { heading: null, nodes: [] }
  const flush = () => {
    const paragraphs = cur.nodes.map((n) => richTextToPlainText({ type: 'doc', content: [n] }).trim()).filter(Boolean)
    if (cur.heading !== null || paragraphs.length) sections.push({ heading: cur.heading, text: paragraphs.join('\n\n'), paragraphs })
  }
  for (const node of body?.content ?? []) {
    if (node.type === 'heading') {
      flush()
      cur = { heading: richTextToPlainText({ type: 'doc', content: [node] }).trim() || 'Untitled heading', nodes: [] }
    } else cur.nodes.push(node)
  }
  flush()
  return sections
}

/** The text a link shows: the section under its heading, or the whole document. Null when the heading is gone. */
export function linkedText(body: RichTextDoc | undefined | null, section: string | null): string | null {
  if (section === null) return richTextToPlainText(body ?? { type: 'doc', content: [] }).trim()
  const s = writerSections(body).find((x) => x.heading === section)
  return s ? s.text : null
}

/** New panels from a Writer document: one per heading (a new scene each), or one per paragraph. */
export function framesFromWriter(documentId: Id, body: RichTextDoc | undefined | null, per: 'heading' | 'paragraph'): Frame[] {
  const out: Frame[] = []
  for (const s of writerSections(body)) {
    const writer: WriterLink = { documentId, section: s.heading }
    if (per === 'heading') out.push(newFrame({ sceneStart: true, scene: s.heading ?? '', writer }))
    else s.paragraphs.forEach((p, i) => out.push(newFrame({ sceneStart: i === 0, scene: i === 0 ? (s.heading ?? '') : undefined, writer, action: p })))
    if (per === 'paragraph' && !s.paragraphs.length) out.push(newFrame({ sceneStart: true, scene: s.heading ?? '', writer }))
  }
  return out
}
