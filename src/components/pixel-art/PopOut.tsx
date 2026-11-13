import { Maximize2, Minimize2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { FloatingPanel, useSpot } from '@/shared/sketch/FloatingPanel'

/** A side panel that can pop out and float over the canvas (Palette, Layers); where it is is remembered in this browser. */
export function PopOut({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const key = `egd.pixel.popout.${id}`
  const [out, setOutState] = useState(() => {
    try {
      return localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })
  const setOut = (v: boolean) => {
    setOutState(v)
    try {
      localStorage.setItem(key, v ? '1' : '0')
    } catch {
      // Only a convenience.
    }
  }
  const [spot, setSpot] = useSpot(`${key}.spot`, () => ({ x: Math.max(0, window.innerWidth - 620), y: 120 }))
  if (out)
    return (
      <>
        <button className="btn btn-ghost px-popped" title={`Put ${title} back here`} onClick={() => setOut(false)}>
          <Minimize2 size={13} /> {title} is floating
        </button>
        <FloatingPanel title={title} at={spot} onMove={setSpot} onClose={() => setOut(false)} width={280}>
          {children}
        </FloatingPanel>
      </>
    )
  return (
    <div className="px-popout">
      <button className="icon-btn px-popout-btn" title={`Pop ${title} out to float over the canvas`} onClick={() => setOut(true)}>
        <Maximize2 size={13} />
      </button>
      {children}
    </div>
  )
}
