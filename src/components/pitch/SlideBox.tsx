import type { CSSProperties, ReactNode } from 'react'
import { useAssetUrl } from '@/core/assets'
import { H, paragraphsOf, textStyle, type Obj, type Theme } from './model'

/** 0.35: one slide drawn from its objects at full size (W x 1080), scaled down with CSS. */

export function TextLines({ o }: { o: Obj }) {
  return (
    <>
      {paragraphsOf(o).map((p, i) => (
        <div key={i} className={o.bullets ? 'pi-bullet' : undefined}>
          {p || ' '}
        </div>
      ))}
    </>
  )
}

function ObjImage({ o }: { o: Obj }) {
  const url = useAssetUrl(o.image)
  return url ? <img src={url} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: o.fit ?? 'contain' }} /> : <div className="pi-noimg" />
}

function ShapeSvg({ o }: { o: Obj }) {
  const kind = o.shape ?? 'rect'
  const sw = o.strokeW ?? 4
  const line = kind === 'line' || kind === 'arrow'
  const stroke = sw > 0 && (o.stroke || line) ? (o.stroke ?? '#000000') : 'none'
  const fill = line || o.fill === 'none' ? 'none' : (o.fill ?? '#cccccc')
  const p = { fill, stroke, strokeWidth: sw, vectorEffect: 'non-scaling-stroke' as const }
  const r = Math.min(o.w, o.h) * 0.16
  return (
    <svg className="pi-svg" viewBox={`0 0 ${Math.max(1, o.w)} ${Math.max(1, o.h)}`} preserveAspectRatio="none" overflow="visible">
      {kind === 'rect' && <rect width={o.w} height={o.h} {...p} />}
      {kind === 'round' && <rect width={o.w} height={o.h} rx={r} {...p} />}
      {kind === 'ellipse' && <ellipse cx={o.w / 2} cy={o.h / 2} rx={o.w / 2} ry={o.h / 2} {...p} />}
      {kind === 'triangle' && <polygon points={`${o.w / 2},0 ${o.w},${o.h} 0,${o.h}`} {...p} />}
      {line && <line x1={0} y1={0} x2={o.w} y2={o.h} {...p} />}
      {kind === 'arrow' &&
        (() => {
          const a = Math.atan2(o.h, o.w)
          const len = sw * 5
          return <polygon fill={stroke} points={`${o.w},${o.h} ${o.w - len * Math.cos(a - 0.45)},${o.h - len * Math.sin(a - 0.45)} ${o.w - len * Math.cos(a + 0.45)},${o.h - len * Math.sin(a + 0.45)}`} />
        })()}
    </svg>
  )
}

export function ObjView({ o, theme, className, style, onPointerDown, onDoubleClick, children }: { o: Obj; theme: Theme; className?: string; style?: CSSProperties; onPointerDown?: (e: React.PointerEvent) => void; onDoubleClick?: () => void; children?: ReactNode }) {
  const box: CSSProperties = { left: o.x, top: o.y, width: o.w, height: o.h, transform: o.rot ? `rotate(${o.rot}deg)` : undefined, ...style }
  const hasText = !!o.text && o.kind !== 'image'
  return (
    <div className={`pi-obj pi-k-${o.kind}${className ? ` ${className}` : ''}`} data-build={o.build && o.build !== 'none' ? o.build : undefined} style={box} onPointerDown={onPointerDown} onDoubleClick={onDoubleClick}>
      {o.kind === 'image' && <ObjImage o={o} />}
      {o.kind === 'shape' && <ShapeSvg o={o} />}
      {o.kind === 'text' && o.fill && o.fill !== 'none' && <div className="pi-fill" style={{ background: o.fill, border: o.stroke && (o.strokeW ?? 0) > 0 ? `${o.strokeW}px solid ${o.stroke}` : undefined }} />}
      {hasText && (
        <div className="pi-text" style={textStyle(o, theme, o.kind === 'shape')}>
          <TextLines o={o} />
        </div>
      )}
      {children}
    </div>
  )
}

/** A whole slide at `scale`. `visible` hides objects (builds not reached yet) by id. */
export function SlideBox({ objs, bg, bgImage, width, theme, scale, hiddenIds, className, children }: { objs: Obj[]; bg: string; bgImage?: string | null; width: number; theme: Theme; scale: number; hiddenIds?: Set<string>; className?: string; children?: ReactNode }) {
  const bgUrl = useAssetUrl(bgImage)
  return (
    <div className={`pi-frame${className ? ` ${className}` : ''}`} style={{ width: width * scale, height: H * scale }}>
      <div className="pi-canvas" style={{ width, height: H, transform: `scale(${scale})`, background: bgUrl ? `center / cover no-repeat url("${bgUrl}"), ${bg}` : bg }}>
        {objs.map((o) => (
          <ObjView key={o.id} o={o} theme={theme} className={hiddenIds?.has(o.id) ? 'pi-hidden' : undefined} />
        ))}
        {children}
      </div>
    </div>
  )
}
