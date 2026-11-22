import type { CSSProperties } from 'react'
import { newId, type Entity, type EntityType, type Id } from '@/core/model'

/**
 * 0.35 Pitch Deck model. Old decks (layout + title/text/image) keep working: a layout
 * expands into read-only objects (`fromLayout`), and every slide can also hold free
 * objects on top. All positions are in slide pixels: 1920 x 1080 (16:9) or 1440 x 1080 (4:3).
 */

export type Layout = 'title' | 'text' | 'image' | 'pillars' | 'entities' | 'blank'
export type ShapeKind = 'rect' | 'round' | 'ellipse' | 'triangle' | 'line' | 'arrow'
export type Build = 'none' | 'appear' | 'fade' | 'fly'
export type Transition = 'none' | 'fade' | 'push' | 'zoom' | 'morph'
export type Align = 'left' | 'center' | 'right'

export interface Obj {
  id: Id
  kind: 'text' | 'image' | 'shape'
  x: number
  y: number
  w: number
  h: number
  rot?: number
  /** text */
  text?: string
  size?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  /** Small caps ("Kapitälchen"). */
  caps?: boolean
  color?: string
  align?: Align
  font?: string
  bullets?: boolean
  lineHeight?: number
  /** image (asset path); `cover` crops to fill the box */
  image?: string | null
  fit?: 'contain' | 'cover'
  /** shape; text boxes may also have a fill and outline */
  shape?: ShapeKind
  fill?: string
  stroke?: string
  strokeW?: number
  build?: Build
  locked?: boolean
  /** Made from the slide's layout: shown and exported, edited through the layout fields. */
  fromLayout?: boolean
  /** Morph: copies (duplicate slide, paste) share this with the original, so they glide from one slide to the next. */
  mid?: string
}

export interface Slide {
  id: Id
  layout: Layout
  title: string
  text: string
  image: string | null
  entityType: EntityType
  entityIds: Id[]
  objects?: Obj[]
  notes?: string
  bg?: string
  bgImage?: string | null
  transition?: Transition
  hidden?: boolean
}

export interface Theme {
  id: string
  name: string
  font: string
  bg: string
  ink: string
  soft: string
  accent: string
}

export interface PitchDoc {
  slides: Slide[]
  theme?: string
  ratio?: '16:9' | '4:3'
}

export interface Pillar {
  id?: Id
  title: string
  why: string
  color: string
}

export const THEMES: Theme[] = [
  { id: 'clean', name: 'Clean', font: 'Lexend Deca', bg: '#ffffff', ink: '#1d1d22', soft: '#55555e', accent: '#6c5ce7' },
  { id: 'night', name: 'Night', font: 'Lexend Deca', bg: '#16161d', ink: '#f4f4f8', soft: '#b4b4c2', accent: '#8ab4ff' },
  { id: 'paper', name: 'Paper', font: 'Georgia', bg: '#f6f0e4', ink: '#2b241b', soft: '#6b5e4d', accent: '#b5562d' },
  { id: 'arcade', name: 'Arcade', font: 'Verdana', bg: '#1b0f2e', ink: '#fff6a8', soft: '#e0c7ff', accent: '#ff3fa4' },
  { id: 'forest', name: 'Forest', font: 'Trebuchet MS', bg: '#eef3ea', ink: '#1f3324', soft: '#4d6352', accent: '#2f8f4e' },
  { id: 'bold', name: 'Bold', font: 'Arial', bg: '#ffd23f', ink: '#111111', soft: '#333333', accent: '#e4572e' },
]

export const themeOf = (d: Pick<PitchDoc, 'theme'>): Theme => THEMES.find((t) => t.id === d.theme) ?? THEMES[0]
export const H = 1080
export const widthOf = (d: Pick<PitchDoc, 'ratio'>): number => (d.ratio === '4:3' ? 1440 : 1920)

export const newSlide = (layout: Layout = 'text', patch: Partial<Slide> = {}): Slide => ({
  id: newId(),
  layout,
  title: '',
  text: '',
  image: null,
  entityType: 'character',
  entityIds: [],
  ...patch,
})

export const newObj = (kind: Obj['kind'], patch: Partial<Obj> = {}): Obj => ({
  id: newId(),
  kind,
  x: 660,
  y: 390,
  w: 600,
  h: kind === 'text' ? 160 : 300,
  ...(kind === 'text' ? { text: 'Text', size: 48 } : {}),
  ...(kind === 'shape' ? { shape: 'rect' as ShapeKind, strokeW: 4 } : {}),
  ...(kind === 'image' ? { fit: 'contain' as const } : {}),
  ...patch,
})

export interface ExpandContext {
  width: number
  theme: Theme
  pillars: Pillar[]
  entities: Partial<Record<EntityType, Entity[]>>
}

/** The objects a slide shows: its layout's objects first (behind), then its own. */
export function expandSlide(s: Slide, ctx: ExpandContext): Obj[] {
  return [...layoutObjects(s, ctx), ...(s.objects ?? [])]
}

function layoutObjects(s: Slide, { width: W, theme, pillars, entities }: ExpandContext): Obj[] {
  const L = (kind: Obj['kind'], key: string, patch: Partial<Obj>): Obj => ({ id: `${s.id}:${key}`, kind, x: 0, y: 0, w: 0, h: 0, fromLayout: true, ...patch })
  const heading = (t: string) => L('text', 'title', { x: 120, y: 90, w: W - 240, h: 120, text: t, size: 72, bold: true, color: theme.ink })
  const body = (t: string, x: number, y: number, w: number, h: number, size = 46) => L('text', 'text', { x, y, w, h, text: t, size, color: theme.soft, lineHeight: 1.35 })
  switch (s.layout) {
    case 'title': {
      const pic = s.image ? [L('image', 'image', { x: 0, y: 0, w: W, h: H * 0.55, image: s.image, fit: 'contain' })] : []
      const top = s.image ? H * 0.58 : H * 0.34
      return [
        ...pic,
        L('text', 'title', { x: 100, y: top, w: W - 200, h: 150, text: s.title, size: 110, bold: true, align: 'center', color: theme.ink }),
        ...(s.text ? [{ ...body(s.text, 200, top + 160, W - 400, H - top - 200, 44), align: 'center' as Align }] : []),
      ]
    }
    case 'text':
      return [heading(s.title), body(s.text, 120, 240, W - 240, H - 320)]
    case 'image':
      return [
        L('image', 'image', { x: 80, y: 80, w: W / 2 - 120, h: H - 160, image: s.image, fit: 'contain' }),
        L('text', 'title', { x: W / 2 + 40, y: 110, w: W / 2 - 160, h: 180, text: s.title, size: 64, bold: true, color: theme.ink }),
        body(s.text, W / 2 + 40, 310, W / 2 - 160, H - 390, 40),
      ]
    case 'pillars': {
      const list = pillars.filter((p) => p.title)
      const cw = (W - 240 - (list.length - 1) * 40) / Math.max(1, list.length)
      return [
        heading(s.title || 'Design pillars'),
        ...list.flatMap((p, i) => {
          const x = 120 + i * (cw + 40)
          return [
            L('shape', `bar${i}`, { x, y: 260, w: cw, h: 12, shape: 'rect', fill: p.color, strokeW: 0 }),
            L('text', `pt${i}`, { x, y: 300, w: cw, h: 140, text: p.title, size: 48, bold: true, color: theme.ink }),
            L('text', `pw${i}`, { x, y: 450, w: cw, h: H - 530, text: p.why, size: 34, color: theme.soft, lineHeight: 1.35 }),
          ]
        }),
      ]
    }
    case 'entities': {
      const all = entities[s.entityType] ?? []
      const list = s.entityIds.flatMap((id) => all.filter((e) => e.id === id)).slice(0, 6)
      const cols = Math.max(1, list.length)
      const cw = Math.min(420, (W - 240 - (cols - 1) * 40) / cols)
      const left = (W - (cols * cw + (cols - 1) * 40)) / 2
      return [
        heading(s.title),
        ...list.flatMap((e, i) => {
          const x = left + i * (cw + 40)
          return [
            e.image ? L('image', `ei${i}`, { x, y: 250, w: cw, h: cw, image: e.image, fit: 'contain' }) : L('shape', `ei${i}`, { x, y: 250, w: cw, h: cw, shape: 'round', fill: '#ececf0', strokeW: 0 }),
            L('text', `en${i}`, { x, y: 270 + cw, w: cw, h: 60, text: e.name, size: 40, bold: true, color: theme.ink }),
            L('text', `ed${i}`, { x, y: 340 + cw, w: cw, h: H - 380 - cw, text: e.description.slice(0, 90), size: 28, color: theme.soft }),
          ]
        }),
      ]
    }
    default:
      return []
  }
}

/** Turn the layout into free objects so every part can be moved and edited. */
export function unlockLayout(s: Slide, ctx: ExpandContext): Slide {
  const own = layoutObjects(s, ctx).map((o) => ({ ...o, id: newId(), fromLayout: undefined }))
  return { ...s, layout: 'blank', objects: [...own, ...(s.objects ?? [])] }
}

/** Objects with a build, in the order they come in when presenting. */
export const buildsOf = (objs: Obj[]): Obj[] => objs.filter((o) => o.build && o.build !== 'none')

/** Slides that are shown when presenting or exporting (hidden ones are skipped). */
export const shownSlides = (d: PitchDoc): Slide[] => d.slides.filter((s) => !s.hidden)

export const fontStack = (font: string | undefined, theme: Theme) => `'${font || theme.font}', 'Lexend Deca', sans-serif`

/** Where a picture lands in its box: `contain` shrinks the box, `cover` crops (crop = fraction cut off each side). */
export function placeImage(o: Pick<Obj, 'x' | 'y' | 'w' | 'h' | 'fit'>, iw: number, ih: number) {
  const crop = { l: 0, t: 0, r: 0, b: 0 }
  if (!iw || !ih) return { x: o.x, y: o.y, w: o.w, h: o.h, crop }
  if (o.fit === 'cover') {
    const s = Math.max(o.w / iw, o.h / ih)
    const cx = (1 - o.w / (iw * s)) / 2
    const cy = (1 - o.h / (ih * s)) / 2
    return { x: o.x, y: o.y, w: o.w, h: o.h, crop: { l: cx, r: cx, t: cy, b: cy } }
  }
  const s = Math.min(o.w / iw, o.h / ih)
  const w = iw * s
  const h = ih * s
  return { x: o.x + (o.w - w) / 2, y: o.y + (o.h - h) / 2, w, h, crop }
}

/** A slide ready for export: every object placed, background picture as the first object. */
export interface ExportSlide {
  objs: Obj[]
  bg: string
  notes: string
  transition: Transition
  hidden: boolean
}
export interface ExportImage {
  png: Uint8Array
  w: number
  h: number
}
export interface ExportDeck {
  width: number
  theme: Theme
  title: string
  slides: ExportSlide[]
  /** By asset path. Missing pictures are left out. Cover pictures arrive already cropped (fit contain). */
  images: Map<string, ExportImage>
}

export function exportSlide(s: Slide, ctx: ExpandContext): ExportSlide {
  const bgPic: Obj[] = s.bgImage ? [{ id: `${s.id}:bg`, kind: 'image', x: 0, y: 0, w: ctx.width, h: H, image: s.bgImage, fit: 'cover' }] : []
  return { objs: [...bgPic, ...expandSlide(s, ctx)], bg: s.bg || ctx.theme.bg, notes: s.notes ?? '', transition: s.transition ?? 'none', hidden: !!s.hidden }
}

export const xmlEscape = (t: string) =>
  t
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')

/** Bullet lines: text split at new lines; with bullets on, a leading "• " or "- " typed by hand is dropped. */
export const paragraphsOf = (o: Obj): string[] => (o.text ?? '').split('\n').map((p) => (o.bullets ? p.replace(/^\s*[•\-*]\s+/, '') : p))

export function textStyle(o: Obj, theme: Theme, middle = false): CSSProperties {
  return {
    fontFamily: fontStack(o.font, theme),
    fontSize: o.size ?? 40,
    fontWeight: o.bold ? 700 : 400,
    fontStyle: o.italic ? 'italic' : 'normal',
    fontVariantCaps: o.caps ? 'small-caps' : 'normal',
    textDecoration: o.underline ? 'underline' : 'none',
    color: o.color ?? theme.ink,
    textAlign: o.align ?? 'left',
    lineHeight: o.lineHeight ?? 1.2,
    justifyContent: middle ? 'center' : 'flex-start',
  }
}


/** What Morph matches objects by: layout parts by their role (title, text…), others by their shared morph id. */
export const morphKey = (o: Obj): string => (o.fromLayout ? `L${o.id.slice(o.id.indexOf(':') + 1)}` : (o.mid ?? o.id))

/**
 * Morph from `from` to `to`: each object in `to` with its match in `from` (or null = it fades in),
 * and the objects of `from` that have no match (they fade out). Each key is matched once.
 */
export function morphPairs(from: Obj[], to: Obj[]): { pairs: { to: Obj; from: Obj | null }[]; gone: Obj[] } {
  const left = new Map<string, Obj[]>()
  for (const o of from) left.set(morphKey(o), [...(left.get(morphKey(o)) ?? []), o])
  const pairs = to.map((o) => {
    const list = left.get(morphKey(o))
    const match = list?.find((f) => f.kind === o.kind) ?? null
    if (match) list!.splice(list!.indexOf(match), 1)
    return { to: o, from: match }
  })
  return { pairs, gone: [...left.values()].flat() }
}
