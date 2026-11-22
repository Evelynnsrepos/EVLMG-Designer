import { useEffect, useRef } from 'react'
import { newId, type Id } from '@/core/model'
import { normalizeSettings, type BrushSettings } from './brushes'
import type { SketchEngine, StrokeOptions } from './engine'
import type { InputPoint, LayerWiggle, SketchLayer, WiggleStroke } from './model'

/**
 * Animated layers (0.35): strokes of an animated brush wiggle in a loop. The layer's own pixels are frame 0, a normal
 * still picture; the other frames are painted again from the layer's strokes, each with its own wiggle.
 */

export const FRAMES = { min: 2, max: 12, start: 4 }
export const FPS = { min: 2, max: 24, start: 8 }

export const newWiggle = (): LayerWiggle => ({ frames: FRAMES.start, fps: FPS.start, brushes: {}, strokes: [] })
export const framesOf = (w: LayerWiggle) => Math.max(FRAMES.min, Math.min(FRAMES.max, Math.round(w.frames) || FRAMES.start))
export const fpsOf = (w: LayerWiggle) => Math.max(FPS.min, Math.min(FPS.max, Number(w.fps) || FPS.start))

/** True when any layer of the drawing moves. */
export const hasAnimatedLayers = (layers: SketchLayer[]) => layers.some((l) => l.wiggle)

/** The layer as a normal still layer again (its pixels are already frame 0). */
export function rasterized(l: SketchLayer): SketchLayer {
  const { wiggle: _, ...rest } = l
  return rest
}

/** FNV-1a: the same brush settings give the same key, so each brush is stored once per layer. */
export function brushKey(b: BrushSettings): string {
  const s = JSON.stringify(b)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36)
}

/** The layer's strokes with every point moved by `map` (the canvas grew, was cropped, flipped or turned). */
export function mapWiggle(w: LayerWiggle, map: (p: { x: number; y: number }) => { x: number; y: number }): LayerWiggle {
  return {
    ...w,
    strokes: w.strokes.map((s) => {
      const points = [...s.points]
      for (let i = 0; i + 2 < points.length; i += 3) {
        const q = map({ x: points[i], y: points[i + 1] })
        points[i] = Math.round(q.x * 10) / 10
        points[i + 1] = Math.round(q.y * 10) / 10
      }
      return { ...s, points }
    }),
  }
}

export function packPoints(pts: InputPoint[]): number[] {
  const out: number[] = []
  for (const p of pts) out.push(Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.pressure * 1000) / 1000)
  return out
}

export function unpackPoints(a: number[]): InputPoint[] {
  const out: InputPoint[] = []
  for (let i = 0; i + 2 < a.length; i += 3) out.push({ x: a[i], y: a[i + 1], pressure: a[i + 2] })
  return out
}

/** A stroke added to an animated layer's strokes (the layer becomes animated if it wasn't). */
export function withStroke(w: LayerWiggle | undefined, s: { brush: BrushSettings; color: string; erase: boolean; smudge: boolean; points: InputPoint[]; seed: number }): LayerWiggle {
  const base = w ?? newWiggle()
  const key = brushKey(s.brush)
  const stroke: WiggleStroke = { id: newId(), brushKey: key, color: s.color, seed: s.seed, points: packPoints(s.points), ...(s.erase ? { erase: true } : {}), ...(s.smudge ? { smudge: true } : {}) }
  return { ...base, brushes: base.brushes[key] ? base.brushes : { ...base.brushes, [key]: s.brush }, strokes: [...base.strokes, stroke] }
}

/** 0..1, the same for the same (seed, i). */
function rand(seed: number, i: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 0x632be5ab, 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Smooth noise -1..1 along x. */
function noise(seed: number, x: number): number {
  const i = Math.floor(x)
  const f = x - i
  const t = f * f * (3 - 2 * f)
  return (rand(seed, i) * (1 - t) + rand(seed, i + 1) * t) * 2 - 1
}

/** How far (px) a brush's line moves. */
export const wiggleReach = (b: BrushSettings) => Math.min(80, (b.wiggle ?? 0) * (6 + b.size * 0.8))

/**
 * The stroke's points on frame k of n. Boil: each frame a new smooth wobble. Wave: a wave runs along the line and
 * is back where it started after n frames, so the loop has no jump.
 */
export function wiggled(points: InputPoint[], b: BrushSettings, seed: number, k: number, n: number): InputPoint[] {
  const amp = wiggleReach(b)
  if (!amp || !points.length) return points
  const len = Math.max(40, b.size * 4)
  let s = 0
  return points.map((p, i) => {
    if (i) s += Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y)
    if (b.wiggleStyle === 'wave') {
      const a = points[Math.max(0, i - 1)]
      const c = points[Math.min(points.length - 1, i + 1)]
      const d = Math.hypot(c.x - a.x, c.y - a.y) || 1
      const w = Math.sin(2 * Math.PI * (s / (len * 2) - k / n)) * amp
      return { ...p, x: p.x - ((c.y - a.y) / d) * w, y: p.y + ((c.x - a.x) / d) * w }
    }
    const t = s / len
    return { ...p, x: p.x + noise(seed * 31 + k * 2, t) * amp, y: p.y + noise(seed * 31 + k * 2 + 1, t) * amp }
  })
}

function paintStroke(engine: SketchEngine, layer: SketchLayer, st: WiggleStroke, w: LayerWiggle, k: number, n: number, mirror: StrokeOptions['mirror']) {
  const saved = w.brushes[st.brushKey]
  if (!saved) return
  const brush = normalizeSettings(saved)
  const opts: StrokeOptions = { layer, brush, color: st.color, symmetry: 'off', erase: !!st.erase, smudge: !!st.smudge, mirror }
  // Frame 0 was painted with seed 1 (see endAnimatedStroke): still brushes look the same on every frame, animated ones get new grain.
  engine.paintFrame(layer.id, k, opts, wiggled(unpackPoints(st.points), brush, st.seed, k, n), (brush.wiggle ?? 0) > 0 ? 1 + k : 1)
}

/**
 * Keep the engine's frames of animated layers in step with their strokes (a new stroke is painted onto each frame;
 * undo or a changed frame count paints them all again), and play them in the view.
 */
export function useAnimatedLayers(engine: SketchEngine, layers: SketchLayer[], o: { paused: boolean; redraw: () => void; mirror: (layerId: Id) => StrokeOptions['mirror'] }) {
  const seen = useRef(new Map<Id, { frames: number; ids: string[] }>())
  const seenEngine = useRef(engine)
  useEffect(() => {
    // A new engine (the canvas was resized) has no frames yet.
    if (seenEngine.current !== engine) {
      seenEngine.current = engine
      seen.current.clear()
    }
    const live = new Set<Id>()
    for (const l of layers) {
      if (!l.wiggle) continue
      live.add(l.id)
      const w = l.wiggle
      const n = framesOf(w)
      const ids = w.strokes.map((s) => s.id)
      const prev = seen.current.get(l.id)
      const same = (a: string[], upTo: number) => a.length >= upTo && ids.length >= upTo && a.slice(0, upTo).every((x, i) => x === ids[i])
      if (prev && prev.frames === n && prev.ids.length === ids.length && same(prev.ids, ids.length)) continue
      if (engine.frameCount(l.id) !== n) engine.setFrames(l.id, n)
      // A stroke added at the end (a new stroke, or redo) is painted onto the frames; anything else paints them again.
      const from = prev && prev.frames === n && engine.frameCount(l.id) === n && same(prev.ids, prev.ids.length) ? prev.ids.length : 0
      const mirror = o.mirror(l.id)
      for (let k = 1; k < n; k++) {
        if (!from) engine.clearFrame(l.id, k)
        for (const st of w.strokes.slice(from)) paintStroke(engine, l, st, w, k, n, mirror)
      }
      seen.current.set(l.id, { frames: n, ids })
    }
    for (const id of [...seen.current.keys()]) {
      if (live.has(id)) continue
      seen.current.delete(id)
      engine.setFrames(id, 0)
    }
  })

  // Playback: one clock; each layer shows the frame its speed is at. Nothing moves while a stroke is drawn.
  const start = useRef(performance.now())
  const redraw = useRef(o.redraw)
  redraw.current = o.redraw
  useEffect(() => {
    const anim = layers.filter((l) => l.wiggle)
    if (!anim.length) return
    if (o.paused) {
      const v = engine.version
      for (const l of anim) engine.play(l.id, 0)
      if (engine.version !== v) redraw.current()
      return
    }
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      if (engine.stroking || engine.moving) return
      const t = (performance.now() - start.current) / 1000
      const v = engine.version
      for (const l of anim) engine.play(l.id, Math.floor(t * fpsOf(l.wiggle!)) % framesOf(l.wiggle!))
      if (engine.version !== v) redraw.current()
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [engine, layers, o.paused])
}
