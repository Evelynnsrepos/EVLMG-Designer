import { useEffect, useRef, useState } from 'react'
import { H, textStyle, type Obj, type Theme } from './model'
import { ObjView, SlideBox } from './SlideBox'

/**
 * 0.35: the editable slide. Click to select (Shift adds), drag to move with snapping to the
 * slide's centre and edges and to other objects, corner handles resize (Shift keeps the shape),
 * the round handle turns. Double-click a text or shape to type in it.
 */

type Drag =
  | { mode: 'move'; x0: number; y0: number; orig: Obj[] }
  | { mode: 'resize'; corner: 'nw' | 'ne' | 'sw' | 'se'; x0: number; y0: number; orig: Obj[] }
  | { mode: 'rotate'; orig: Obj[] }

const SNAP = 10
const CORNERS = ['nw', 'ne', 'sw', 'se'] as const

export function Stage({
  objs,
  bg,
  bgImage,
  width,
  theme,
  sel,
  setSel,
  onChange,
  onDropFiles,
}: {
  objs: Obj[]
  bg: string
  bgImage?: string | null
  width: number
  theme: Theme
  sel: string[]
  setSel(ids: string[]): void
  /** Commit changed objects (one undo step). */
  onChange(changed: Obj[]): void
  onDropFiles(dt: DataTransfer, x: number, y: number): void
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.4)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [live, setLive] = useState<Obj[] | null>(null)
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] })
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setScale(Math.max(0.05, Math.min((el.clientWidth - 32) / width, (el.clientHeight - 32) / H))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [width])

  const shown = live ? objs.map((o) => live.find((l) => l.id === o.id) ?? o) : objs
  const toSlide = (e: { clientX: number; clientY: number }) => {
    const r = wrap.current!.querySelector('.pi-canvas')!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }
  }

  const begin = (e: React.PointerEvent, o: Obj) => {
    if (o.fromLayout || e.button !== 0) return
    e.stopPropagation()
    const ids = e.shiftKey ? (sel.includes(o.id) ? sel.filter((x) => x !== o.id) : [...sel, o.id]) : sel.includes(o.id) ? sel : [o.id]
    setSel(ids)
    if (o.locked || editing) return
    const p = toSlide(e)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ mode: 'move', x0: p.x, y0: p.y, orig: objs.filter((x) => ids.includes(x.id) && !x.locked) })
  }

  const onMove = (e: React.PointerEvent) => {
    if (!drag) return
    const p = toSlide(e)
    if (drag.mode === 'move') {
      let dx = p.x - drag.x0
      let dy = p.y - drag.y0
      // Snap the group's box edges and centre to the slide and to the other objects.
      const minX = Math.min(...drag.orig.map((o) => o.x)) + dx
      const maxX = Math.max(...drag.orig.map((o) => o.x + o.w)) + dx
      const minY = Math.min(...drag.orig.map((o) => o.y)) + dy
      const maxY = Math.max(...drag.orig.map((o) => o.y + o.h)) + dy
      const others = objs.filter((o) => !drag.orig.some((d) => d.id === o.id))
      const tx = [0, width / 2, width, ...others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])]
      const ty = [0, H / 2, H, ...others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])]
      const snap = (edges: number[], targets: number[]) => {
        let best: { d: number; t: number } | null = null
        for (const v of edges) for (const t of targets) if (Math.abs(t - v) < SNAP / scale / 2.5 && (!best || Math.abs(t - v) < Math.abs(best.d))) best = { d: t - v, t }
        return best
      }
      const sx = e.altKey ? null : snap([minX, (minX + maxX) / 2, maxX], tx)
      const sy = e.altKey ? null : snap([minY, (minY + maxY) / 2, maxY], ty)
      if (sx) dx += sx.d
      if (sy) dy += sy.d
      setGuides({ x: sx ? [sx.t] : [], y: sy ? [sy.t] : [] })
      setLive(drag.orig.map((o) => ({ ...o, x: Math.round(o.x + dx), y: Math.round(o.y + dy) })))
    } else if (drag.mode === 'resize') {
      const o = drag.orig[0]
      const dx = p.x - drag.x0
      const dy = p.y - drag.y0
      let { x, y, w, h } = o
      if (drag.corner.includes('e')) w = o.w + dx
      if (drag.corner.includes('s')) h = o.h + dy
      if (drag.corner.includes('w')) w = o.w - dx
      if (drag.corner.includes('n')) h = o.h - dy
      if (e.shiftKey && o.w && o.h) {
        const k = Math.max(w / o.w, h / o.h)
        w = o.w * k
        h = o.h * k
      }
      const line = o.shape === 'line' || o.shape === 'arrow'
      if (!line) {
        w = Math.max(10, w)
        h = Math.max(10, h)
      }
      if (drag.corner.includes('w')) x = o.x + o.w - w
      if (drag.corner.includes('n')) y = o.y + o.h - h
      setLive([{ ...o, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }])
    } else {
      const o = drag.orig[0]
      let deg = (Math.atan2(p.y - (o.y + o.h / 2), p.x - (o.x + o.w / 2)) * 180) / Math.PI + 90
      deg = e.shiftKey ? deg : Math.round(deg / 15) * 15
      setLive([{ ...o, rot: ((Math.round(deg) % 360) + 360) % 360 }])
    }
  }

  const end = () => {
    if (live && drag) onChange(live)
    setDrag(null)
    setLive(null)
    setGuides({ x: [], y: [] })
  }

  const startEdit = (o: Obj) => {
    if (o.fromLayout || o.kind === 'image' || o.locked) return
    setEditing(o.id)
    setDraft(o.text ?? '')
  }
  const commitEdit = () => {
    const o = objs.find((x) => x.id === editing)
    if (o && draft !== (o.text ?? '')) onChange([{ ...o, text: draft }])
    setEditing(null)
  }

  const one = sel.length === 1 ? shown.find((o) => o.id === sel[0]) : undefined
  const editObj = editing ? shown.find((o) => o.id === editing) : undefined

  return (
    <div
      ref={wrap}
      className="pi-stage"
      onPointerDown={() => {
        if (editing) commitEdit()
        setSel([])
      }}
      onPointerMove={onMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const p = toSlide(e)
        onDropFiles(e.dataTransfer, p.x, p.y)
      }}
    >
      <SlideBox objs={[]} bg={bg} bgImage={bgImage} width={width} theme={theme} scale={scale} className="pi-edit">
        {shown.map((o) =>
          o.id === editing ? null : (
            <ObjView
              key={o.id}
              o={o}
              theme={theme}
              className={`${o.fromLayout ? 'pi-layout' : 'pi-free'}${sel.includes(o.id) ? ' on' : ''}${o.locked ? ' locked' : ''}`}
              onPointerDown={(e) => begin(e, o)}
              onDoubleClick={() => startEdit(o)}
            />
          ),
        )}
        {editObj && (
          <textarea
            className="pi-inline"
            autoFocus
            value={draft}
            style={{ left: editObj.x, top: editObj.y, width: editObj.w, minHeight: editObj.h, transform: editObj.rot ? `rotate(${editObj.rot}deg)` : undefined, ...textStyle(editObj, theme) }}
            onChange={(e) => setDraft(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') {
                e.preventDefault()
                setEditing(null)
              }
            }}
          />
        )}
        {one && !one.locked && !editing && (
          <div className="pi-handles" style={{ left: one.x, top: one.y, width: one.w, height: one.h, transform: one.rot ? `rotate(${one.rot}deg)` : undefined, ['--k' as string]: 1 / scale }}>
            {CORNERS.map((c) => (
              <span
                key={c}
                className={`pi-h pi-h-${c}`}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                  const p = toSlide(e)
                  setDrag({ mode: 'resize', corner: c, x0: p.x, y0: p.y, orig: [one] })
                }}
              />
            ))}
            <span
              className="pi-h pi-h-rot"
              title="Turn (Shift: free, otherwise 15° steps)"
              onPointerDown={(e) => {
                e.stopPropagation()
                ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                setDrag({ mode: 'rotate', orig: [one] })
              }}
            />
          </div>
        )}
        {guides.x.map((x) => (
          <div key={`x${x}`} className="pi-guide v" style={{ left: x, ['--k' as string]: 1 / scale }} />
        ))}
        {guides.y.map((y) => (
          <div key={`y${y}`} className="pi-guide h" style={{ top: y, ['--k' as string]: 1 / scale }} />
        ))}
      </SlideBox>
    </div>
  )
}
