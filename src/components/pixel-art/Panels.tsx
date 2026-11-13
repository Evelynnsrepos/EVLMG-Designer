import { ArrowDown, ArrowLeftRight, ArrowUp, ChevronDown, ChevronRight, Folder, FolderMinus, Copy, Shapes, Eye, EyeOff, Link2, Lock, Slash, Pause, Play, Plus, Tag, Trash2, Unlink, Unlock, Wand2 } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { promptDialog } from '@/shared/dialogs'
import { newId } from '@/core/model'
import { toCanvas } from '@/shared/pixel/codec'
import { BUILTIN_PALETTES } from '@/shared/pixel/color'
import { asSketchBlend, ramp, resolveKey, tagFrames, type Img, type LoopMode, type PixelDoc, type PixelLayer, type PixelTag } from '@/shared/pixel/model'
import { BLEND_MODES, type BlendMode } from '@/shared/sketch/blend'
import '@/shared/sketch/sketch.css'
import '@/shared/sketch/layers.css'
import { PopOut } from './PopOut'
import { ColorPanel } from '@/shared/sketch/ColorPanel'
import { sortPalette, unusedColors } from './docOps'

type Update = (fn: (d: PixelDoc) => PixelDoc, options?: { undoable?: boolean }) => void

/** Slider drags: the first change of a drag is the undo step, the rest only follow it (keys still step one by one). */
const slide = { on: false, first: true }
const slideProps = { onPointerDown: () => Object.assign(slide, { on: true, first: true }), onPointerUp: () => (slide.on = false) }
const slideStep = () => {
  const undoable = !slide.on || slide.first
  slide.first = false
  return { undoable }
}

const TAG_COLORS = ['#e03131', '#f08c00', '#2f9e44', '#1971c2', '#7048e8', '#c2255c']

/** Palette: click picks the main colour, right-click the second; double-click a swatch, pick its new colour in the colour panel and every pixel using it changes. */
export function PalettePanel(p: { d: PixelDoc; colors: [string, string]; setColors(c: [string, string]): void; recolor(from: string, to: string): void; update: Update; onImport(): void; onExport(): void }) {
  const [editing, setEditing] = useState<number | null>(null)
  const [steps, setSteps] = useState(5)

  const [main, second] = p.colors
  return (
    <div className="px-panel">
      <ColorPanel color={main} setColor={(c) => p.setColors([c, second])} swatches={p.d.palette} />
      {editing !== null && (
        <div className="px-row px-wrap px-editing">
          <span className="px-color-dot" style={{ background: p.d.palette[editing] }} /> → <span className="px-color-dot" style={{ background: main }} />
          <button className="btn" title="Every pixel in the old colour changes too" onClick={() => (p.recolor(p.d.palette[editing], main), setEditing(null))}>
            Change swatch
          </button>
          <button className="btn btn-ghost" onClick={() => setEditing(null)}>
            Cancel
          </button>
        </div>
      )}
      <PopOut id="palette" title="Palette">
        <strong>Palette</strong>
      <div className="px-swatches">
        {p.d.palette.map((c, i) => (
          <button
            key={`${c}${i}`}
            className={`px-swatch${c === main ? ' on' : ''}`}
            style={{ background: c }}
            title={`${c} · double-click to change it everywhere`}
            onClick={() => p.setColors([c, second])}
            onContextMenu={(e) => (e.preventDefault(), p.setColors([main, c]))}
            onDoubleClick={() => {
              setEditing(i)
              p.setColors([c, second])
            }}
          />
        ))}
      </div>
      <div className="px-row">
        <button className="btn btn-ghost" title="Add the main colour" onClick={() => p.update((d) => ({ ...d, palette: d.palette.includes(main) ? d.palette : [...d.palette, main] }))}>
          <Plus size={13} /> Add
        </button>
        <button className="btn btn-ghost" title="Remove the main colour from the palette" disabled={!p.d.palette.includes(main)} onClick={() => p.update((d) => ({ ...d, palette: d.palette.filter((c) => c !== main) }))}>
          <Trash2 size={13} />
        </button>
      </div>
      <div className="px-row" title="Ramp maker: shades of the main colour from dark to light, shadows a little cooler and lights a little warmer">
        <button className="btn btn-ghost" onClick={() => p.update((d) => ({ ...d, palette: [...d.palette, ...ramp(main, steps).filter((c) => !d.palette.includes(c))] }))}>
          <Wand2 size={13} /> Ramp
        </button>
        <input type="range" min={3} max={9} value={steps} onChange={(e) => setSteps(Number(e.target.value))} /> {steps}
      </div>
      <div className="px-row">
        <button className="btn btn-ghost" title="Open a .gpl, .pal or .hex palette" onClick={p.onImport}>
          Open
        </button>
        <button className="btn btn-ghost" title="Save as a .gpl palette" onClick={p.onExport}>
          Save
        </button>
      </div>
      </PopOut>
    </div>
  )
}

/** Layers, top first: show/hide, lock, opacity, order and names. */
export function LayersPanel(p: { d: PixelDoc; layerId: string; frameId: string; setLayerId(id: string): void; update: Update; layerImg(id: string): Img | undefined; allTiles?(id: string, on: boolean): void }) {
  const [folded, setFolded] = useState<Set<string>>(new Set())
  /** Change every layer of a group at once (one undo step). */
  const setGroup = (group: string, patch: (l: PixelLayer) => Partial<PixelLayer>) => p.update((d) => ({ ...d, layers: d.layers.map((l) => (l.group === group ? { ...l, ...patch(l) } : l)) }))
  /** Move a group's layers one step up or down, past the next layer. */
  const moveGroup = (group: string, by: number) =>
    p.update((d) => {
      const idx = d.layers.map((l, i) => (l.group === group ? i : -1)).filter((i) => i >= 0)
      const edge = by > 0 ? idx[idx.length - 1] + 1 : idx[0] - 1
      if (edge < 0 || edge >= d.layers.length) return d
      const members = idx.map((i) => d.layers[i])
      const rest = d.layers.filter((l) => l.group !== group)
      const at = rest.indexOf(d.layers[edge]) + (by > 0 ? 1 : 0)
      return { ...d, layers: [...rest.slice(0, at), ...members, ...rest.slice(at)] }
    })
  const putInGroup = async (id: string, value: string) => {
    const name = value === '+' ? (await promptDialog('Group name', 'Group'))?.trim() : value
    if (name === undefined || (value === '+' && !name)) return
    set(id, { group: name || undefined })
  }
  const groups = [...new Set(p.d.layers.map((l) => l.group).filter((g): g is string => !!g))]
  const set = (id: string, patch: Partial<PixelDoc['layers'][number]>, options?: { undoable?: boolean }) => p.update((d) => ({ ...d, layers: d.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) }), options)
  const move = (id: string, by: number) =>
    p.update((d) => {
      const i = d.layers.findIndex((l) => l.id === id)
      const j = i + by
      if (j < 0 || j >= d.layers.length) return d
      const layers = [...d.layers]
      ;[layers[i], layers[j]] = [layers[j], layers[i]]
      return { ...d, layers }
    })
  const add = (vector = false) => {
    const l = { id: newId(), name: vector ? `Shapes ${p.d.layers.length + 1}` : `Layer ${p.d.layers.length + 1}`, visible: true, opacity: 1, ...(vector ? { vector: true } : {}) }
    p.update((d) => {
      const i = d.layers.findIndex((x) => x.id === p.layerId)
      return { ...d, layers: [...d.layers.slice(0, i + 1), l, ...d.layers.slice(i + 1)] }
    })
    p.setLayerId(l.id)
  }
  const remove = (id: string) =>
    p.update((d) => ({
      ...d,
      layers: d.layers.filter((l) => l.id !== id),
      cels: Object.fromEntries(Object.entries(d.cels).filter(([k]) => !k.startsWith(`${id}:`))),
      ...(d.shapes ? { shapes: Object.fromEntries(Object.entries(d.shapes).filter(([k]) => !k.startsWith(`${id}:`))) } : {}),
    }))
  const groupRow = (g: string) => {
    const members = p.d.layers.filter((x) => x.group === g)
    const shown = members.some((x) => x.visible)
    const locked = members.every((x) => x.locked)
    return (
      <div className="sketch-layer px-group">
        <div className="sketch-layer-row">
          <button className="icon-btn sketch-fold" title={folded.has(g) ? 'Open the group' : 'Close the group'} onClick={() => setFolded((f) => (f.has(g) ? new Set([...f].filter((x) => x !== g)) : new Set([...f, g])))}>
            {folded.has(g) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </button>
          <button className="icon-btn" title={shown ? 'Hide the group' : 'Show the group'} onClick={() => setGroup(g, () => ({ visible: !shown }))}>
            {shown ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
          <Folder size={18} className="sketch-group-icon" />
          <input className="px-name sketch-layer-name" value={g} aria-label="Group name" onChange={(e) => setGroup(g, () => ({ group: e.target.value }))} />
          <button className="icon-btn" title={locked ? 'Unlock the group' : 'Lock the group'} onClick={() => setGroup(g, () => ({ locked: !locked || undefined }))}>
            {locked ? <Lock size={11} /> : <Unlock size={11} />}
          </button>
          <button className="icon-btn" title="Move the group up" onClick={() => moveGroup(g, 1)}>
            <ArrowUp size={12} />
          </button>
          <button className="icon-btn" title="Move the group down" onClick={() => moveGroup(g, -1)}>
            <ArrowDown size={12} />
          </button>
          <button className="icon-btn" title="Ungroup (the layers stay)" onClick={() => setGroup(g, () => ({ group: undefined }))}>
            <FolderMinus size={12} />
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="px-panel px-layers">
      <strong className="px-head">
        Layers
        <button className="icon-btn" title="New layer" aria-label="New layer" onClick={() => add()}>
          <Plus size={14} />
        </button>
        <button className="icon-btn" title="New shape layer: live shapes you can keep editing and animate" aria-label="New shape layer" onClick={() => add(true)}>
          <Shapes size={14} />
        </button>
      </strong>
      <div className="sketch-layer-list">
        {[...p.d.layers].reverse().map((l, i, top) => {
          const active = l.id === p.layerId
          const sub = !!l.sub && p.d.layers.some((x) => x.id === l.sub)
          return (
            <Fragment key={l.id}>
              {l.group && top[i - 1]?.group !== l.group && groupRow(l.group)}
              {!(l.group && folded.has(l.group)) && (
                <div className={`sketch-layer${active ? ' is-active' : ''}`} style={{ paddingLeft: 4 + (l.group ? 14 : 0) + (sub ? 14 : 0) }} onClick={() => p.setLayerId(l.id)}>
                  <div className="sketch-layer-row">
                    <button className="icon-btn" title={l.visible ? 'Hide' : 'Show'} onClick={(e) => (e.stopPropagation(), set(l.id, { visible: !l.visible }))}>
                      {l.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                    </button>
                    <LayerThumb img={p.layerImg(l.id)} />
                    {l.vector && (l.sub ? <Slash size={12} aria-label="Line layer" /> : <Shapes size={12} aria-label="Shape layer" />)}
                    <input className="px-name sketch-layer-name" value={l.name} aria-label="Layer name" onChange={(e) => set(l.id, { name: e.target.value })} />
                    {l.locked && <Lock size={11} aria-label="Locked" />}
                    {l.reference && (
                      <span className="sketch-badge" title="Reference layer: shown faintly, never exported">
                        R
                      </span>
                    )}
                    {p.allTiles && (
                      <button className={`icon-btn${l.allTiles ? ' on' : ''}`} title={l.allTiles ? 'Shown on all tiles: drawing on one tile draws on every tile. Click to stop.' : 'Show on all tiles: copies this tile to every tile, and drawing on one draws on all'} aria-label="Show on all tiles" onClick={(e) => (e.stopPropagation(), p.allTiles!(l.id, !l.allTiles))}>
                        <Link2 size={12} />
                      </button>
                    )}
                  </div>
                  {active && (
                    <div className="sketch-layer-props" onClick={(e) => e.stopPropagation()}>
                      <label className="sketch-slider" title="Layer opacity">
                        <span>Opacity</span>
                        <input type="range" min={0} max={1} step={0.01} value={l.opacity} {...slideProps} onChange={(e) => set(l.id, { opacity: Number(e.target.value) }, slideStep())} />
                        <span className="sketch-slider-value">{Math.round(l.opacity * 100)}%</span>
                      </label>
                      {p.d.kind === 'sprite' && p.d.frames.length > 1 && (
                        <label className="sketch-slider" title="How see-through this layer is on this frame only (for fades)">
                          <span>This frame</span>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={p.d.celOpacity?.[`${l.id}:${p.frameId}`] ?? 1}
                            {...slideProps}
                            onChange={(e) =>
                              p.update((d) => {
                                const celOpacity = { ...d.celOpacity }
                                const v = Number(e.target.value)
                                if (v >= 1) delete celOpacity[`${l.id}:${p.frameId}`]
                                else celOpacity[`${l.id}:${p.frameId}`] = v
                                return { ...d, celOpacity }
                              }, slideStep())
                            }
                          />
                          <span className="sketch-slider-value">{Math.round((p.d.celOpacity?.[`${l.id}:${p.frameId}`] ?? 1) * 100)}%</span>
                        </label>
                      )}
                      <select className="input" title="How this layer mixes with the layers below" value={asSketchBlend(l.blend)} onChange={(e) => set(l.id, { blend: e.target.value === 'source-over' ? undefined : (e.target.value as BlendMode) })}>
                        {[...new Set(BLEND_MODES.map((m) => m.group))].map((g) => (
                          <optgroup key={g} label={g}>
                            {BLEND_MODES.filter((m) => m.group === g).map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.label}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <select className="input" title="Groups fold, hide, lock and move together" value={l.group ?? ''} onChange={(e) => void putInGroup(l.id, e.target.value)}>
                        <option value="">No group</option>
                        {groups.map((g) => (
                          <option key={g} value={g}>
                            Group: {g}
                          </option>
                        ))}
                        <option value="+">New group…</option>
                      </select>
                      <div className="sketch-layer-actions">
                        <button className={`btn btn-ghost sketch-small${l.locked ? ' is-active' : ''}`} title="Lock: no drawing on this layer" onClick={() => set(l.id, { locked: !l.locked || undefined })}>
                          Lock
                        </button>
                        <button className={`btn btn-ghost sketch-small${l.reference ? ' is-active' : ''}`} title="A tracing layer: shown faintly while you draw and left out of every export" onClick={() => set(l.id, { reference: !l.reference || undefined })}>
                          Reference
                        </button>
                        <button className="btn btn-ghost sketch-small" title="Move up" onClick={() => move(l.id, 1)}>
                          ↑
                        </button>
                        <button className="btn btn-ghost sketch-small" title="Move down" onClick={() => move(l.id, -1)}>
                          ↓
                        </button>
                        <button className="btn btn-ghost sketch-small" title="Delete layer" disabled={p.d.layers.length < 2} onClick={() => remove(l.id)}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

/** A layer's picture, small, with hard pixels. */
function LayerThumb({ img }: { img: Img | undefined }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const g = c.getContext('2d')!
    g.clearRect(0, 0, c.width, c.height)
    if (!img) return
    const k = Math.min(c.width / img.width, c.height / img.height)
    g.imageSmoothingEnabled = false
    g.drawImage(toCanvas(img), (c.width - img.width * k) / 2, (c.height - img.height * k) / 2, img.width * k, img.height * k)
  }, [img])
  return <canvas ref={ref} width={44} height={32} className="sketch-thumb px-layer-thumb" />
}

/** Frames with their duration, tags and play. */
export function Timeline(p: {
  d: PixelDoc
  frame: number
  setFrame(i: number): void
  frameImg(i: number): Img
  update: Update
  playing: boolean
  togglePlay(): void
  playTag: string | null
  setPlayTag(id: string | null): void
}) {
  const { d } = p
  const change = (fn: (d: PixelDoc) => PixelDoc) => p.update(fn)
  const add = (copy: boolean) => {
    const f = { id: newId(), duration: d.frames[p.frame].duration }
    change((x) => {
      const cels = { ...x.cels }
      if (copy) for (const l of x.layers) if (x.cels[`${l.id}:${x.frames[p.frame].id}`]) cels[`${l.id}:${f.id}`] = x.cels[`${l.id}:${x.frames[p.frame].id}`]
      // Live shapes come along as an in-between: change them and the frame becomes a key.
      const shapes = { ...x.shapes }
      if (copy) for (const l of x.layers) {
        const s = x.shapes?.[resolveKey(x.cels, `${l.id}:${x.frames[p.frame].id}`)]
        if (l.vector && s) shapes[`${l.id}:${f.id}`] = { key: false, list: s.list }
      }
      const shift = (t: PixelTag) => ({ ...t, from: t.from > p.frame ? t.from + 1 : t.from, to: t.to >= p.frame ? t.to + 1 : t.to })
      return { ...x, frames: [...x.frames.slice(0, p.frame + 1), f, ...x.frames.slice(p.frame + 1)], cels, ...(x.shapes ? { shapes } : {}), tags: x.tags.map(shift) }
    })
    p.setFrame(p.frame + 1)
  }
  /** A new frame showing the same pixels as this one; drawing on either changes both. */
  const link = () => {
    const f = { id: newId(), duration: d.frames[p.frame].duration }
    change((x) => {
      const cels = { ...x.cels }
      const from = x.frames[p.frame].id
      for (const l of x.layers) if (x.cels[`${l.id}:${from}`]) cels[`${l.id}:${f.id}`] = x.cels[`${l.id}:${from}`].startsWith('@') ? x.cels[`${l.id}:${from}`] : `@${from}`
      return { ...x, frames: [...x.frames.slice(0, p.frame + 1), f, ...x.frames.slice(p.frame + 1)], cels }
    })
    p.setFrame(p.frame + 1)
  }
  /** This frame gets its own copy of linked pixels. */
  const unlink = () =>
    change((x) => {
      const cels = { ...x.cels }
      const id = x.frames[p.frame].id
      for (const l of x.layers) {
        const k = `${l.id}:${id}`
        if (cels[k]?.startsWith('@')) cels[k] = x.cels[resolveKey(x.cels, k)]
      }
      return { ...x, cels }
    })
  const linked = d.layers.some((l) => d.cels[`${l.id}:${d.frames[p.frame].id}`]?.startsWith('@'))
  // Shift-click picks a run of frames: delete, duration and reverse then work on all of them.
  const [range, setRange] = useState<[number, number] | null>(null)
  const picked = range ? [Math.min(...range), Math.max(...range)] : [p.frame, p.frame]
  const inPick = (i: number) => i >= picked[0] && i <= picked[1]
  const remove = () => {
    const gone = new Set(d.frames.filter((_, i) => inPick(i)).map((f) => f.id))
    if (gone.size >= d.frames.length) return
    change((x) => {
      const kept = x.frames.map((f, i) => [f, i] as const).filter(([f]) => !gone.has(f.id))
      const cels: Record<string, string> = {}
      for (const [k, v] of Object.entries(x.cels)) {
        if (gone.has(k.slice(k.indexOf(':') + 1))) continue
        // Frames linked to one that goes keep its pixels.
        cels[k] = v.startsWith('@') && gone.has(v.slice(1)) ? x.cels[resolveKey(x.cels, `${k.slice(0, k.indexOf(':'))}:${v.slice(1)}`)] : v
      }
      const at = (old: number) => kept.findIndex(([, i]) => i >= old)
      const tags = x.tags
        .map((t) => {
          const inside = kept.filter(([, i]) => i >= t.from && i <= t.to)
          return inside.length ? { ...t, from: at(inside[0][1]), to: at(inside[inside.length - 1][1]) } : null
        })
        .filter((t): t is PixelTag => !!t)
      return { ...x, frames: kept.map(([f]) => f), cels, tags }
    })
    setRange(null)
    p.setFrame(Math.max(0, picked[0] - 1))
  }
  /** The picked frames (or all of them) in reverse order. */
  const reverse = () =>
    change((x) => {
      const [a, b] = range ? picked : [0, x.frames.length - 1]
      return { ...x, frames: [...x.frames.slice(0, a), ...x.frames.slice(a, b + 1).reverse(), ...x.frames.slice(b + 1)] }
    })
  const move = (by: number) => {
    const j = p.frame + by
    if (j < 0 || j >= d.frames.length) return
    change((x) => {
      const frames = [...x.frames]
      ;[frames[p.frame], frames[j]] = [frames[j], frames[p.frame]]
      return { ...x, frames }
    })
    p.setFrame(j)
  }
  /** Drag a frame onto another place in the timeline (tags stay on their frame numbers, like the arrows). */
  const [dragging, setDragging] = useState<number | null>(null)
  const dropAt = (to: number) => {
    const from = dragging
    setDragging(null)
    if (from === null || from === to) return
    change((x) => {
      const frames = [...x.frames]
      const [f] = frames.splice(from, 1)
      frames.splice(to, 0, f)
      return { ...x, frames }
    })
    p.setFrame(to)
  }
  const setTag = (id: string, patch: Partial<PixelTag>) => change((x) => ({ ...x, tags: x.tags.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
  const newTag = () => change((x) => ({ ...x, tags: [...x.tags, { id: newId(), name: `Tag ${x.tags.length + 1}`, from: p.frame, to: p.frame, color: TAG_COLORS[x.tags.length % TAG_COLORS.length], loop: 'forward' }] }))

  return (
    <div className="px-timeline" data-tour="px-timeline">
      <div className="px-timeline-bar">
        <button className="icon-btn" title={p.playing ? 'Stop' : 'Play'} aria-label={p.playing ? 'Stop' : 'Play'} onClick={p.togglePlay}>
          {p.playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <select className="input" value={p.playTag ?? ''} title="What plays" onChange={(e) => p.setPlayTag(e.target.value || null)}>
          <option value="">All frames</option>
          {d.tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button className="btn btn-ghost" onClick={() => add(false)}>
          <Plus size={13} /> Frame
        </button>
        <button className="btn btn-ghost" title="Copy this frame" onClick={() => add(true)}>
          <Copy size={13} /> Copy
        </button>
        <button className="btn btn-ghost" title="A new frame with the same pixels: drawing on one changes both" onClick={link}>
          <Link2 size={13} /> Link
        </button>
        {linked && (
          <button className="btn btn-ghost" title="Give this frame its own copy of the pixels" onClick={unlink}>
            <Unlink size={13} /> Unlink
          </button>
        )}
        <button className="icon-btn" title="Move frame left" onClick={() => move(-1)}>
          ←
        </button>
        <button className="icon-btn" title="Move frame right" onClick={() => move(1)}>
          →
        </button>
        <button className="btn btn-ghost" title={range ? 'Reverse the picked frames' : 'Reverse all frames'} onClick={reverse}>
          <ArrowLeftRight size={13} /> Reverse
        </button>
        <button className="icon-btn" title={range ? 'Delete the picked frames' : 'Delete frame'} disabled={d.frames.length < 2} onClick={remove}>
          <Trash2 size={13} />
        </button>
        <label className="px-row" title="How long this frame shows">
          <input
            className="input px-ms"
            type="number"
            min={10}
            max={10000}
            value={d.frames[p.frame].duration}
            onChange={(e) => change((x) => ({ ...x, frames: x.frames.map((f, i) => (inPick(i) ? { ...f, duration: Math.max(10, Math.round(Number(e.target.value) || 100)) } : f)) }))}
          />
          ms ({Math.round(1000 / d.frames[p.frame].duration)} fps)
        </label>
        <button className="btn btn-ghost" title="Name a run of frames (idle, walk, attack)" onClick={newTag}>
          <Tag size={13} /> Tag
        </button>
      </div>
      <div className="px-frames">
        {d.frames.map((f, i) => (
          <button
            key={f.id}
            className={`px-frame${i === p.frame ? ' on' : ''}${range && inPick(i) ? ' picked' : ''}${dragging !== null && dragging !== i ? ' drop' : ''}`}
            draggable
            onDragStart={(e) => (e.dataTransfer.setData('text/plain', String(i)), (e.dataTransfer.effectAllowed = 'move'), setDragging(i))}
            onDragOver={(e) => dragging !== null && e.preventDefault()}
            onDrop={(e) => (e.preventDefault(), dropAt(i))}
            onDragEnd={() => setDragging(null)}
            onClick={(e) => {
              if (e.shiftKey) return setRange([p.frame, i])
              setRange(null)
              p.setFrame(i)
            }}
            title={`Frame ${i + 1} (Shift-click to pick several, drag to move)`}
          >
            <Thumb img={p.frameImg(i)} />
            {d.layers.some((l) => d.cels[`${l.id}:${f.id}`]?.startsWith('@')) && <Link2 size={10} className="px-linkmark" />}
            <span>
              {i + 1} · {f.duration}ms
            </span>
            {d.tags
              .filter((t) => i >= t.from && i <= t.to)
              .map((t) => (
                <i key={t.id} className="px-tagbar" style={{ background: t.color }} title={t.name} />
              ))}
          </button>
        ))}
      </div>
      {d.tags.map((t) => (
        <div key={t.id} className="px-tag">
          <button className="px-swatch px-tag-color" style={{ background: t.color }} title="Tag colour: click for the next one" onClick={() => setTag(t.id, { color: TAG_COLORS[(TAG_COLORS.indexOf(t.color) + 1) % TAG_COLORS.length] })} />
          <input className="input px-tagname" value={t.name} aria-label="Tag name" onChange={(e) => setTag(t.id, { name: e.target.value })} />
          frames
          <input className="input px-ms" type="number" min={1} max={d.frames.length} value={t.from + 1} onChange={(e) => setTag(t.id, { from: Math.max(0, Math.min(t.to, Number(e.target.value) - 1)) })} />–
          <input className="input px-ms" type="number" min={1} max={d.frames.length} value={t.to + 1} onChange={(e) => setTag(t.id, { to: Math.min(d.frames.length - 1, Math.max(t.from, Number(e.target.value) - 1)) })} />
          <select className="input" value={t.loop} onChange={(e) => setTag(t.id, { loop: e.target.value as LoopMode })}>
            <option value="forward">Forward</option>
            <option value="reverse">Reverse</option>
            <option value="pingpong">Ping-pong</option>
          </select>
          <label className="px-row" title="Play this run several times in a row (walk ×3), in exports too">
            ×<input className="input px-ms" type="number" min={1} max={99} value={t.repeat ?? 1} aria-label="Repeat" onChange={(e) => setTag(t.id, { repeat: Math.max(1, Math.min(99, Math.round(Number(e.target.value) || 1))) > 1 ? Math.max(1, Math.min(99, Math.round(Number(e.target.value) || 1))) : undefined })} />
          </label>
          <button className="icon-btn" title="Delete tag" onClick={() => change((x) => ({ ...x, tags: x.tags.filter((o) => o.id !== t.id) }))}>
            <Trash2 size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

/** Draw `img` into `c` scaled up `k`× with hard pixels (CSS scaling blurs pixel art in some web views). */
export function drawSharp(c: HTMLCanvasElement, img: Img, k: number) {
  k = Math.max(1, Math.round(k * (window.devicePixelRatio || 1)))
  ;[c.width, c.height] = [img.width * k, img.height * k]
  const g = c.getContext('2d')!
  g.imageSmoothingEnabled = false
  g.drawImage(toCanvas(img), 0, 0, img.width * k, img.height * k)
}

function Thumb({ img }: { img: Img }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (ref.current) drawSharp(ref.current, img, Math.max(1, Math.floor(48 / Math.max(img.width, img.height))))
  }, [img])
  return <canvas ref={ref} className="px-thumb" />
}

/** Preview window: the animation (or the picked tag) loops here at 1×, 2× or 4× while you draw. */
export function Preview({ d, frameImg, playTag }: { d: PixelDoc; frameImg(i: number): Img; playTag: string | null }) {
  const [scale, setScale] = useState(2)
  const [i, setI] = useState(0)
  const order = tagFrames(d.tags.find((t) => t.id === playTag) ?? null, d.frames.length, d.tags)
  const frame = order[i % order.length] ?? 0
  useEffect(() => {
    const t = setTimeout(() => setI((n) => (n + 1) % Math.max(1, order.length)), d.frames[frame]?.duration ?? 100)
    return () => clearTimeout(t)
  }, [i, frame, order.length, d.frames])
  const ref = useRef<HTMLCanvasElement>(null)
  const img = frameImg(frame)
  useEffect(() => {
    if (ref.current) drawSharp(ref.current, img, scale)
  })
  return (
    <div className="px-panel">
      <strong className="px-head">
        Preview
        <span className="px-row">
          {[1, 2, 4].map((s) => (
            <button key={s} className={`btn btn-ghost${s === scale ? ' on' : ''}`} onClick={() => setScale(s)}>
              {s}×
            </button>
          ))}
        </span>
      </strong>
      <canvas ref={ref} className="px-preview" style={{ width: d.width * scale, height: d.height * scale }} />
    </div>
  )
}

/** Colour mode, ready-made palettes, palette from the picture, reducing to the palette and palette variants. */
export function ColorsPanel(p: {
  d: PixelDoc
  update: Update
  setMode(mode: PixelDoc['colorMode']): void
  fromPicture(): void
  reduceAll(dither: boolean): void
  variant: string | null
  setVariant(id: string | null): void
  openPalette(name: string, colors: string[]): void
  /** The main colour: a clicked variant swatch takes it. */
  main: string
}) {
  const [dither, setDither] = useState(false)
  const [presets, setPresets] = useState(false)
  const v = p.d.variants?.find((x) => x.id === p.variant)
  const setVariantColors = (colors: string[]) => p.update((d) => ({ ...d, variants: (d.variants ?? []).map((x) => (x.id === p.variant ? { ...x, colors } : x)) }))
  return (
    <div className="px-panel">
      <label className="px-row" title="Palette only: every colour you paint snaps to the palette. Grays: only grays.">
        Colours
        <select className="input" value={p.d.colorMode ?? ''} onChange={(e) => p.setMode((e.target.value || undefined) as PixelDoc['colorMode'])}>
          <option value="">Any colour</option>
          <option value="indexed">Palette only</option>
          <option value="gray">Grays</option>
        </select>
      </label>
      <div className="px-row" title="Open a ready-made palette">
        Palette
        <button className="btn btn-ghost" aria-expanded={presets} onClick={() => setPresets(!presets)}>
          Ready-made…
        </button>
      </div>
      {presets && (
        <div className="px-presets">
          {BUILTIN_PALETTES.map((x) => (
            <button
              key={x.name}
              className="px-preset"
              title={`${x.name}: ${x.colors.length} colours`}
              onClick={() => {
                setPresets(false)
                p.openPalette(x.name, [...x.colors])
              }}
            >
              <span>{x.name}</span>
              <span className="px-preset-chips">
                {x.colors.map((c, k) => (
                  <i key={k} style={{ background: c }} />
                ))}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="px-row px-wrap">
        <button className="btn btn-ghost" title="The colours this frame uses become the palette" onClick={p.fromPicture}>
          From picture
        </button>
        <button className="btn btn-ghost" title="Move every pixel in every frame to its closest palette colour" onClick={() => p.reduceAll(dither)}>
          Reduce to palette
        </button>
        <label className="px-row" title="Mix neighbouring palette colours for smoother shades">
          <input type="checkbox" checked={dither} onChange={(e) => setDither(e.target.checked)} /> dither
        </label>
      </div>
      <div className="px-row px-wrap" title="Tidy the palette (undo brings the old order back)">
        <button className="btn btn-ghost" title="Order the palette by colour, grays first, each colour dark to light" onClick={() => p.update((x) => ({ ...x, palette: sortPalette(x.palette, 'hue') }))}>
          Sort by colour
        </button>
        <button className="btn btn-ghost" title="Order the palette from dark to light" onClick={() => p.update((x) => ({ ...x, palette: sortPalette(x.palette, 'light') }))}>
          Sort by lightness
        </button>
        <button className="btn btn-ghost" title="Take out palette colours no pixel uses" onClick={() => p.update((x) => {
          const unused = new Set(unusedColors(x))
          return unused.size ? { ...x, palette: x.palette.filter((c) => !unused.has(c)) } : x
        })}>
          Remove unused
        </button>
      </div>
      <label className="px-row" title="Palette variants: try other colours on the whole animation without changing it">
        Variant
        <select className="input" value={p.variant ?? ''} onChange={(e) => p.setVariant(e.target.value || null)}>
          <option value="">Original</option>
          {(p.d.variants ?? []).map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <button
          className="icon-btn"
          title="New variant from the palette"
          onClick={() => {
            const id = newId()
            p.update((d) => ({ ...d, variants: [...(d.variants ?? []), { id, name: `Variant ${(d.variants?.length ?? 0) + 1}`, colors: [...d.palette] }] }))
            p.setVariant(id)
          }}
        >
          <Plus size={13} />
        </button>
      </label>
      {v && (
        <>
          <input className="input" value={v.name} aria-label="Variant name" onChange={(e) => p.update((d) => ({ ...d, variants: (d.variants ?? []).map((x) => (x.id === v.id ? { ...x, name: e.target.value } : x)) }))} />
          <div className="px-swatches">
            {p.d.palette.map((c, i) => (
              <button
                key={`${c}${i}`}
                className="px-swatch"
                style={{ background: v.colors[i] ?? c }}
                title={`${c} shows as ${v.colors[i] ?? c} · click: the main colour, right-click: back to ${c}`}
                onClick={() => setVariantColors(p.d.palette.map((x, k) => (k === i ? p.main : (v.colors[k] ?? x))))}
                onContextMenu={(e) => (e.preventDefault(), setVariantColors(p.d.palette.map((x, k) => (k === i ? x : (v.colors[k] ?? x)))))}
              />
            ))}
          </div>
          <button className="btn btn-ghost" onClick={() => (p.update((d) => ({ ...d, variants: (d.variants ?? []).filter((x) => x.id !== v.id) })), p.setVariant(null))}>
            <Trash2 size={13} /> Delete variant
          </button>
        </>
      )}
    </div>
  )
}
