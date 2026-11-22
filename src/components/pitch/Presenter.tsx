import { useEffect, useMemo, useRef, useState } from 'react'
import { H, buildsOf, type Obj, type Slide, type Theme } from './model'
import { SlideBox } from './SlideBox'

/**
 * 0.35 presenting: full screen, transitions between slides, builds (objects come in one by one),
 * and a presenter view (P key) with the next slide, speaker notes and a timer.
 */

export interface ShowSlide {
  slide: Slide
  objs: Obj[]
  bg: string
}

function useSize() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return size
}

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function Presenter({ show, start, width, theme, presenterView, onClose }: { show: ShowSlide[]; start: number; width: number; theme: Theme; presenterView: boolean; onClose(): void }) {
  const [pos, setPos] = useState({ i: Math.min(start, show.length - 1), step: 0, dir: 1 })
  const [notesView, setNotesView] = useState(presenterView)
  const [t0] = useState(() => Date.now())
  const [now, setNow] = useState(t0)
  const size = useSize()
  const nextRef = useRef(() => {})
  const cur = show[pos.i]
  const builds = useMemo(() => buildsOf(cur.objs), [cur])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const next = () =>
      setPos((p) => {
        if (p.step < buildsOf(show[p.i].objs).length) return { ...p, step: p.step + 1 }
        return p.i < show.length - 1 ? { i: p.i + 1, step: 0, dir: 1 } : p
      })
    const back = () =>
      setPos((p) => {
        if (p.step > 0) return { ...p, step: p.step - 1 }
        return p.i > 0 ? { i: p.i - 1, step: buildsOf(show[p.i - 1].objs).length, dir: -1 } : p
      })
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') onClose()
      else if (e.key === 'p' || e.key === 'P') setNotesView((v) => !v)
      else if (e.key === 'Home') setPos({ i: 0, step: 0, dir: -1 })
      else if (e.key === 'End') setPos({ i: show.length - 1, step: 0, dir: 1 })
      else if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter', 'n'].includes(e.key)) next()
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) back()
    }
    const onFs = () => !document.fullscreenElement && onClose()
    void document.documentElement.requestFullscreen?.().catch(() => undefined)
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('fullscreenchange', onFs)
    nextRef.current = next
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('fullscreenchange', onFs)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    }
  }, [onClose, show])

  const waiting = new Set(builds.slice(pos.step).map((o) => o.id))
  const tr = cur.slide.transition ?? 'none'
  const slideAt = (s: ShowSlide, scale: number, hidden?: Set<string>, cls?: string) => <SlideBox objs={s.objs} bg={s.bg} bgImage={s.slide.bgImage} width={width} theme={theme} scale={scale} hiddenIds={hidden} className={cls} />
  const goNext = () => nextRef.current()

  if (notesView) {
    const big = Math.min((size.w * 0.62) / width, (size.h * 0.7) / H)
    const small = Math.min((size.w * 0.3) / width, (size.h * 0.3) / H)
    const nextSlide = show[pos.i + 1]
    return (
      <div className="pi-present pi-pv">
        <div className="pi-pv-main" onClick={goNext}>
          {slideAt(cur, big, waiting)}
        </div>
        <div className="pi-pv-side">
          <div className="pi-pv-time">
            <strong>{clock(now - t0)}</strong>
            <span>
              Slide {pos.i + 1} / {show.length}
              {builds.length > 0 && ` · build ${pos.step} / ${builds.length}`}
            </span>
          </div>
          <span className="pi-pv-label">Next</span>
          {nextSlide ? slideAt(nextSlide, small, new Set(buildsOf(nextSlide.objs).map((o) => o.id))) : <p className="pi-pv-end">End of the show</p>}
          <span className="pi-pv-label">Notes</span>
          <div className="pi-pv-notes">{cur.slide.notes || 'No notes for this slide.'}</div>
          <span className="pi-pv-hint">P: audience view · arrows: next / back · Esc: stop</span>
        </div>
      </div>
    )
  }

  const scale = Math.min(size.w / width, size.h / H)
  return (
    <div className="pi-present" onClick={goNext}>
      <div key={pos.i} className={`pi-tr pi-tr-${tr}${pos.dir < 0 ? ' back' : ''}`}>
        {slideAt(cur, scale, waiting)}
      </div>
      <div className="pi-count">
        {pos.i + 1} / {show.length}
      </div>
    </div>
  )
}
