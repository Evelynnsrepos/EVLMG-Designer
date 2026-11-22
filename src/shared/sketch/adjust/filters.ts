import type { AsciiText } from '../ascii'
import { defaultCurves, GRADIENT_PRESETS, type Curves, type GradientStop, type ToneRange } from './color'

/** The Adjustments menu (Sketch Pro): what each adjustment is called and which settings it has. */

export type FilterId =
  | 'hsb'
  | 'balance'
  | 'curves'
  | 'gradient'
  | 'valueAlpha'
  | 'gaussian'
  | 'motion'
  | 'perspective'
  | 'noise'
  | 'sharpen'
  | 'bloom'
  | 'glitch'
  | 'halftone'
  | 'chromatic'
  | 'ascii'

export interface ParamDef {
  key: string
  label: string
  min: number
  max: number
  step?: number
  /** '%' shows value × 100. */
  unit?: '%' | 'px' | '°'
  /** A choice between named options; the value is the option's index. */
  options?: string[]
  /** An on / off switch (value 0 or 1). */
  toggle?: boolean
  /** Colour balance: the tone range this slider belongs to. */
  range?: ToneRange
  /** Only shown when this other setting has this value. */
  when?: [string, number]
  /** Labels at the slider's two ends (colour balance). */
  ends?: [string, string]
  /** Folded away under "More" (settings for pros). */
  more?: boolean
}

export interface FilterDef {
  id: FilterId
  label: string
  group: 'Colour' | 'Blur' | 'Effects'
  params: ParamDef[]
  /** The setting changed by dragging sideways on the canvas. */
  main?: string
  /** Has a centre point the user can tap on the canvas. */
  center?: boolean
  /** Can reshuffle its random pattern. */
  seeded?: boolean
}

const pct = (key: string, label: string, min = 0, max = 1): ParamDef => ({ key, label, min, max, step: 0.01, unit: '%' })
const balance = (range: ToneRange): ParamDef[] =>
  (
    [
      ['Cyan', 'Red'],
      ['Magenta', 'Green'],
      ['Yellow', 'Blue'],
    ] as [string, string][]
  ).map((ends, i) => ({ key: `${range}${i}`, label: ends.join(' / '), min: -1, max: 1, step: 0.01, unit: '%', range, ends }))

export const FILTERS: FilterDef[] = [
  { id: 'hsb', label: 'Hue, saturation, brightness', group: 'Colour', main: 'sat', params: [{ key: 'hue', label: 'Hue', min: -180, max: 180, unit: '°' }, pct('sat', 'Saturation', -1, 1), pct('bright', 'Brightness', -1, 1)] },
  { id: 'balance', label: 'Colour balance', group: 'Colour', main: 'midtones0', params: [...balance('shadows'), ...balance('midtones'), ...balance('highlights'), { key: 'keep', label: 'Keep brightness', min: 0, max: 1, toggle: true }] },
  { id: 'curves', label: 'Curves', group: 'Colour', params: [] },
  { id: 'gradient', label: 'Gradient map', group: 'Colour', main: 'amount', params: [pct('amount', 'Strength')] },
  {
    id: 'valueAlpha',
    label: 'Values to opacity',
    group: 'Colour',
    main: 'amount',
    params: [{ key: 'mode', label: 'Make see-through', min: 0, max: 1, options: ['Bright parts', 'Dark parts'] }, pct('amount', 'Strength')],
  },
  { id: 'gaussian', label: 'Gaussian blur', group: 'Blur', main: 'radius', params: [{ key: 'radius', label: 'Amount', min: 0, max: 100, step: 0.5, unit: 'px' }] },
  { id: 'motion', label: 'Motion blur', group: 'Blur', main: 'length', params: [{ key: 'length', label: 'Amount', min: 0, max: 300, unit: 'px' }, { key: 'angle', label: 'Direction', min: 0, max: 360, unit: '°' }] },
  { id: 'perspective', label: 'Perspective blur', group: 'Blur', main: 'amount', center: true, params: [pct('amount', 'Amount')] },
  {
    id: 'noise',
    label: 'Noise',
    group: 'Effects',
    main: 'amount',
    seeded: true,
    params: [{ key: 'kind', label: 'Type', min: 0, max: 2, options: ['Clouds', 'Billows', 'Ridges'] }, pct('amount', 'Amount'), { key: 'scale', label: 'Scale', min: 2, max: 400, unit: 'px' }, { key: 'octaves', label: 'Detail', min: 1, max: 6 }],
  },
  { id: 'sharpen', label: 'Sharpen', group: 'Effects', main: 'amount', params: [pct('amount', 'Amount', 0, 3)] },
  { id: 'bloom', label: 'Bloom', group: 'Effects', main: 'amount', params: [pct('amount', 'Glow', 0, 2), { key: 'size', label: 'Size', min: 1, max: 100, unit: 'px' }, pct('threshold', 'Brightest only')] },
  { id: 'glitch', label: 'Glitch', group: 'Effects', main: 'amount', seeded: true, params: [{ key: 'kind', label: 'Type', min: 0, max: 3, options: ['Blocks', 'Wave', 'Signal', 'Diagonal'] }, pct('amount', 'Amount')] },
  { id: 'halftone', label: 'Halftone', group: 'Effects', main: 'size', params: [{ key: 'mode', label: 'Style', min: 0, max: 2, options: ['Full colour', 'Screen print', 'Newspaper'] }, { key: 'size', label: 'Dot size', min: 3, max: 60, unit: 'px' }] },
  {
    id: 'chromatic',
    label: 'Chromatic aberration',
    group: 'Effects',
    main: 'amount',
    center: true,
    params: [{ key: 'mode', label: 'Type', min: 0, max: 1, options: ['From a point', 'Shift'] }, { key: 'amount', label: 'Amount', min: 0, max: 60, step: 0.5, unit: 'px' }, { key: 'angle', label: 'Direction', min: 0, max: 360, unit: '°', when: ['mode', 1] }],
  },
  {
    id: 'ascii',
    label: 'ASCII art',
    group: 'Effects',
    main: 'cell',
    params: [
      { key: 'set', label: 'Letters', min: 0, max: 6, options: ['Classic', 'Fine', 'Blocks', 'Your own', 'Braille dots', 'Lines only', 'Your text'] },
      { key: 'cell', label: 'Letter size', min: 3, max: 48, unit: 'px' },
      { key: 'colour', label: 'Colour', min: 0, max: 1, options: ['Picture colours', 'One colour'] },
      { key: 'look', label: 'Letters go on', min: 0, max: 2, options: ['Dark parts', 'Bright parts', 'Painted parts'], more: true },
      { ...pct('contrast', 'Contrast', -1, 1), more: true },
      { ...pct('edges', 'Edge lines'), more: true },
      { key: 'dither', label: 'Dithering', min: 0, max: 2, options: ['Off', 'Pattern', 'Spread'], more: true },
      { key: 'paper', label: 'Background colour', min: 0, max: 1, toggle: true, more: true },
      { key: 'invert', label: 'Invert', min: 0, max: 1, toggle: true, more: true },
      { ...pct('scatter', 'Scatter'), more: true },
    ],
    seeded: true,
  },
]

export const filterDef = (id: FilterId) => FILTERS.find((f) => f.id === id)!

/** Everything an adjustment needs to render. */
export interface AdjustValues {
  v: Record<string, number>
  curves: Curves
  gradient: GradientStop[]
  /** Centre point in canvas pixels (perspective blur, chromatic aberration). */
  center: { x: number; y: number }
  seed: number
  /** 0.35: ASCII art: your own letters and the colours (missing = defaults). */
  ascii?: AsciiText
}

const DEFAULTS: Record<string, number> = {
  amount: 0.5,
  radius: 8,
  length: 40,
  angle: 0,
  scale: 60,
  octaves: 4,
  size: 12,
  threshold: 0.6,
  keep: 1,
}

export function defaultValues(id: FilterId, width: number, height: number): AdjustValues {
  const v: Record<string, number> = {}
  for (const p of filterDef(id).params) v[p.key] = p.options || p.range || ['hue', 'sat', 'bright'].includes(p.key) ? 0 : (DEFAULTS[p.key] ?? 0)
  if (id === 'gradient' || id === 'valueAlpha') v.amount = 1
  if (id === 'sharpen') v.amount = 1
  if (id === 'bloom') v.amount = 1
  if (id === 'halftone') v.size = 8
  if (id === 'chromatic') v.amount = 8
  if (id === 'ascii') v.cell = 8
  return { v, curves: defaultCurves(), gradient: GRADIENT_PRESETS[2].stops, center: { x: width / 2, y: height / 2 }, seed: 1 }
}

/** Dragging sideways by `dx` screen pixels from `start`: a full slider per 600 px. */
export function dragMain(def: ParamDef, start: number, dx: number): number {
  const v = start + (dx / 600) * (def.max - def.min)
  return Math.min(def.max, Math.max(def.min, v))
}
