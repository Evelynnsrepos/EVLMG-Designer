import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Lock, Pause, Play, Plus, Tag, Trash2, Unlock, Wand2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { newId } from '@/core/model'
import { toCanvas } from './codec'
import { ramp, tagFrames, type Img, type LoopMode, type PixelDoc, type PixelTag } from './model'

type Update = (fn: (d: PixelDoc) => PixelDoc) => void

const TAG_COLORS = ['#e03131', '#f08c00', '#2f9e44', '#1971c2', '#7048e8', '#c2255c']

/** Palette: click picks the main colour, right-click the second; double-click changes a swatch and every pixel using it. */
export function PalettePanel(p: { d: PixelDoc; colors: [string, string]; setColors(c: [string, string]): void; recolor(from: string, to: string): void; update: Update; onImport(): void; onExport(): void }) {
  const edit = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [steps, setSteps] = useState(5)
  // The native picker reports its final colour with "change", once it closes.
  useEffect(() => {
    const el = edit.current
    if (!el) return
    const onChange = () => {
      if (editing === null) return
      const from = p.d.palette[editing]
      if (from && from !== el.value) p.recolor(from, el.value)
      setEditing(null)
    }
    el.addEventListener('change', onChange)
    return () => el.removeEventListener('change', onChange)
  }, [editing, p])

  const [main, second] = p.colors
  return (
    <div className="px-panel">
      <div className="px-colors">
        <label className="px-color main" title="Main colour (left click)" style={{ background: main }}>
          <input type="color" value={main} onChange={(e) => p.setColors([e.target.value, second])} />
        </label>
        <label className="px-color second" title="Second colour (right click)" style={{ background: second }}>
          <input type="color" value={second} onChange={(e) => p.setColors([main, e.target.value])} />
        </label>
      </div>
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
              edit.current!.value = c
              edit.current!.click()
            }}
          />
        ))}
        <input ref={edit} type="color" className="px-hidden" aria-hidden tabIndex={-1} />
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
    </div>
  )
}

/** Layers, top first: show/hide, lock, opacity, order and names. */
export function LayersPanel(p: { d: PixelDoc; layerId: string; setLayerId(id: string): void; update: Update }) {
  const set = (id: string, patch: Partial<PixelDoc['layers'][number]>) => p.update((d) => ({ ...d, layers: d.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) }))
  const move = (id: string, by: number) =>
    p.update((d) => {
      const i = d.layers.findIndex((l) => l.id === id)
      const j = i + by
      if (j < 0 || j >= d.layers.length) return d
      const layers = [...d.layers]
      ;[layers[i], layers[j]] = [layers[j], layers[i]]
      return { ...d, layers }
    })
  const add = () => {
    const l = { id: newId(), name: `Layer ${p.d.layers.length + 1}`, visible: true, opacity: 1 }
    p.update((d) => {
      const i = d.layers.findIndex((x) => x.id === p.layerId)
      return { ...d, layers: [...d.layers.slice(0, i + 1), l, ...d.layers.slice(i + 1)] }
    })
    p.setLayerId(l.id)
  }
  const remove = (id: string) =>
    p.update((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== id), cels: Object.fromEntries(Object.entries(d.cels).filter(([k]) => !k.startsWith(`${id}:`))) }))
  return (
    <div className="px-panel">
      <strong className="px-head">
        Layers
        <button className="icon-btn" title="New layer" aria-label="New layer" onClick={add}>
          <Plus size={14} />
        </button>
      </strong>
      {[...p.d.layers].reverse().map((l) => (
        <div key={l.id} className={`px-layer${l.id === p.layerId ? ' on' : ''}`} onClick={() => p.setLayerId(l.id)}>
          <button className="icon-btn" title={l.visible ? 'Hide' : 'Show'} onClick={(e) => (e.stopPropagation(), set(l.id, { visible: !l.visible }))}>
            {l.visible ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
          <button className="icon-btn" title={l.locked ? 'Unlock' : 'Lock'} onClick={(e) => (e.stopPropagation(), set(l.id, { locked: !l.locked || undefined }))}>
            {l.locked ? <Lock size={12} /> : <Unlock size={12} />}
          </button>
          <input className="px-name" value={l.name} aria-label="Layer name" onChange={(e) => set(l.id, { name: e.target.value })} />
          <button className="icon-btn" title="Move up" onClick={(e) => (e.stopPropagation(), move(l.id, 1))}>
            <ArrowUp size={12} />
          </button>
          <button className="icon-btn" title="Move down" onClick={(e) => (e.stopPropagation(), move(l.id, -1))}>
            <ArrowDown size={12} />
          </button>
          <button className="icon-btn" title="Delete layer" disabled={p.d.layers.length < 2} onClick={(e) => (e.stopPropagation(), remove(l.id))}>
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      {p.d.layers
        .filter((l) => l.id === p.layerId)
        .map((l) => (
          <label key={l.id} className="px-row" title="Layer opacity">
            Opacity <input type="range" min={0} max={1} step={0.05} value={l.opacity} onChange={(e) => set(l.id, { opacity: Number(e.target.value) })} />
          </label>
        ))}
    </div>
  )
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
      const shift = (t: PixelTag) => ({ ...t, from: t.from > p.frame ? t.from + 1 : t.from, to: t.to >= p.frame ? t.to + 1 : t.to })
      return { ...x, frames: [...x.frames.slice(0, p.frame + 1), f, ...x.frames.slice(p.frame + 1)], cels, tags: x.tags.map(shift) }
    })
    p.setFrame(p.frame + 1)
  }
  const remove = () => {
    const gone = d.frames[p.frame].id
    change((x) => ({
      ...x,
      frames: x.frames.filter((f) => f.id !== gone),
      cels: Object.fromEntries(Object.entries(x.cels).filter(([k]) => !k.endsWith(`:${gone}`))),
      tags: x.tags
        .map((t) => ({ ...t, from: t.from > p.frame ? t.from - 1 : t.from, to: t.to >= p.frame ? t.to - 1 : t.to }))
        .filter((t) => t.to >= t.from),
    }))
    p.setFrame(Math.max(0, p.frame - 1))
  }
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
  const setTag = (id: string, patch: Partial<PixelTag>) => change((x) => ({ ...x, tags: x.tags.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
  const newTag = () => change((x) => ({ ...x, tags: [...x.tags, { id: newId(), name: `Tag ${x.tags.length + 1}`, from: p.frame, to: p.frame, color: TAG_COLORS[x.tags.length % TAG_COLORS.length], loop: 'forward' }] }))

  return (
    <div className="px-timeline">
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
        <button className="icon-btn" title="Move frame left" onClick={() => move(-1)}>
          ←
        </button>
        <button className="icon-btn" title="Move frame right" onClick={() => move(1)}>
          →
        </button>
        <button className="icon-btn" title="Delete frame" disabled={d.frames.length < 2} onClick={remove}>
          <Trash2 size={13} />
        </button>
        <label className="px-row" title="How long this frame shows">
          <input
            className="input px-ms"
            type="number"
            min={10}
            max={10000}
            value={d.frames[p.frame].duration}
            onChange={(e) => change((x) => ({ ...x, frames: x.frames.map((f, i) => (i === p.frame ? { ...f, duration: Math.max(10, Math.round(Number(e.target.value) || 100)) } : f)) }))}
          />
          ms ({Math.round(1000 / d.frames[p.frame].duration)} fps)
        </label>
        <button className="btn btn-ghost" title="Name a run of frames (idle, walk, attack)" onClick={newTag}>
          <Tag size={13} /> Tag
        </button>
      </div>
      <div className="px-frames">
        {d.frames.map((f, i) => (
          <button key={f.id} className={`px-frame${i === p.frame ? ' on' : ''}`} onClick={() => p.setFrame(i)} title={`Frame ${i + 1}`}>
            <Thumb img={p.frameImg(i)} />
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
          <input type="color" value={t.color} title="Colour" onChange={(e) => setTag(t.id, { color: e.target.value })} />
          <input className="input px-tagname" value={t.name} aria-label="Tag name" onChange={(e) => setTag(t.id, { name: e.target.value })} />
          frames
          <input className="input px-ms" type="number" min={1} max={d.frames.length} value={t.from + 1} onChange={(e) => setTag(t.id, { from: Math.max(0, Math.min(t.to, Number(e.target.value) - 1)) })} />–
          <input className="input px-ms" type="number" min={1} max={d.frames.length} value={t.to + 1} onChange={(e) => setTag(t.id, { to: Math.min(d.frames.length - 1, Math.max(t.from, Number(e.target.value) - 1)) })} />
          <select className="input" value={t.loop} onChange={(e) => setTag(t.id, { loop: e.target.value as LoopMode })}>
            <option value="forward">Forward</option>
            <option value="reverse">Reverse</option>
            <option value="pingpong">Ping-pong</option>
          </select>
          <button className="icon-btn" title="Delete tag" onClick={() => change((x) => ({ ...x, tags: x.tags.filter((o) => o.id !== t.id) }))}>
            <Trash2 size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

function Thumb({ img }: { img: Img }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    c.width = img.width
    c.height = img.height
    c.getContext('2d')!.drawImage(toCanvas(img), 0, 0)
  }, [img])
  return <canvas ref={ref} className="px-thumb" />
}

/** Preview window: the animation (or the picked tag) loops here at 1×, 2× or 4× while you draw. */
export function Preview({ d, frameImg, playTag }: { d: PixelDoc; frameImg(i: number): Img; playTag: string | null }) {
  const [scale, setScale] = useState(2)
  const [i, setI] = useState(0)
  const order = tagFrames(d.tags.find((t) => t.id === playTag) ?? null, d.frames.length)
  const frame = order[i % order.length] ?? 0
  useEffect(() => {
    const t = setTimeout(() => setI((n) => (n + 1) % Math.max(1, order.length)), d.frames[frame]?.duration ?? 100)
    return () => clearTimeout(t)
  }, [i, frame, order.length, d.frames])
  const ref = useRef<HTMLCanvasElement>(null)
  const img = frameImg(frame)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    c.width = img.width
    c.height = img.height
    c.getContext('2d')!.drawImage(toCanvas(img), 0, 0)
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
