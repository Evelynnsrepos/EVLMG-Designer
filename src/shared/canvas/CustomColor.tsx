import { Palette } from 'lucide-react'
import { useRef, useState } from 'react'
import { ColorPanel } from '@/shared/sketch/ColorPanel'

/**
 * Any colour for a board (v0.17): Draw's colour wheel with its recent colours and saved palettes,
 * in a small window above the toolbar button.
 */
export function CustomColor({ value, onPick }: { value: string | null; onPick(c: string): void }) {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const r = btn.current?.getBoundingClientRect()
  return (
    <>
      <button ref={btn} className="canvas-toolbar-btn custom-color-btn" title="Any colour: colour wheel and saved colours" aria-label="Any colour" onClick={() => setOpen(!open)}>
        <Palette size={16} strokeWidth={1.8} />
        {value && <span className="custom-color-dot" style={{ background: value }} />}
      </button>
      {open && r && (
        <>
          <div className="menu-backdrop" onClick={() => setOpen(false)} />
          <div className="custom-color-pop" style={{ left: Math.max(8, Math.min(r.left - 120, window.innerWidth - 300)), bottom: window.innerHeight - r.top + 8 }} onPointerDown={(e) => e.stopPropagation()}>
            <ColorPanel color={value ?? '#3e8ef7'} setColor={onPick} swatches={[]} />
          </div>
        </>
      )}
    </>
  )
}

/** A soft version of a colour (for sticky notes): mixed halfway towards white. */
export function softColor(hex: string): string {
  const n = parseInt(hex.slice(1, 7), 16)
  const mix = (v: number) => Math.round(v + (255 - v) * 0.55)
  return `#${((1 << 24) | (mix((n >> 16) & 255) << 16) | (mix((n >> 8) & 255) << 8) | mix(n & 255)).toString(16).slice(1)}`
}
