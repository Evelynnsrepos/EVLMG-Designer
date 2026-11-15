import { useEffect, useState } from 'react'
import { onWriting } from '@/core/state'

/**
 * 0.31: a thin bar along the bottom of a tool's top bar while files are being written: it grows during the save
 * and fades when done. Screen readers hear "Saved".
 */
export function SaveBar() {
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
      <span className={`save-bar is-${state}`} aria-hidden />
      <span className="sr-only" aria-live="polite">
        {state === 'done' ? 'Saved' : ''}
      </span>
    </>
  )
}
