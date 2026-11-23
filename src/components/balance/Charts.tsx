import { useState } from 'react'
import { ticks } from '@/shared/calculators'
import { formatNumber } from '@/shared/formulas'
import type { StripRow } from './model'

const W = 640
const ROW = 38
const PAD = { left: 110, right: 18, top: 10, bottom: 26 }

/**
 * Dot chart for "Numbers that stick out": one row per group (rarity, kind), one dot per entry, a bar at the
 * typical value. Too high is red, too low is accent, like the table. Click a dot to open it.
 */
export function StripChart({ rows, colors, onOpen, label }: { rows: StripRow[]; colors?: Record<string, string>; onOpen?: (id: string) => void; label: string }) {
  const [hover, setHover] = useState<string | null>(null)
  const all = rows.flatMap((r) => r.dots.map((d) => d.value))
  if (!all.length) return null
  let lo = Math.min(0, ...all)
  let hi = Math.max(...all)
  if (hi === lo) hi = lo + 1
  const pad = (hi - lo) * 0.04
  lo = lo < 0 ? lo - pad : lo
  hi += pad
  const H = PAD.top + rows.length * ROW + PAD.bottom
  const px = (v: number) => PAD.left + ((v - lo) / (hi - lo)) * (W - PAD.left - PAD.right)
  const hovered = rows.flatMap((r) => r.dots).find((d) => d.id === hover)

  return (
    <div className="calc-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {ticks(lo, hi, 6).map((t) => (
          <g key={t}>
            <line className="calc-chart-grid" x1={px(t)} x2={px(t)} y1={PAD.top} y2={H - PAD.bottom} />
            <text className="calc-chart-tick" x={px(t)} y={H - 8} textAnchor="middle">
              {formatNumber(t, 2)}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y = PAD.top + i * ROW + ROW / 2
          return (
            <g key={r.group}>
              <text className="bal-chart-label" x={PAD.left - 10} y={y + 4} textAnchor="end" fill={colors?.[r.group] ?? 'var(--text)'}>
                {r.group.length > 14 ? `${r.group.slice(0, 13)}…` : r.group}
              </text>
              <line className="bal-chart-lane" x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} />
              <rect className="bal-chart-median" x={px(r.median) - 1.5} y={y - 12} width={3} height={24} rx={1.5} />
              {r.dots.map((d, j) => {
                // Small fixed up/down offset so equal values do not hide each other.
                const dy = ((j % 3) - 1) * 6
                return (
                  <circle
                    key={d.id}
                    className={`bal-dot ${d.flag ? `bal-dot-${d.flag}` : ''} ${hover === d.id ? 'is-hover' : ''}`}
                    cx={px(d.value)}
                    cy={y + dy}
                    r={d.flag ? 6.5 : 4.5}
                    style={!d.flag && colors?.[r.group] ? { fill: colors[r.group] } : undefined}
                    onMouseEnter={() => setHover(d.id)}
                    onClick={onOpen ? () => onOpen(d.id) : undefined}
                  >
                    <title>{`${d.name}: ${formatNumber(d.value, 2)}`}</title>
                  </circle>
                )
              })}
            </g>
          )
        })}
      </svg>
      <div className="calc-chart-legend">
        {hovered && (
          <span className="calc-chart-hover">
            {hovered.name}: {formatNumber(hovered.value, 2)}
          </span>
        )}
      </div>
    </div>
  )
}

/** Filled bars for the Gaps section: how much of a list is done. */
export function CoverageBars({ rows }: { rows: { label: string; have: number; total: number; hint?: string }[] }) {
  return (
    <div className="bal-bars">
      {rows.map((r) => {
        const pct = r.total ? Math.round((r.have / r.total) * 100) : 0
        return (
          <div key={r.label} className="bal-bar" title={r.hint}>
            <span>{r.label}</span>
            <div className="bal-bar-track" role="progressbar" aria-label={r.label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <div className={`bal-bar-fill ${pct === 100 ? 'is-full' : ''}`} style={{ width: `${pct}%` }} />
            </div>
            <b>
              {r.have} / {r.total}
            </b>
          </div>
        )
      })}
    </div>
  )
}
