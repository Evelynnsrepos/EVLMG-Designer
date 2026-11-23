import { useEffect, useRef, useState } from 'react'
import type { Id } from '@/core/model'
import {
  frameIds,
  frameOf,
  normalizeAnimation,
  normalizePages,
  onionSkins,
  playable,
  sequence,
  showFrames,
  type AnimationSettings,
  type PageSettings,
} from './assist'
import { duplicateTree, exportLayers, hasPixels, insertAbove, isGroup, isMask, subtreeIds } from './layers'
import type { LayerHost } from './LayersPanel'
import { newLayer, type SketchLayer } from './model'

/**
 * Animation Assist and Page Assist in the editor (Sketch Pro): which frame is
 * shown, playback, onion skins and drawing the view. The pure frame logic is
 * in assist.ts; the bar is AssistBar.tsx.
 */

export type Assist = ReturnType<typeof useAssist>

const uniq = (xs: number[]) => [...new Set(xs.filter((i) => i >= 0))]

/** What Animation Assist and Page Assist need from the editor. */
export type AssistHost = Pick<LayerHost, 'doc' | 'update' | 'engine' | 'activeId' | 'setActive' | 'markDirty' | 'adopt' | 'limit'>

export function useAssist(host: AssistHost) {
  const { doc, engine } = host
  const anim = normalizeAnimation(doc.animation)
  const pages = normalizePages(doc.pages)
  const mode = anim.on ? ('animation' as const) : pages.on ? ('pages' as const) : null
  const ids = frameIds(doc.layers)
  const current = Math.max(0, frameOf(doc.layers, host.activeId))
  const frames = mode === 'pages' ? playable(ids.length, { background: pages.background, foreground: false }) : playable(ids.length, anim)
  const seq = sequence(ids, frames, anim.holds, anim.mode)
  const [pos, setPos] = useState<number | null>(null)
  const playing = mode === 'animation' && pos !== null && seq.length > 0
  const shown = playing ? seq[pos! % seq.length] : current
  const bg = (mode === 'animation' ? anim.background : pages.background) && ids.length > 1 ? 0 : -1
  const fg = mode === 'animation' && anim.foreground && ids.length > (bg >= 0 ? 2 : 1) ? ids.length - 1 : -1

  // Playback: one tick per frame at the frame rate.
  const seqLen = seq.length
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => setPos((p) => (p === null ? null : p + 1 < seqLen ? p + 1 : anim.mode === 'once' ? null : 0)), 1000 / anim.fps)
    return () => clearInterval(t)
  }, [playing, seqLen, anim.fps, anim.mode])

  const setAnim = (patch: Partial<AnimationSettings>) => host.update((d) => ({ ...d, animation: { ...normalizeAnimation(d.animation), ...patch } }))
  const setPages = (patch: Partial<PageSettings>) => host.update((d) => ({ ...d, pages: { ...normalizePages(d.pages), ...patch } }))

  /** The topmost paintable layer of a frame (the frame itself when it is a plain layer). */
  const paintableIn = (i: number): Id | undefined => {
    const inside = subtreeIds(doc.layers, ids[i])
    return doc.layers.filter((l) => inside.has(l.id) && !isGroup(l) && !isMask(l)).at(-1)?.id ?? ids[i]
  }

  /** Cached pictures under and around the current frame while onion skins are on. */
  const cache = useRef<{ key: string; layers: SketchLayer[] | null; idle: number; under: HTMLCanvasElement | null; onion: HTMLCanvasElement | null; tint: HTMLCanvasElement | null }>({
    key: '',
    layers: null,
    idle: -1,
    under: null,
    onion: null,
    tint: null,
  })

  /** The picture with only these frames; `forExport` leaves private layers out. */
  const render = (frames: number[], withBackground: boolean, forExport = false) => {
    const layers = showFrames(doc.layers, ids, uniq(frames))
    return engine.render({ layers: forExport ? exportLayers(layers) : layers, backgroundColor: doc.backgroundColor }, withBackground)
  }

  /** Draw the picture as the editor shows it (replaces `engine.render(doc)` in the view). */
  const paint = (ctx: CanvasRenderingContext2D) => {
    if (!mode) return ctx.drawImage(engine.render(doc, true, true), 0, 0)
    const skins = mode === 'animation' && !playing ? onionSkins(shown, frames, anim) : []
    if (!skins.length) return ctx.drawImage(render(uniq([bg, shown, fg]), true), 0, 0)
    // ponytail: with onion skins on, the current frame is blended over a flattened background frame,
    // so its blend modes don't reach into the background frame's layers. Exact without onion skins.
    const c = cache.current
    if (!engine.stroking && !engine.moving) c.idle = engine.version
    const key = `${c.idle}|${shown}|${bg}|${doc.backgroundColor}|${JSON.stringify(skins)}|${anim.onionBefore}|${anim.onionAfter}`
    if (key !== c.key || c.layers !== doc.layers) {
      c.key = key
      c.layers = doc.layers
      const make = () => engine.canvas().canvas
      c.under ??= make()
      c.onion ??= make()
      c.tint ??= make()
      const u = c.under.getContext('2d')!
      u.clearRect(0, 0, engine.width, engine.height)
      u.drawImage(render(bg >= 0 && bg !== shown ? [bg] : [], true), 0, 0)
      const o = c.onion.getContext('2d')!
      const t = c.tint.getContext('2d')!
      o.clearRect(0, 0, engine.width, engine.height)
      // Farthest first, so the nearest frames end up on top.
      for (const s of [...skins].reverse()) {
        t.globalCompositeOperation = 'source-over'
        t.clearRect(0, 0, engine.width, engine.height)
        t.drawImage(render([s.frame], false), 0, 0)
        t.globalCompositeOperation = 'source-in'
        t.fillStyle = s.before ? anim.onionBefore : anim.onionAfter
        t.fillRect(0, 0, engine.width, engine.height)
        o.globalAlpha = s.opacity
        o.drawImage(c.tint, 0, 0)
      }
      o.globalAlpha = 1
    }
    ctx.drawImage(c.under!, 0, 0)
    ctx.drawImage(c.onion!, 0, 0)
    ctx.drawImage(render(uniq([shown === bg ? -1 : shown, fg]), false), 0, 0)
  }

  /** Add a frame (a layer) or a page (a group with one layer) right above the current one. */
  const add = () => {
    if (doc.layers.filter((l) => !isGroup(l)).length >= host.limit) return
    const n = ids.length + 1
    const layer = newLayer(mode === 'pages' ? 'Layer 1' : `Frame ${n}`)
    host.adopt(layer.id)
    engine.setLayerImage(layer.id, null)
    if (mode !== 'pages') {
      host.update((d) => ({ ...d, layers: insertAbove(d.layers, layer, ids[current]) }))
      return host.setActive(layer.id)
    }
    const group: SketchLayer = { ...newLayer(`Page ${n}`), kind: 'group' }
    host.update((d) => {
      const layers = insertAbove(d.layers, group, ids[current])
      const at = layers.findIndex((l) => l.id === group.id)
      return { ...d, layers: [...layers.slice(0, at), { ...layer, parent: group.id }, ...layers.slice(at)] }
    })
    host.setActive(layer.id)
  }

  /** Copy the current frame (with its pixels) right above it. */
  const duplicate = () => {
    const r = duplicateTree(doc.layers, ids[current])
    if (doc.layers.filter((l) => !isGroup(l)).length + r.map.size > host.limit) return
    for (const [from, to] of r.map) {
      const l = doc.layers.find((x) => x.id === from)
      if (!l || !hasPixels(l)) continue
      host.adopt(to)
      engine.copyLayer(from, to)
      host.markDirty(to)
    }
    host.update((d) => ({ ...d, layers: r.layers }))
    if (r.top) host.setActive(r.top)
  }

  return {
    mode,
    anim,
    pages,
    ids,
    current,
    frames,
    seq,
    shown,
    bg,
    fg,
    playing,
    play: () => seq.length && setPos(Math.max(0, seq.indexOf(current))),
    stop: () => setPos(null),
    setAnim,
    setPages,
    /** Switch Animation Assist or Page Assist on or off (only one at a time). */
    toggle: (which: 'animation' | 'pages') => {
      setPos(null)
      host.update((d) => ({
        ...d,
        animation: { ...normalizeAnimation(d.animation), on: which === 'animation' ? !normalizeAnimation(d.animation).on : false },
        pages: { ...normalizePages(d.pages), on: which === 'pages' ? !normalizePages(d.pages).on : false },
      }))
    },
    select: (i: number) => {
      const id = paintableIn(i)
      if (id) host.setActive(id)
    },
    render,
    paint,
    add,
    duplicate,
  }
}
