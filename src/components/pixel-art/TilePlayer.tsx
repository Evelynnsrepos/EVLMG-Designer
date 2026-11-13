import { useEffect, useMemo, useRef, useState } from 'react'
import { emptyImg, tilePixels, type Img } from '@/shared/pixel/model'
import { drawSharp } from './Panels'

/** A tileset played as an animation: one frame per tile, in order (empty tiles skipped). */
export function TilePlayer({ set, cols, count, ts }: { set: Img; cols: number; count: number; ts: number }) {
  const [ms, setMs] = useState(120)
  const [from, setFrom] = useState(0)
  const [to, setTo] = useState(count - 1)
  const [i, setI] = useState(0)
  const frames = useMemo(() => {
    const out: Img[] = []
    for (let n = Math.max(0, from); n <= Math.min(count - 1, to); n++) {
      const t = tilePixels(set, n, cols, ts)
      if (!emptyImg(t)) out.push(t)
    }
    return out
  }, [set, cols, count, ts, from, to])
  useEffect(() => {
    const t = setTimeout(() => setI((n) => n + 1), ms)
    return () => clearTimeout(t)
  }, [i, ms])
  const ref = useRef<HTMLCanvasElement>(null)
  const img = frames.length ? frames[i % frames.length] : null
  useEffect(() => {
    if (ref.current && img) drawSharp(ref.current, img, Math.max(1, Math.floor(96 / ts)))
  })
  return (
    <div className="px-panel">
      <strong>Tiles as animation</strong>
      {img ? <canvas ref={ref} className="px-preview" style={{ width: Math.max(1, Math.floor(96 / ts)) * ts }} /> : <p className="px-note">Draw some tiles first.</p>}
      <label className="px-row" title="Which tiles play, by the numbers shown on the tiles">
        Tiles <input className="input px-ms" type="number" min={0} max={count - 1} value={from} onChange={(e) => setFrom(Math.max(0, Math.min(count - 1, Number(e.target.value) || 0)))} />–
        <input className="input px-ms" type="number" min={0} max={count - 1} value={to} onChange={(e) => setTo(Math.max(0, Math.min(count - 1, Number(e.target.value) || 0)))} />
      </label>
      <label className="px-row" title="How long each tile shows">
        <input className="input px-ms" type="number" min={20} max={2000} value={ms} onChange={(e) => setMs(Math.max(20, Number(e.target.value) || 120))} /> ms
      </label>
    </div>
  )
}
