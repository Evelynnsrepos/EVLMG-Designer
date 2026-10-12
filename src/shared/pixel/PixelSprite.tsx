import { useEffect, useMemo, useRef, useState } from 'react'
import type { Id } from '@/core/model'
import { useDocument, useProjectStore } from '@/core/state'
import { celImg, toCanvas, useDecoded } from './codec'
import { composite, createPixelDoc, tagFrames, type PixelDoc } from './model'

/** A sprite from a Pixel Art file on an entry (v0.16): the file and, optionally, the tag that plays. */
export interface SpriteRef {
  doc: Id
  tag?: Id
}

/** A Pixel Art file's animation (or one tag of it), looping, with sharp pixels, fitted into `size` px. */
export function PixelSprite({ sprite, size, animate = true }: { sprite: SpriteRef; size: number; animate?: boolean }) {
  const d = useDocument<PixelDoc>('pixel-art', sprite.doc, createPixelDoc).data
  const urls = useMemo(() => Object.values(d?.cels ?? {}), [d?.cels])
  useDecoded(urls)
  const [i, setI] = useState(0)
  const order = d ? tagFrames(d.tags.find((t) => t.id === sprite.tag) ?? null, d.frames.length) : []
  const frame = order[i % Math.max(1, order.length)] ?? 0
  useEffect(() => {
    if (!d || !animate || order.length < 2) return
    const t = setTimeout(() => setI((n) => n + 1), d.frames[frame]?.duration ?? 100)
    return () => clearTimeout(t)
  }, [d, animate, order.length, frame, i])
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c || !d?.frames[frame]) return
    const f = d.frames[frame].id
    const img = composite(d.layers.map((l) => ({ visible: l.visible, opacity: l.opacity, img: celImg(d.cels[`${l.id}:${f}`], d.width, d.height) })), d.width, d.height)
    c.width = d.width
    c.height = d.height
    c.getContext('2d')!.drawImage(toCanvas(img), 0, 0)
  })
  if (!d) return <div style={{ width: size, height: size }} />
  const k = Math.min(size / d.width, size / d.height)
  return <canvas ref={ref} className="pixel-sprite" style={{ width: d.width * k, height: d.height * k, imageRendering: 'pixelated', flex: 'none' }} />
}

/** Pick a Pixel Art file and the tag that plays, for an entry's sprite. */
export function SpritePicker({ sprite, onChange }: { sprite: SpriteRef | null | undefined; onChange(s: SpriteRef | null): void }) {
  const all = useProjectStore((s) => s.meta?.documents)
  const docs = (all ?? []).filter((x) => x.type === 'pixel-art')
  return (
    <label className="ld-inline pixel-sprite-picker" title="An animated sprite from Pixel Art, shown instead of the picture">
      Sprite
      <select className="input" value={sprite?.doc ?? ''} onChange={(e) => onChange(e.target.value ? { doc: e.target.value } : null)}>
        <option value="">None</option>
        {docs.map((x) => (
          <option key={x.id} value={x.id}>
            {x.title}
          </option>
        ))}
      </select>
      {sprite && <TagPicker sprite={sprite} onChange={onChange} />}
    </label>
  )
}

function TagPicker({ sprite, onChange }: { sprite: SpriteRef; onChange(s: SpriteRef): void }) {
  const tags = useDocument<PixelDoc>('pixel-art', sprite.doc, createPixelDoc).data?.tags ?? []
  if (!tags.length) return null
  return (
    <select className="input" value={sprite.tag ?? ''} title="Which animation plays" onChange={(e) => onChange({ doc: sprite.doc, ...(e.target.value ? { tag: e.target.value } : {}) })}>
      <option value="">All frames</option>
      {tags.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  )
}
