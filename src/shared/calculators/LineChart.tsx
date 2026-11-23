import { useMemo, useState, type MouseEvent } from 'react'
import { formatNumber } from '@/shared/formulas'
import { ticks } from './ticks'
import './calculators.css'

export interface ChartSeries {
  name: string
  /** One value per x; null leaves a gap. */
  values: Array<number | null>
}

const COLORS = ['var(--accent)', 'var(--focus)', 'var(--danger)', 'var(--text-muted)']
const W = 640
const H = 260
const PAD = { left: 56, right: 16, top: 14, bottom: 30 }

/**
 * A small dependency-free line chart for the calculators (CA-6, LV-6). Hovering shows the values at the nearest x.
 * Colors come from the theme variables, so both themes work.
 */
export function LineChart({ xs, series, xLabel }: { xs: number[]; series: ChartSeries[]; xLabel: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const { yMin, yMax } = useMemo(() => {
    const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null && Number.isFinite(v))
    if (all.length === 0) return { yMin: 0, yMax: 1 }
    let lo = Math.min(0, ...all)
    let hi = Math.max(...all)
    if (hi === lo) hi = lo + 1
    const pad = (hi - lo) * 0.05
    if (lo < 0) lo -= pad
    hi += pad
    return { yMin: lo, yMax: hi }
  }, [series])

  if (xs.length === 0) return null
  const xMin = xs[0]
  const xMax = xs[xs.length - 1] === xMin ? xMin + 1 : xs[xs.length - 1]
  const px = (x: number) => PAD.left + ((x - xMin) / (xMax - xMin)) * (W - PAD.left - PAD.right)
  const py = (y: number) => PAD.top + (1 - (y - yMin) / (yMax - yMin)) * (H - PAD.top - PAD.bottom)

  const path = (values: Array<number | null>) => {
    let d = ''
    let pen = false
    values.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        pen = false
        return
      }
      d += `${pen ? 'L' : 'M'}${px(xs[i]).toFixed(1)},${py(v).toFixed(1)}`
      pen = true
    })
    return d
  }

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * W
    let best = 0
    xs.forEach((v, i) => {
      if (Math.abs(px(v) - x) < Math.abs(px(xs[best]) - x)) best = i
    })
    setHover(best)
  }

  return (
    <div className="calc-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Chart of ${series.map((s) => s.name).join(', ')} by ${xLabel}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticks(yMin, yMax, 5).map((t) => (
          <g key={`y${t}`}>
            <line className="calc-chart-grid" x1={PAD.left} x2={W - PAD.right} y1={py(t)} y2={py(t)} />
            <text className="calc-chart-tick" x={PAD.left - 6} y={py(t) + 4} textAnchor="end">
              {formatNumber(t, 2)}
            </text>
          </g>
        ))}
        {ticks(xMin, xMax, 8).map((t) => (
          <text key={`x${t}`} className="calc-chart-tick" x={px(t)} y={H - 10} textAnchor="middle">
            {formatNumber(t, 2)}
          </text>
        ))}
        {series.map((s, i) => (
          <path key={s.name} d={path(s.values)} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth={2} />
        ))}
        {hover !== null && (
          <g>
            <line className="calc-chart-cursor" x1={px(xs[hover])} x2={px(xs[hover])} y1={PAD.top} y2={H - PAD.bottom} />
            {series.map((s, i) => {
              const v = s.values[hover]
              return v === null || !Number.isFinite(v) ? null : <circle key={s.name} cx={px(xs[hover])} cy={py(v)} r={3.5} fill={COLORS[i % COLORS.length]} />
            })}
          </g>
        )}
      </svg>
      <div className="calc-chart-legend">
        {hover !== null && (
          <span className="calc-chart-hover">
            {xLabel} {formatNumber(xs[hover], 2)}
          </span>
        )}
        {series.map((s, i) => (
          <span key={s.name}>
            <i style={{ background: COLORS[i % COLORS.length] }} />
            {s.name}
            {hover !== null && s.values[hover] !== null ? `: ${formatNumber(s.values[hover]!, 2)}` : ''}
          </span>
        ))}
      </div>
    </div>
  )
}
