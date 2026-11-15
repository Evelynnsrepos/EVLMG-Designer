/**
 * SVG import: every drawable element becomes an editable point path with its own colours. The browser works out
 * styles and transforms; the shape maths turn arcs, circles and the rest into points.
 */
import type { Id } from '@/shared/canvas'
import { anchorsOf } from './geom'
import type { PathNode } from './model'
import { mapPaths, pathBox, type SubPath } from './paths'
import { pathNode } from './tools'

const r = (v: number) => Math.round(v * 1000) / 1000

/** SVG path data for one basic element, or null for things that aren't shapes. */
export function elementD(el: Element): string | null {
  const n = (a: string) => Number(el.getAttribute(a) ?? 0) || 0
  switch (el.tagName.toLowerCase()) {
    case 'path':
      return el.getAttribute('d')
    case 'rect': {
      const [x, y, w, h] = [n('x'), n('y'), n('width'), n('height')]
      if (w <= 0 || h <= 0) return null
      const rx = Math.min(w / 2, n('rx') || n('ry'))
      const ry = Math.min(h / 2, n('ry') || n('rx'))
      if (!rx) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
    }
    case 'circle':
    case 'ellipse': {
      const [cx, cy] = [n('cx'), n('cy')]
      const rx = el.tagName.toLowerCase() === 'circle' ? n('r') : n('rx')
      const ry = el.tagName.toLowerCase() === 'circle' ? n('r') : n('ry')
      if (rx <= 0 || ry <= 0) return null
      return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 1 ${cx + rx} ${cy}A${rx} ${ry} 0 1 1 ${cx - rx} ${cy}Z`
    }
    case 'line':
      return `M${n('x1')} ${n('y1')}L${n('x2')} ${n('y2')}`
    case 'polygon':
    case 'polyline': {
      const pts = (el.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number)
      if (pts.length < 4) return null
      const pairs = []
      for (let i = 0; i + 1 < pts.length; i += 2) pairs.push(`${pts[i]} ${pts[i + 1]}`)
      return `M${pairs.join('L')}${el.tagName.toLowerCase() === 'polygon' ? 'Z' : ''}`
    }
  }
  return null
}

/** `rgb(1, 2, 3)` / `#abc` / names → #rrggbb, or undefined for none. */
function colour(v: string | null | undefined): string | undefined {
  if (!v || v === 'none' || v.startsWith('url(')) return undefined
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return undefined
  ctx.fillStyle = '#000000'
  ctx.fillStyle = v
  return typeof ctx.fillStyle === 'string' ? ctx.fillStyle : undefined
}

/** Turns an SVG file into point paths that fit inside `fit` (80 % of it, centred). */
export function importSvg(text: string, layerId: Id, fit: { width: number; height: number }): PathNode[] {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  const svg = doc.querySelector('svg')
  if (!svg || doc.querySelector('parsererror')) throw new Error('This file is not an SVG picture.')
  // Styles and transforms are only worked out for an SVG in the page, so add it hidden for a moment.
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none'
  const live = document.importNode(svg, true) as SVGSVGElement
  host.appendChild(live)
  document.body.appendChild(host)
  try {
    const found: { paths: SubPath[]; fill?: string; stroke?: string; strokeWidth: number; opacity: number; evenOdd: boolean; scale: number }[] = []
    for (const el of live.querySelectorAll('path, rect, circle, ellipse, line, polygon, polyline')) {
      if (el.closest('defs, clipPath, mask, symbol, pattern, marker')) continue
      const d = elementD(el)
      const ctm = (el as SVGGraphicsElement).getCTM?.()
      if (!d || !ctm) continue
      const st = getComputedStyle(el)
      if (st.display === 'none' || st.visibility === 'hidden') continue
      let paths: SubPath[]
      try {
        paths = anchorsOf({ d, m: [ctm.a, ctm.b, ctm.c, ctm.d, ctm.e, ctm.f] })?.paths ?? []
      } catch {
        continue
      }
      if (!paths.length) continue
      const fill = colour(st.fill)
      const stroke = colour(st.stroke)
      if (!fill && !stroke) continue
      found.push({ paths, fill, stroke, strokeWidth: parseFloat(st.strokeWidth) || 1, opacity: Number(st.opacity) * Number(st.fillOpacity || 1), evenOdd: st.fillRule === 'evenodd', scale: Math.sqrt(Math.abs(ctm.a * ctm.d - ctm.b * ctm.c)) })
    }
    if (!found.length) throw new Error('No shapes found in this SVG (text and pictures inside it are not imported).')
    const all = pathBox(found.flatMap((f) => f.paths))
    const k = Math.min((fit.width * 0.8) / (all.width || 1), (fit.height * 0.8) / (all.height || 1))
    const ox = (fit.width - all.width * k) / 2
    const oy = (fit.height - all.height * k) / 2
    return found.map((f) =>
      pathNode(layerId, mapPaths(f.paths, ([x, y]) => [r((x - all.x) * k + ox), r((y - all.y) * k + oy)]), {
        name: 'Imported',
        fillColor: f.fill ?? 'transparent',
        ...(f.stroke ? { strokeColor: f.stroke, strokeWidth: Math.max(0.5, f.strokeWidth * f.scale * k) } : { strokeWidth: 0 }),
        ...(f.opacity < 1 ? { opacity: f.opacity } : {}),
        ...(f.evenOdd ? { evenOdd: true } : {}),
      }),
    )
  } finally {
    host.remove()
  }
}
