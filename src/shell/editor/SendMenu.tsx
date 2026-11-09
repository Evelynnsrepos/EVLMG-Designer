import { Send } from 'lucide-react'
import { useState } from 'react'
import type { ComponentType } from '@/core/model'
import { IMAGE_TARGETS, sendImageTo } from './actions'
import './send-menu.css'

/**
 * "Send to…" for any tool that makes a picture (v0.5 in Draw, shared since v0.26 with Texture Paint and the
 * Card Designer). `picture` is called only when a target is picked.
 */
export function SendMenu({ title, picture, label = 'Send to…', skip = [] }: { title: string; picture: () => Promise<Blob | null>; label?: string; skip?: ComponentType[] }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  return (
    <span className="sketch-send">
      <button className="btn btn-ghost sketch-send-btn" title={label} onClick={() => setOpen(!open)}>
        <Send size={15} /> {label}
      </button>
      {open && (
        <div className="menu" style={{ top: '100%', left: 0 }} onMouseLeave={() => setOpen(false)}>
          {IMAGE_TARGETS.filter((t) => !skip.includes(t.type)).map((t) => (
            <button
              key={t.type}
              onClick={async () => {
                setOpen(false)
                const blob = await picture()
                if (!blob) return
                await sendImageTo(t.type, blob, title)
                setNote(`Sent to ${t.label}`)
                setTimeout(() => setNote(null), 3000)
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {note && <span className="sketch-send-note">{note}</span>}
    </span>
  )
}
