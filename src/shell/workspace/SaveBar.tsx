import { useEffect, useState } from 'react'
import { onWriting } from '@/core/state'

/**
 * 0.31: while files are being written, a thin bar along the bottom of a tool's top bar that grows and fades when
 * done, or (`dot`) a tiny dot in its corner that swells and shrinks. Screen readers hear "Saved".
 */
export function SaveBar({ dot = false }: { dot?: boolean }) {
  const [state, setState] = useState<'idle' | 'saving' | 'done'>('idle')
  useEffect(() => {
    let fade: ReturnType<typeof setTimeout> | undefined
    const off = onWriting((on) => {
      clearTimeout(fade)
      if (on) return setState('saving')
      setState('done')
      fade = setTimeout(() => setState('idle'), 700)
    })
    return () => (off(), clearTimeout(fade))
  }, [])
  return (
    <>
      <span className={`${dot ? 'save-dot' : 'save-bar'} is-${state}`} aria-hidden />
      <span className="sr-only" aria-live="polite">
        {state === 'done' ? 'Saved' : ''}
      </span>
    </>
  )
}
