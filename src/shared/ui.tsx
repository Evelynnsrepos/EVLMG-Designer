import { useEffect, useState, type ReactNode } from 'react'
import { useDialogs } from './dialogs'
import './ui.css'

/** Small shared UI primitives. Feature modules should reuse these instead of restyling. */

export function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as Element | null)?.closest?.('[data-key-capture]')) {
        e.preventDefault() // keep Esc from toggling Layout Mode (ED-7)
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  )
}

/** Image or the pink/black missing-texture placeholder (IT-2). */
export function PlaceholderImage({ src, alt, size = 64 }: { src?: string | null; alt: string; size?: number }) {
  const style = { width: size, height: size, borderRadius: 6, objectFit: 'cover' as const, flex: 'none' }
  return src ? <img src={src} alt={alt} style={style} /> : <div className="placeholder-image" style={style} aria-label={`${alt} (no image)`} />
}

/** Mount once at the app root; shows dialogs requested via shared/dialogs.ts. */
export function DialogHost() {
  const { current, seq } = useDialogs()
  if (!current) return null
  const close = (result: boolean | string | null) => {
    useDialogs.setState({ current: null })
    ;(current.resolve as (v: unknown) => void)(result)
  }

  if (current.kind === 'confirm') {
    return (
      <Modal onClose={() => close(false)}>
        <h3>{current.title}</h3>
        <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-muted)' }}>{current.message}</div>
        <div className="modal-actions">
          <button className="btn" onClick={() => close(false)}>
            Cancel
          </button>
          <button className={current.danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={() => close(true)} autoFocus>
            {current.confirmLabel}
          </button>
        </div>
      </Modal>
    )
  }
  return <PromptForm key={seq} title={current.title} initial={current.initial} onClose={close} />
}

function PromptForm({ title, initial, onClose }: { title: string; initial: string; onClose: (v: string | null) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <Modal onClose={() => onClose(null)}>
      <form
        style={{ display: 'grid', gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault()
          onClose(value)
        }}
      >
        <h3>{title}</h3>
        <input className="input" autoFocus onFocus={(e) => e.target.select()} value={value} onChange={(e) => setValue(e.target.value)} />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => onClose(null)}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            OK
          </button>
        </div>
      </form>
    </Modal>
  )
}
