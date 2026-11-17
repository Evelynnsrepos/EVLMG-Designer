import { useEffect, useRef, useState } from 'react'
import { localPresence, setPresence, usePresence, type DrawingHold, type RemotePresence } from '@/core/collab'

/** Holder idle this long: Take over works at once instead of asking. */
export const IDLE_TAKEOVER_MS = 5 * 60 * 1000

export interface Holder {
  clientId: number
  name: string
  color: string
  hold: DrawingHold
}

/** Who draws on `key` right now: the earliest hold wins, ties go to the lower id. `me` holds only when its hold is for `key`. */
export function holderOf(key: string, me: { clientId: number; hold: DrawingHold | null }, remotes: RemotePresence[]): Holder | null {
  const all: Holder[] = remotes.filter((r) => r.drawing?.key === key).map((r) => ({ clientId: r.clientId, name: r.name, color: r.color, hold: r.drawing! }))
  if (me.hold?.key === key) all.push({ clientId: me.clientId, name: '', color: '', hold: me.hold })
  all.sort((a, b) => a.hold.since - b.hold.since || a.clientId - b.clientId)
  return all[0] ?? null
}

export interface DrawLock {
  /** A teammate draws here: this device only watches. */
  viewOnly: boolean
  holder: Holder | null
  /** Teammates asking this device (the holder) to let them draw. */
  askers: RemotePresence[]
  /** This device asked and waits. */
  asked: boolean
  takeOver(): void
  letGo(): Promise<void>
  /** Call on the holder's pen activity, so Take over knows it isn't idle. */
  touch(): void
}

/**
 * One artist at a time per drawing in shared projects (pro fixes step 7). Uses presence only, so nothing is saved
 * and older app versions simply ignore it. Not shared: never view-only.
 */
export function useDrawLock(key: string, beforeLetGo: () => Promise<void>): DrawLock {
  const remotes = usePresence((s) => s.remotes)
  const [, rerender] = useState(0)
  const [asked, setAsked] = useState(false)
  const mounted = useRef(true)
  const me = localPresence()
  const hold = (h: DrawingHold | null) => {
    setPresence('drawing', h)
    rerender((n) => n + 1)
  }
  const holder = me ? holderOf(key, { clientId: me.clientId, hold: me.drawing }, remotes) : null
  const mine = !!me && holder?.clientId === me.clientId

  useEffect(() => {
    if (!me) return
    // Claim when nobody draws here: on opening, or when the holder let go after this device asked.
    if (!holder && (mounted.current || asked)) {
      const now = Date.now()
      hold({ key, since: now, lastStroke: now })
      setPresence('drawRequest', null)
      setAsked(false)
    }
    mounted.current = false
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- runs when who holds the drawing changes
  }, [me?.clientId, holder?.clientId, asked, key])
  useEffect(
    () => () => {
      if (localPresence()?.drawing?.key === key) setPresence('drawing', null)
      setPresence('drawRequest', null)
    },
    [key],
  )
  // A hold of another drawing (this device switched documents) is dropped by the cleanup above.

  return {
    viewOnly: !!me && !!holder && !mine,
    holder,
    askers: mine ? remotes.filter((r) => r.drawRequest?.key === key) : [],
    asked,
    takeOver() {
      if (!holder || mine) return
      const now = Date.now()
      if (now - holder.hold.lastStroke >= IDLE_TAKEOVER_MS) {
        // Earlier than the idle holder: it becomes the viewer.
        hold({ key, since: holder.hold.since - 1, lastStroke: now })
      } else {
        setAsked(true)
        setPresence('drawRequest', { key, at: now })
      }
    },
    async letGo() {
      if (!mine) return
      await beforeLetGo()
      hold(null)
    },
    touch() {
      const h = localPresence()?.drawing
      if (h?.key === key && Date.now() - h.lastStroke > 10_000) setPresence('drawing', { ...h, lastStroke: Date.now() })
    },
  }
}
