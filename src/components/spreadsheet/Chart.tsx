import { Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Chart, ChartType } from './model'
import { CHART_COLORS as COLORS, type ChartData } from './chartData'
import { zoomOf } from '@/shared/zoom'

function ChartSvg({ data, type, w, h }: { data: ChartData; type: ChartType; w: number; h: number }) {
  const pad = { l: 40, r: 10, t: 10, b: 34 }
  const iw = Math.max(10, w - pad.l - pad.r)
  const ih = Math.max(10, h - pad.t - pad.b)
  const all = data.series.flatMap((s) => s.values)
  if (!all.length) return <text x={w / 2} y={h / 2} textAnchor="middle" className="ss-chart-axis">No numbers in the range</text>

  if (type === 'pie') {
    const values = data.series[0]?.values.map((v) => Math.max(0, v)) ?? []
    const total = values.reduce((a, b) => a + b, 0) || 1
    const r = Math.min(w - 120, h) / 2 - 8
    const cx = r + 10
    const cy = h / 2
    const starts = values.map((_, i) => -Math.PI / 2 + (values.slice(0, i).reduce((x, y) => x + y, 0) / total) * Math.PI * 2)
    return (
      <>
        {values.map((v, i) => {
          const span = (v / total) * Math.PI * 2
          const a = starts[i]
          const a2 = a + span
          const large = span > Math.PI ? 1 : 0
          const d = span >= Math.PI * 2 - 1e-6 ? `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0` : `M ${cx} ${cy} L ${cx + Math.cos(a) * r} ${cy + Math.sin(a) * r} A ${r} ${r} 0 ${large} 1 ${cx + Math.cos(a2) * r} ${cy + Math.sin(a2) * r} Z`
          return <path key={i} d={d} fill={COLORS[i % COLORS.length]} stroke="var(--bg-elevated)" strokeWidth={1} />
        })}
        {data.labels.slice(0, 10).map((l, i) => (
          <g key={i} transform={`translate(${cx + r + 14} ${12 + i * 16})`}>
            <rect width={10} height={10} fill={COLORS[i % COLORS.length]} />
            <text x={14} y={9} className="ss-chart-axis">
              {l.slice(0, 14)}
            </text>
          </g>
        ))}
      </>
    )
  }

  const max = Math.max(0, ...all)
  const min = Math.min(0, ...all)
  const span = max - min || 1
  const y = (v: number) => pad.t + ih - ((v - min) / span) * ih
  const n = data.labels.length
  const ticks = [min, min + span / 2, max]
  const fmt = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : String(Math.round(v * 100) / 100))
  return (
    <>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={pad.l} x2={pad.l + iw} y1={y(t)} y2={y(t)} className="ss-chart-grid" />
          <text x={pad.l - 4} y={y(t) + 4} textAnchor="end" className="ss-chart-axis">
            {fmt(t)}
          </text>
        </g>
      ))}
      {data.labels.map((l, i) => {
        const step = Math.ceil(n / Math.max(1, Math.floor(iw / 50)))
        return i % step ? null : (
          <text key={i} x={pad.l + (type === 'bar' ? (i + 0.5) * (iw / n) : n > 1 ? (i / (n - 1)) * iw : iw / 2)} y={pad.t + ih + 14} textAnchor="middle" className="ss-chart-axis">
            {l.slice(0, 8)}
          </text>
        )
      })}
      {type === 'bar'
        ? data.series.map((s, si) =>
            s.values.map((v, i) => {
              const group = iw / n
              const bw = (group * 0.8) / data.series.length
              const x = pad.l + i * group + group * 0.1 + si * bw
              return <rect key={`${si}-${i}`} x={x} y={Math.min(y(v), y(0))} width={Math.max(1, bw - 1)} height={Math.abs(y(v) - y(0))} fill={COLORS[si % COLORS.length]} />
            }),
          )
        : data.series.map((s, si) => (
            <polyline
              key={si}
              fill="none"
              stroke={COLORS[si % COLORS.length]}
              strokeWidth={2}
              points={s.values.map((v, i) => `${pad.l + (n > 1 ? (i / (n - 1)) * iw : iw / 2)},${y(v)}`).join(' ')}
            />
          ))}
      {data.series.length > 1 &&
        data.series.map((s, si) => (
          <g key={si} transform={`translate(${pad.l + si * 90} ${h - 10})`}>
            <rect width={10} height={4} y={-4} fill={COLORS[si % COLORS.length]} />
            <text x={14} className="ss-chart-axis">
              {s.name.slice(0, 10)}
            </text>
          </g>
        ))}
    </>
  )
}

/** A chart floating over the grid: drag its title to move it, the corner to resize. */
export function ChartBox({ chart, data, onChange, onRemove, onRename }: { chart: Chart; data: ChartData; onChange(patch: Partial<Chart>): void; onRemove(): void; onRename(): void }) {
  const [live, setLiveState] = useState<Partial<Chart> | null>(null)
  const liveRef = useRef<Partial<Chart> | null>(null)
  const setLive = (l: Partial<Chart> | null) => {
    liveRef.current = l
    setLiveState(l)
  }
  const changeRef = useRef(onChange)
  useEffect(() => {
    changeRef.current = onChange
  })
  const [drag, setDrag] = useState<{ kind: 'move' | 'size'; x: number; y: number; start: Chart } | null>(null)
  const c = { ...chart, ...live }
  useEffect(() => {
    if (!drag) return
    const move = (e: MouseEvent) => {
      const z = zoomOf(document.elementFromPoint(drag.x, drag.y))
      const dx = (e.clientX - drag.x) / z
      const dy = (e.clientY - drag.y) / z
      setLive(drag.kind === 'move' ? { x: Math.max(0, drag.start.x + dx), y: Math.max(0, drag.start.y + dy) } : { w: Math.max(200, drag.start.w + dx), h: Math.max(140, drag.start.h + dy) })
    }
    const up = () => {
      setDrag(null)
      if (liveRef.current) changeRef.current(liveRef.current)
      setLive(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [drag])

  return (
    <div className="ss-chart" style={{ left: c.x, top: c.y, width: c.w, height: c.h }} onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div className="ss-chart-head" onMouseDown={(e) => e.target === e.currentTarget && setDrag({ kind: 'move', x: e.clientX, y: e.clientY, start: chart })}>
        <span className="ss-chart-title" title="Double-click to rename" onDoubleClick={onRename}>
          {c.title || c.range}
        </span>
        <select className="input ss-select" value={c.type} onChange={(e) => onChange({ type: e.target.value as ChartType })}>
          <option value="bar">Bars</option>
          <option value="line">Lines</option>
          <option value="pie">Pie</option>
        </select>
        <button className="icon-btn" title="Delete chart" aria-label="Delete chart" onClick={onRemove}>
          <Trash2 size={13} />
        </button>
      </div>
      <svg width={c.w} height={c.h - 30}>
        <ChartSvg data={data} type={c.type} w={c.w} h={c.h - 30} />
      </svg>
      <div className="ss-chart-size" onMouseDown={(e) => setDrag({ kind: 'size', x: e.clientX, y: e.clientY, start: chart })} />
    </div>
  )
}
