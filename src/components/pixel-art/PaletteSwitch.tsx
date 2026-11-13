import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '@/shared/ui'
import { toCanvas } from '@/shared/pixel/codec'
import { nearest, swapColors } from '@/shared/pixel/color'
import type { Img } from '@/shared/pixel/model'

const UI = {
  title: (name: string) => `Open ${name}`,
  intro: 'You have already drawn with your own colours. What should happen to them?',
  add: 'Add my colours to it',
  addHelp: 'The new palette, plus every colour your drawing uses. Your pixels stay as they are.',
  replace: 'Swap my colours for the new ones',
  replaceHelp: 'Connect each of your colours (left) to a new colour (right): drag a cable, or click one and then the other. The preview shows the result.',
  before: 'Now',
  after: 'After',
  apply: 'Swap the colours',
  cancel: 'Cancel',
}

const ROW = 26

/** Opening a palette over a drawing: keep the drawn colours, or connect each one to a new colour with a preview. */
export function PaletteSwitch({ name, used, next, preview, onAdd, onReplace, onClose }: { name: string; used: string[]; next: string[]; preview: Img; onAdd(): void; onReplace(map: Record<string, string>): void; onClose(): void }) {
  const [mode, setMode] = useState<'choose' | 'connect'>('choose')
  const [map, setMap] = useState<Record<string, string>>(() => Object.fromEntries(used.map((c) => [c, nearest(next, c)])))
  const [drag, setDrag] = useState<{ from: string; x: number; y: number } | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const before = useRef<HTMLCanvasElement>(null)
  const after = useRef<HTMLCanvasElement>(null)
  const swapped = useMemo(() => swapColors(preview, used, used.map((c) => map[c] ?? c)), [preview, used, map])
  useEffect(() => {
    for (const [ref, img] of [[before, preview], [after, swapped]] as const) {
      const c = ref.current
      if (!c) continue
      // Scaled in code with hard pixels (CSS scaling blurs in some web views).
      const k = Math.max(1, Math.floor(160 / Math.max(img.width, img.height)))
      ;[c.width, c.height] = [img.width * k, img.height * k]
      const g = c.getContext('2d')!
      g.imageSmoothingEnabled = false
      g.drawImage(toCanvas(img), 0, 0, img.width * k, img.height * k)
    }
  }, [preview, swapped, mode])

  const H = Math.max(used.length, next.length) * ROW + 8
  const W = 300
  const leftY = (i: number) => 4 + i * ROW + ROW / 2
  const rightY = (c: string) => 4 + next.indexOf(c) * ROW + ROW / 2
  const link = (from: string, to: string) => {
    setMap((m) => ({ ...m, [from]: to }))
    setPicked(null)
  }
  const cable = (y1: number, x2: number, y2: number, color: string, key: string) => (
    <g key={key}>
      <path d={`M 34 ${y1} C ${(34 + x2) / 2} ${y1}, ${(34 + x2) / 2} ${y2}, ${x2} ${y2}`} stroke="#000" strokeOpacity={0.45} strokeWidth={7} fill="none" />
      <path d={`M 34 ${y1} C ${(34 + x2) / 2} ${y1}, ${(34 + x2) / 2} ${y2}, ${x2} ${y2}`} stroke={color} strokeWidth={4.5} fill="none" strokeLinecap="round" />
    </g>
  )
  const local = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  return (
    <Modal onClose={onClose}>
      <h2>{UI.title(name)}</h2>
      {mode === 'choose' ? (
        <>
          <p>{UI.intro}</p>
          <div className="px-switch-choices">
            <button className="btn" onClick={onAdd}>
              {UI.add}
            </button>
            <p className="input-help">{UI.addHelp}</p>
            <button className="btn" onClick={() => setMode('connect')}>
              {UI.replace}
            </button>
            <p className="input-help">{UI.replaceHelp}</p>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose}>
              {UI.cancel}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="input-help">{UI.replaceHelp}</p>
          <div className="px-switch">
            <div
              ref={box}
              className="px-switch-graph"
              style={{ height: H, width: W }}
              onPointerMove={(e) => drag && setDrag({ ...drag, ...local(e) })}
              onPointerUp={() => setDrag(null)}
            >
              <svg width={W} height={H} className="px-switch-cables">
                {used.map((c, i) => map[c] && next.includes(map[c]) && cable(leftY(i), W - 34, rightY(map[c]), c, c))}
                {drag && cable(leftY(used.indexOf(drag.from)), drag.x, drag.y, drag.from, 'drag')}
              </svg>
              {used.map((c, i) => (
                <button
                  key={c}
                  className={`px-plug left${picked === c ? ' on' : ''}`}
                  style={{ top: 4 + i * ROW, background: c }}
                  title={`${c}: drag to a new colour`}
                  onPointerDown={(e) => {
                    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
                    setPicked(c)
                    setDrag({ from: c, ...local(e) })
                  }}
                />
              ))}
              {next.map((c, i) => (
                <button
                  key={`${c}${i}`}
                  className="px-plug right"
                  style={{ top: 4 + i * ROW, background: c }}
                  title={c}
                  onPointerUp={() => {
                    const from = drag?.from ?? picked
                    setDrag(null)
                    if (from) link(from, c)
                  }}
                />
              ))}
            </div>
            <div className="px-switch-preview">
              <span>{UI.before}</span>
              <canvas ref={before} />
              <span>{UI.after}</span>
              <canvas ref={after} />
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose}>
              {UI.cancel}
            </button>
            <button className="btn" onClick={() => onReplace(map)}>
              {UI.apply}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
