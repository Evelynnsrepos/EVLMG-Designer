import { BookOpen, ChevronLeft, ChevronRight, Clapperboard, Copy, Film, LayoutGrid, Pause, Play, Plus, Settings2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { importAssetFromBlob } from '@/core/assets'
import { postIntent, useProjectStore } from '@/core/state'
import { openComponent } from '@/shell/editor/actions'
import type { PlayMode } from './assist'
import type { Assist } from './assistView'
import { toPng, type SketchEngine } from './engine'
import { SheetExport } from './SheetExport'
import './assist.css'

const UI = {
  animation: 'Animation Assist: every top-level layer or group is a frame',
  pages: 'Page Assist: every top-level layer or group is a page',
  frame: (n: number) => `Frame ${n}`,
  page: (n: number) => `Page ${n}`,
  background: 'Background',
  foreground: 'Foreground',
  play: 'Play',
  stop: 'Stop',
  addFrame: 'New frame',
  addPage: 'New page',
  duplicate: 'Duplicate this frame',
  prev: 'Previous page',
  next: 'Next page',
  settings: 'Settings',
  toStoryboard: 'Send to Storyboard',
  sheet: 'Sprite sheet for games: Godot, GameMaker, Unity, PNG + JSON',
  toStoryboardHint: (what: string) => `Send every ${what} to the Storyboard as storyboard frames`,
  sending: 'Sending…',
  sent: (n: number) => `Sent ${n} to the Storyboard`,
  fps: 'Frames per second',
  mode: 'Playback',
  modes: { loop: 'Loop', pingpong: 'Ping-pong', once: 'One shot' } as Record<PlayMode, string>,
  onion: 'Onion skin frames',
  onionOpacity: 'Onion skin opacity',
  onionColors: 'Onion colours (before, after)',
  firstBg: 'First frame is a background',
  lastFg: 'Last frame is a foreground',
  hold: 'Hold this frame (extra frames)',
  pageBg: 'First page is a background',
}

/** The two switches in the top bar. */
export function AssistButtons({ assist }: { assist: Assist }) {
  return (
    <>
      <button
        className={`icon-btn sketch-tool${assist.mode === 'animation' ? ' is-active' : ''}`}
        title={UI.animation}
        aria-label={UI.animation}
        aria-pressed={assist.mode === 'animation'}
        onClick={() => assist.toggle('animation')}
      >
        <Film size={16} />
      </button>
      <button
        className={`icon-btn sketch-tool${assist.mode === 'pages' ? ' is-active' : ''}`}
        title={UI.pages}
        aria-label={UI.pages}
        aria-pressed={assist.mode === 'pages'}
        onClick={() => assist.toggle('pages')}
      >
        <BookOpen size={16} />
      </button>
    </>
  )
}

/** Frames timeline (Animation Assist) or page strip (Page Assist), at the bottom of the canvas. */
export function AssistBar({ assist, engine, title }: { assist: Assist; engine: SketchEngine; title: string }) {
  const root = useProjectStore((s) => s.root)
  const [settings, setSettings] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  if (!assist.mode) return null
  const { anim, ids, current, mode } = assist
  const pages = mode === 'pages'
  const label = (i: number) => (i === assist.bg ? UI.background : i === assist.fg ? UI.foreground : pages ? UI.page(assist.frames.indexOf(i) + 1) : UI.frame(assist.frames.indexOf(i) + 1))
  const hold = anim.holds[ids[current]] ?? 0

  const send = async () => {
    if (!root) return
    setNote(UI.sending)
    const out: { path: string; name: string; seconds: number }[] = []
    for (const i of assist.frames) {
      // Private layers stay out, like in every export.
      const blob = await toPng(assist.render([assist.bg, i, assist.fg], true, true))
      const name = `${title} ${label(i)}`
      const asset = await importAssetFromBlob(root, blob, 'image', `${name}.png`)
      if (asset) out.push({ path: asset.path, name, seconds: pages ? 3 : Math.round(((1 + (anim.holds[ids[i]] ?? 0)) / anim.fps) * 100) / 100 })
    }
    if (!out.length) return setNote(null)
    postIntent('storyboard', { action: 'add-frames', frames: out })
    openComponent('storyboard')
    setNote(UI.sent(out.length))
    setTimeout(() => setNote(null), 3000)
  }

  return (
    <div className="sketch-assist" onPointerDown={(e) => e.stopPropagation()}>
      <div className="sketch-assist-tools">
        {pages ? (
          <>
            <button className="icon-btn" title={UI.prev} aria-label={UI.prev} disabled={current <= 0} onClick={() => assist.select(current - 1)}>
              <ChevronLeft size={16} />
            </button>
            <span className="sketch-assist-count">
              {current === assist.bg ? UI.background : `${assist.frames.indexOf(current) + 1} / ${assist.frames.length}`}
            </span>
            <button className="icon-btn" title={UI.next} aria-label={UI.next} disabled={current >= ids.length - 1} onClick={() => assist.select(current + 1)}>
              <ChevronRight size={16} />
            </button>
          </>
        ) : (
          <button className="icon-btn" title={assist.playing ? UI.stop : UI.play} aria-label={assist.playing ? UI.stop : UI.play} onClick={assist.playing ? assist.stop : assist.play}>
            {assist.playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
        )}
        <button className="icon-btn" title={pages ? UI.addPage : UI.addFrame} aria-label={pages ? UI.addPage : UI.addFrame} onClick={assist.add}>
          <Plus size={16} />
        </button>
        {!pages && (
          <button className="icon-btn" title={UI.duplicate} aria-label={UI.duplicate} onClick={assist.duplicate}>
            <Copy size={15} />
          </button>
        )}
        <button className={`icon-btn${settings ? ' is-active' : ''}`} title={UI.settings} aria-label={UI.settings} onClick={() => setSettings(!settings)}>
          <Settings2 size={15} />
        </button>
        {!pages && (
          <button className={`icon-btn${sheet ? ' is-active' : ''}`} title={UI.sheet} aria-label={UI.sheet} onClick={() => setSheet(!sheet)}>
            <LayoutGrid size={15} />
          </button>
        )}
        <button className="icon-btn" title={UI.toStoryboardHint(pages ? 'page' : 'frame')} aria-label={UI.toStoryboard} disabled={!root} onClick={() => void send()}>
          <Clapperboard size={15} />
        </button>
        {note && <span className="sketch-assist-note">{note}</span>}
      </div>
      <div className="sketch-assist-strip">
        {ids.map((id, i) => (
          <button
            key={id}
            className={`sketch-assist-frame${i === assist.shown ? ' is-current' : ''}${i === assist.bg || i === assist.fg ? ' is-fixed' : ''}`}
            onClick={() => {
              assist.stop()
              assist.select(i)
            }}
          >
            <FrameThumb assist={assist} engine={engine} index={i} />
            <span>
              {label(i)}
              {!pages && anim.holds[id] ? ` +${anim.holds[id]}` : ''}
            </span>
          </button>
        ))}
      </div>
      {sheet && !pages && (
        <SheetExport
          title={title}
          onClose={() => setSheet(false)}
          // Private layers stay out and the background colour too, so the sprite is see-through.
          frames={() => assist.frames.map((i) => ({ canvas: assist.render([assist.bg, i, assist.fg], false, true), ms: Math.round(((1 + (anim.holds[ids[i]] ?? 0)) * 1000) / anim.fps) }))}
        />
      )}
      {settings && (
        <div className="sketch-assist-settings">
          {pages ? (
            <label className="sketch-check">
              <input type="checkbox" checked={assist.pages.background} onChange={(e) => assist.setPages({ background: e.target.checked })} /> {UI.pageBg}
            </label>
          ) : (
            <>
              <Row label={UI.fps} value={anim.fps} min={1} max={60} step={1} onChange={(fps) => assist.setAnim({ fps })} />
              <label className="sketch-assist-row">
                <span>{UI.mode}</span>
                <select className="input" value={anim.mode} onChange={(e) => assist.setAnim({ mode: e.target.value as PlayMode })}>
                  {(Object.keys(UI.modes) as PlayMode[]).map((m) => (
                    <option key={m} value={m}>
                      {UI.modes[m]}
                    </option>
                  ))}
                </select>
              </label>
              <Row label={UI.onion} value={anim.onion} min={0} max={12} step={1} onChange={(onion) => assist.setAnim({ onion })} />
              <Row label={UI.onionOpacity} value={anim.onionOpacity} min={0} max={1} step={0.05} shown={`${Math.round(anim.onionOpacity * 100)}%`} onChange={(onionOpacity) => assist.setAnim({ onionOpacity })} />
              <label className="sketch-assist-row">
                <span>{UI.onionColors}</span>
                <input type="color" value={anim.onionBefore} onChange={(e) => assist.setAnim({ onionBefore: e.target.value })} />
                <input type="color" value={anim.onionAfter} onChange={(e) => assist.setAnim({ onionAfter: e.target.value })} />
              </label>
              <label className="sketch-check">
                <input type="checkbox" checked={anim.background} onChange={(e) => assist.setAnim({ background: e.target.checked })} /> {UI.firstBg}
              </label>
              <label className="sketch-check">
                <input type="checkbox" checked={anim.foreground} onChange={(e) => assist.setAnim({ foreground: e.target.checked })} /> {UI.lastFg}
              </label>
              <Row label={UI.hold} value={hold} min={0} max={24} step={1} onChange={(h) => assist.setAnim({ holds: { ...anim.holds, [ids[current]]: h } })} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Row(p: { label: string; value: number; min: number; max: number; step: number; shown?: string; onChange(v: number): void }) {
  return (
    <label className="sketch-assist-row">
      <span>{p.label}</span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} />
      <span className="sketch-slider-value">{p.shown ?? p.value}</span>
    </label>
  )
}

/** A small picture of one frame; drawn again shortly after the drawing changes (not during a stroke). */
function FrameThumb({ assist, engine, index }: { assist: Assist; engine: SketchEngine; index: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const version = engine.version
  useEffect(() => {
    const t = setTimeout(() => {
      const c = ref.current
      if (!c || engine.stroking) return
      const ctx = c.getContext('2d')!
      ctx.clearRect(0, 0, c.width, c.height)
      const src = assist.render([index], true)
      const s = Math.min(c.width / src.width, c.height / src.height)
      ctx.drawImage(src, (c.width - src.width * s) / 2, (c.height - src.height * s) / 2, src.width * s, src.height * s)
    }, 250)
    return () => clearTimeout(t)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- redrawn when the pixels or the layer list change
  }, [version, assist.ids.join(), index])
  return <canvas ref={ref} width={64} height={40} className="sketch-thumb" />
}
