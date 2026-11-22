import type { AdjustValues } from './adjust/filters'
import { asciiSettings, type AsciiMark } from './ascii'

/**
 * Sign brushes (0.35): paint on an ASCII layer's cells instead of its pixels. Each painted cell is stored as a mark
 * (`AsciiText.marks`, keyed by the cell's pixel corner) that the renderer applies on top of the automatic letters.
 */
export type SignMode = 'line' | 'shade' | 'lighten' | 'sign' | 'scatter' | 'auto'

/** The signs offered on the palette (no typing needed). */
export const SIGN_PALETTE = [...'.,:;\'"`^~-_=+*#%@&$/\\|()[]{}<>!?oO0xXvV░▒▓█']

/** Letters the Scatter brush picks from. */
const SCATTER = '.:;-=+*#%@&$?!/\\|<>{}[]oOxX'

export interface SignStroke {
  mode: SignMode
  sign: string
  /** 0 = only the cell under the pen; n = cells up to n cells away. */
  size: number
  color: string
  cw: number
  ch: number
  cols: number
  rows: number
  /** The marks at the start, and the ones being painted. */
  marks: Record<string, AsciiMark>
  /** Cells already darkened, lightened or scattered in this stroke (once per stroke). */
  done: Set<string>
  /** Where the line brush last decided a direction, and that direction. */
  anchor: { x: number; y: number } | null
  dir: { x: number; y: number } | null
}

export function beginSigns(a: AdjustValues, width: number, height: number, mode: SignMode, sign: string, size: number, color: string): SignStroke {
  const s = asciiSettings(a)
  const cw = s.cell
  const ch = cw * 2
  return { mode, sign, size, color, cw, ch, cols: Math.ceil(width / cw), rows: Math.ceil(height / ch), marks: { ...a.ascii?.marks }, done: new Set(), anchor: null, dir: null }
}

/** The sign for a line going `d` (pixels, y down), drawn at `y` px; `prev` is the line's earlier direction (for curves). */
export function lineSign(d: { x: number; y: number }, prev: { x: number; y: number } | null, yInCell: number): string {
  const len = Math.hypot(d.x, d.y)
  const deg = (((Math.atan2(-d.y, d.x) * 180) / Math.PI) % 180 + 180) % 180
  if (deg < 22.5 || deg >= 157.5) return yInCell > 0.6 ? '_' : '-'
  if (deg < 67.5) return '/'
  if (deg >= 112.5) return '\\'
  if (prev) {
    const pl = Math.hypot(prev.x, prev.y)
    // Bending while going down: right then left is "(", left then right is ")" (and the other way going up).
    const bend = (d.x / len - prev.x / pl) * Math.sign(d.y || 1)
    if (bend > 0.25) return '('
    if (bend < -0.25) return ')'
  }
  return '|'
}

/** Paint from the last point to `p`. Returns new marks when something changed, else null. */
export function signsTo(st: SignStroke, p: { x: number; y: number }, from: { x: number; y: number } | null): Record<string, AsciiMark> | null {
  let sign = st.sign
  if (st.mode === 'line') {
    // A direction needs some way travelled; until then nothing is drawn.
    const at = (st.anchor ??= p)
    const d = { x: p.x - at.x, y: p.y - at.y }
    if (Math.hypot(d.x, d.y) < st.cw * 0.9) return null
    const cy = Math.floor(p.y / st.ch)
    sign = lineSign(d, st.dir, (p.y - cy * st.ch) / st.ch)
    st.dir = d
    st.anchor = p
    from = at
  }
  const a = from ?? p
  const steps = Math.max(1, Math.ceil(Math.hypot(p.x - a.x, p.y - a.y) / (st.cw / 2)))
  const r = st.size * st.cw
  let changed = false
  for (let k = 0; k <= steps; k++) {
    const x = a.x + ((p.x - a.x) * k) / steps
    const y = a.y + ((p.y - a.y) * k) / steps
    const cx0 = Math.floor((x - r) / st.cw)
    const cx1 = Math.floor((x + r) / st.cw)
    const cy0 = Math.floor((y - r) / st.ch)
    const cy1 = Math.floor((y + r) / st.ch)
    for (let cy = Math.max(0, cy0); cy <= Math.min(st.rows - 1, cy1); cy++)
      for (let cx = Math.max(0, cx0); cx <= Math.min(st.cols - 1, cx1); cx++) {
        if (r > 0 && Math.hypot((cx + 0.5) * st.cw - x, (cy + 0.5) * st.ch - y) > r + st.cw / 2) continue
        if (mark(st, `${cx * st.cw},${cy * st.ch}`, sign)) changed = true
      }
  }
  return changed ? { ...st.marks } : null
}

function mark(st: SignStroke, key: string, sign: string): boolean {
  const old = st.marks[key]
  if (st.mode === 'auto') {
    if (!old) return false
    delete st.marks[key]
    return true
  }
  const m: AsciiMark = { ...old }
  if (st.mode === 'line' || st.mode === 'sign') {
    if (old?.s === sign && old.c === st.color) return false
    m.s = sign
    m.c = st.color
  } else {
    if (st.done.has(key)) return false
    st.done.add(key)
    if (st.mode === 'scatter') {
      m.s = SCATTER[Math.floor(Math.random() * SCATTER.length)]
      m.c ??= st.color
    } else {
      m.d = (m.d ?? 0) + (st.mode === 'shade' ? 1 : -1)
      if (!m.d) delete m.d
      if (st.mode === 'shade') m.c ??= st.color
    }
  }
  if (m.s === undefined && m.d === undefined) delete st.marks[key]
  else st.marks[key] = m
  return true
}
