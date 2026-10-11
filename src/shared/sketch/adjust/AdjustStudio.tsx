import { Shuffle, SlidersHorizontal, Stamp, Waves } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Id } from '@/core/model'
import type { BrushSettings, StrokePoint } from '../brushes'
import { CurveEditor } from '../CurveEditor'
import type { SketchEngine } from '../engine'
import { BrushCursor } from '../GuideOverlay'
import { useInputSettings } from '../inputSettings'
import { penData } from '../pen'
import { viewMatrix, type View } from '../view'
import { CURVE_CHANNELS, histogram, MAX_CURVE_NODES, TONE_RANGES, type CurveChannel, type ToneRange } from './color'
import { defaultValues, dragMain, filterDef, FILTERS, type AdjustValues, type FilterId, type ParamDef } from './filters'
import { GradientEditor } from './GradientEditor'
import { LIQUIFY_MODES, LiquifyField, type LiquifyMode } from './liquify'
import { AdjustSession, CloneSession } from './session'
import './adjust.css'

const UI = {
  menu: 'Adjustments: colour, blur, effects, Liquify and Clone',
  liquify: 'Liquify',
  clone: 'Clone',
  layer: 'Layer',
  pen: 'Pen',
  layerHelp: 'Whole layer',
  penHelp: 'Paint the effect in with the brush',
  apply: 'Apply',
  cancel: 'Cancel',
  reset: 'Reset',
  done: 'Done',
  shuffle: 'New random pattern',
  dragHint: (what: string) => `Drag sideways on the canvas to change ${what.toLowerCase()}.`,
  centerHint: 'Tap the canvas to move the centre.',
  paintHint: 'Paint where the effect should go. Size and opacity come from the brush.',
  noGpu: 'Working without graphics acceleration, so the preview may be slow.',
  channels: { all: 'All', r: 'Red', g: 'Green', b: 'Blue' } as Record<CurveChannel, string>,
  ranges: { shadows: 'Shadows', midtones: 'Midtones', highlights: 'Highlights' } as Record<ToneRange, string>,
  curvesAxes: '↑ New · → Old',
  size: 'Size',
  pressure: 'Pressure',
  distortion: 'Distortion',
  momentum: 'Momentum',
  amount: 'Amount',
  liquifyHint: 'Drag on the canvas to reshape the layer.',
  setSource: 'Set source',
  pickSource: 'Tap where to copy from',
  sourceHint: 'Alt-click (Option-click) or use Set source to choose where to copy from, then paint.',
  locked: 'Source stays put',
  follows: 'Source follows the brush',
  lockedHelp: 'Every stroke starts copying from the source point',
  followsHelp: 'The source keeps its distance to the brush',
}

export type AdjustMode = { kind: 'filter'; id: FilterId } | { kind: 'liquify' } | { kind: 'clone' }

// ---- Menu ------------------------------------------------------------------------

/** The Adjustments button and its menu. */
export function AdjustMenu({ open, onOpen, onPick }: { open: boolean; onOpen(open: boolean): void; onPick(mode: AdjustMode): void }) {
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && onOpen(false)
    window.addEventListener('pointerdown', away)
    return () => window.removeEventListener('pointerdown', away)
  }, [open, onOpen])
  const pick = (m: AdjustMode) => {
    onOpen(false)
    onPick(m)
  }
  return (
    <div className="adjust-menu-wrap" ref={wrap}>
      <button className={`icon-btn sketch-tool${open ? ' is-active' : ''}`} title={UI.menu} aria-label={UI.menu} aria-expanded={open} onClick={() => onOpen(!open)}>
        <SlidersHorizontal size={16} />
      </button>
      {open && (
        <div className="adjust-menu" role="menu">
          {(['Colour', 'Blur', 'Effects'] as const).map((g) => (
            <div key={g} className="adjust-menu-group">
              <h5>{g}</h5>
              {FILTERS.filter((f) => f.group === g).map((f) => (
                <button key={f.id} role="menuitem" onClick={() => pick({ kind: 'filter', id: f.id })}>
                  {f.label}
                </button>
              ))}
            </div>
          ))}
          <div className="adjust-menu-group">
            <h5>Reshape</h5>
            <button role="menuitem" onClick={() => pick({ kind: 'liquify' })}>
              <Waves size={14} /> {UI.liquify}
            </button>
            <button role="menuitem" onClick={() => pick({ kind: 'clone' })}>
              <Stamp size={14} /> {UI.clone}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- Shared bits ----------------------------------------------------------------

export interface AdjustStudioProps {
  mode: AdjustMode
  engine: SketchEngine
  layerId: Id
  /** The current brush (paint-on mode and Clone). */
  brush: BrushSettings
  view: View
  toDoc(e: { clientX: number; clientY: number }): { x: number; y: number }
  /** Redraw the editor. */
  refresh(): void
  /** A layer's pixels changed for real (save them). */
  commit(id: Id | null): void
  onClose(): void
}

/** The adjustment, Liquify or Clone the user picked, over the canvas with its panel. */
export function AdjustStudio(p: AdjustStudioProps) {
  if (p.mode.kind === 'filter') return <FilterStudio {...p} id={p.mode.id} />
  if (p.mode.kind === 'liquify') return <LiquifyStudio {...p} />
  return <CloneStudio {...p} />
}

/** Session made once the studio mounts and cancelled if it closes without Apply. */
function useSession<T extends { cancel(): unknown }>(make: () => T, onCancel: (shown: boolean) => void): T | null {
  const [s, setS] = useState<T | null>(null)
  const made = useRef(make)
  const cancelled = useRef(onCancel)
  useEffect(() => {
    made.current = make
    cancelled.current = onCancel
  })
  useEffect(() => {
    const x = made.current()
    setS(x)
    return () => cancelled.current(x.cancel() === true)
  }, [])
  return s
}

/** Enter applies, Esc cancels; undo / redo are held back while a preview is open. */
function useKeys(onApply: () => void, onCancel: () => void, blockUndo: boolean) {
  const ref = useRef({ onApply, onCancel, blockUndo })
  useEffect(() => {
    ref.current = { onApply, onCancel, blockUndo }
  })
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      const undoKey = (e.ctrlKey || e.metaKey) && (k === 'z' || k === 'y')
      if (k === 'escape') ref.current.onCancel()
      else if (k === 'enter' && !(e.target as HTMLElement).closest?.('button, textarea')) ref.current.onApply()
      else if (!(undoKey && ref.current.blockUndo)) return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', down, true)
    return () => window.removeEventListener('keydown', down, true)
  }, [])
}

const pressureOf = (e: PointerEvent) => penData(e, useInputSettings.getState().pressureCurve).pressure
const pointsOf = (e: React.PointerEvent) => {
  const list = e.nativeEvent.getCoalescedEvents?.() ?? []
  return list.length ? list : [e.nativeEvent]
}

/** The transparent layer over the canvas that takes the pointer while a studio is open, plus its cursors. */
function Overlay(p: {
  view: View
  cursor: string
  onDown(e: React.PointerEvent): void
  onMove(e: React.PointerEvent): void
  onUp(e: React.PointerEvent): void
  onHover(at: { x: number; y: number } | null): void
  toDoc: AdjustStudioProps['toDoc']
  children?: ReactNode
}) {
  const down = useRef(false)
  return (
    <>
      <div
        className="adjust-overlay"
        style={{ cursor: p.cursor }}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId)
          down.current = true
          p.onDown(e)
        }}
        onPointerMove={(e) => {
          p.onHover(p.toDoc(e))
          if (down.current) p.onMove(e)
        }}
        onPointerUp={(e) => {
          if (!down.current) return
          down.current = false
          p.onUp(e)
        }}
        onPointerCancel={(e) => {
          if (!down.current) return
          down.current = false
          p.onUp(e)
        }}
        onPointerLeave={() => p.onHover(null)}
        onContextMenu={(e) => e.preventDefault()}
      />
      <svg className="sketch-overlay adjust-marks">
        <g transform={`matrix(${viewMatrix(p.view).join(' ')})`}>{p.children}</g>
      </svg>
    </>
  )
}

function Marker({ at, scale }: { at: { x: number; y: number }; scale: number }) {
  const r = 10 / scale
  return (
    <g className="adjust-marker" transform={`translate(${at.x} ${at.y})`}>
      <circle r={r} />
      <line x1={-r * 1.6} x2={r * 1.6} />
      <line y1={-r * 1.6} y2={r * 1.6} />
    </g>
  )
}

function Panel({ title, children, actions }: { title: ReactNode; children: ReactNode; actions: ReactNode }) {
  return (
    <div className="adjust-panel" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div className="adjust-panel-head">
        <strong>{title}</strong>
        <span className="sketch-spacer" />
        {actions}
      </div>
      {children}
    </div>
  )
}

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: { id: T; label: string; title?: string }[]; onChange(v: T): void }) {
  return (
    <div className="adjust-seg" role="radiogroup">
      {options.map((o) => (
        <button key={String(o.id)} role="radio" aria-checked={o.id === value} className={o.id === value ? 'is-active' : ''} title={o.title} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Range({ def, value, onChange }: { def: Pick<ParamDef, 'label' | 'min' | 'max' | 'step' | 'unit' | 'ends'>; value: number; onChange(v: number): void }) {
  const shown = def.unit === '%' ? `${Math.round(value * 100)}%` : `${Math.round(value * 10) / 10}${def.unit ?? ''}`
  return (
    <label className="sketch-slider adjust-slider">
      <span>{def.ends ? def.ends[0] : def.label}</span>
      <input type="range" min={def.min} max={def.max} step={def.step ?? 1} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={def.label} />
      <span className="sketch-slider-value">{def.ends ? def.ends[1] : shown}</span>
    </label>
  )
}

// ---- Adjustments ------------------------------------------------------------------

function FilterStudio(p: AdjustStudioProps & { id: FilterId }) {
  const { engine, layerId, refresh, commit, onClose } = p
  const def = filterDef(p.id)
  const [values, setValues] = useState<AdjustValues>(() => defaultValues(p.id, engine.width, engine.height))
  const [paintOn, setPaintOn] = useState(false)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const session = useSession(
    () => new AdjustSession(engine, layerId),
    (shown) => {
      if (shown) commit(layerId)
      refresh()
    },
  )
  const drag = useRef<{ x: number; start: number; moved: boolean } | null>(null)

  // Re-render the preview at most once a frame.
  useEffect(() => {
    if (!session) return
    const raf = requestAnimationFrame(() => {
      session.renderFilter(p.id, values)
      refresh()
    })
    return () => cancelAnimationFrame(raf)
  }, [session, values, p.id, refresh])

  const set = (key: string, v: number) => setValues((x) => ({ ...x, v: { ...x.v, [key]: v } }))
  const apply = () => {
    if (!session) return
    commit(session.apply())
    onClose()
  }
  useKeys(apply, onClose, true)

  const main = def.params.find((q) => q.key === def.main)
  const histFor = useCallback((c: CurveChannel) => (p.id === 'curves' && session ? histogram(session.pixels().data, c) : null), [p.id, session])

  const onDown = (e: React.PointerEvent) => {
    if (!session) return
    if (paintOn) {
      session.beginPaint(p.brush, { ...p.toDoc(e), pressure: pressureOf(e.nativeEvent) })
      refresh()
    } else drag.current = { x: e.clientX, start: main ? values.v[main.key] : 0, moved: false }
  }
  const onMove = (e: React.PointerEvent) => {
    if (!session) return
    if (paintOn) {
      for (const ev of pointsOf(e)) session.paintTo({ ...p.toDoc(ev), pressure: pressureOf(ev) })
      refresh()
    } else if (drag.current) {
      const dx = e.clientX - drag.current.x
      if (Math.abs(dx) > 3) drag.current.moved = true
      if (main && drag.current.moved) set(main.key, dragMain(main, drag.current.start, dx))
    }
  }
  const onUp = (e: React.PointerEvent) => {
    if (paintOn) {
      session?.endPaint()
      refresh()
    } else if (drag.current && !drag.current.moved && def.center) {
      const c = p.toDoc(e)
      setValues((x) => ({ ...x, center: c }))
    }
    drag.current = null
  }

  const hint = paintOn ? UI.paintHint : [main ? UI.dragHint(main.label) : '', def.center ? UI.centerHint : ''].filter(Boolean).join(' ')

  return (
    <>
      <Overlay
        view={p.view}
        cursor={paintOn ? 'none' : def.center ? 'crosshair' : main ? 'ew-resize' : 'default'}
        onDown={onDown}
        onMove={onMove}
        onUp={onUp}
        onHover={setHover}
        toDoc={p.toDoc}
      >
        {!paintOn && def.center && <Marker at={values.center} scale={p.view.scale} />}
        {paintOn && hover && <BrushCursor at={hover} brush={p.brush} scale={p.view.scale} erase={false} />}
      </Overlay>
      <Panel
        title={def.label}
        actions={
          <>
            <Seg
              value={paintOn ? 1 : 0}
              options={[
                { id: 0, label: UI.layer, title: UI.layerHelp },
                { id: 1, label: UI.pen, title: UI.penHelp },
              ]}
              onChange={(v) => {
                setPaintOn(!!v)
                session?.setPaintOn(!!v)
                refresh()
              }}
            />
            <button className="btn btn-ghost sketch-small" onClick={() => setValues(defaultValues(p.id, engine.width, engine.height))}>
              {UI.reset}
            </button>
            <button className="btn sketch-small" onClick={onClose}>
              {UI.cancel}
            </button>
            <button className="btn btn-primary sketch-small" onClick={apply}>
              {UI.apply}
            </button>
          </>
        }
      >
        <FilterControls id={p.id} values={values} onChange={setValues} histogram={histFor} />
        {hint && <p className="adjust-hint">{hint}</p>}
        {session && !session.onGpu && <p className="adjust-hint">{UI.noGpu}</p>}
      </Panel>
    </>
  )
}

/** The settings of a colour or effect adjustment: tone ranges, curves, gradient and sliders. Shared by the
 * Adjustments studio and adjustment layers (v0.13). */
export function FilterControls({ id, values, onChange, histogram: hist0 }: { id: FilterId; values: AdjustValues; onChange(next: AdjustValues): void; histogram?(channel: CurveChannel): Uint32Array | null }) {
  const def = filterDef(id)
  const [range, setRange] = useState<ToneRange>('midtones')
  const [channel, setChannel] = useState<CurveChannel>('all')
  const hist = useMemo(() => hist0?.(channel) ?? null, [hist0, channel])
  const setValues = (fn: (x: AdjustValues) => AdjustValues) => onChange(fn(values))
  const set = (key: string, v: number) => setValues((x) => ({ ...x, v: { ...x.v, [key]: v } }))
  const params = def.params.filter((q) => (!q.range || q.range === range) && (!q.when || values.v[q.when[0]] === q.when[1]))
  return (
    <>
        {id === 'balance' && <Seg<ToneRange> value={range} options={TONE_RANGES.map((r) => ({ id: r, label: UI.ranges[r] }))} onChange={setRange} />}
        {id === 'curves' && (
          <div className="adjust-curves">
            <Seg<CurveChannel> value={channel} options={CURVE_CHANNELS.map((c) => ({ id: c, label: UI.channels[c] }))} onChange={setChannel} />
            <CurveEditor
              points={values.curves[channel]}
              onChange={(pts) => setValues((x) => ({ ...x, curves: { ...x.curves, [channel]: pts } }))}
              size={200}
              max={MAX_CURVE_NODES}
              axes={UI.curvesAxes}
              under={hist && <Histogram bins={hist} size={200} channel={channel} />}
            />
          </div>
        )}
        {id === 'gradient' && <GradientEditor stops={values.gradient} onChange={(gradient) => setValues((x) => ({ ...x, gradient }))} />}
        <div className="adjust-params">
          {params.map((q) =>
            q.options ? (
              <div key={q.key} className="sketch-row">
                <span className="adjust-label">{q.label}</span>
                <Seg value={values.v[q.key]} options={q.options.map((label, i) => ({ id: i, label }))} onChange={(v) => set(q.key, v)} />
              </div>
            ) : q.toggle ? (
              <label key={q.key} className="sketch-check">
                <input type="checkbox" checked={!!values.v[q.key]} onChange={(e) => set(q.key, e.target.checked ? 1 : 0)} />
                {q.label}
              </label>
            ) : (
              <Range key={q.key} def={q} value={values.v[q.key]} onChange={(v) => set(q.key, v)} />
            ),
          )}
          {def.seeded && (
            <button className="btn btn-ghost sketch-small" onClick={() => setValues((x) => ({ ...x, seed: Math.floor(Math.random() * 1000) + 1 }))}>
              <Shuffle size={13} /> {UI.shuffle}
            </button>
          )}
        </div>
    </>
  )
}

function Histogram({ bins, size, channel }: { bins: Uint32Array; size: number; channel: CurveChannel }) {
  const pad = 8
  const inner = size - pad * 2
  let max = 1
  for (const b of bins) max = Math.max(max, b)
  const d = `M${pad},${pad + inner} ${Array.from(bins, (b, i) => `L${(pad + (i / 255) * inner).toFixed(1)},${(pad + inner - Math.sqrt(b / max) * inner).toFixed(1)}`).join(' ')} L${pad + inner},${pad + inner}Z`
  return <path d={d} className={`adjust-histogram is-${channel}`} />
}

// ---- Liquify ------------------------------------------------------------------------

function LiquifyStudio(p: AdjustStudioProps) {
  const { engine, layerId, refresh, commit, onClose } = p
  const [mode, setMode] = useState<LiquifyMode>('push')
  const [size, setSize] = useState(120)
  const [pressure, setPressure] = useState(0.5)
  const [distortion, setDistortion] = useState(0)
  const [momentum, setMomentum] = useState(0)
  const [amount, setAmount] = useState(1)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [field] = useState(() => new LiquifyField(engine.width, engine.height))
  const session = useSession(
    () => new AdjustSession(engine, layerId),
    (shown) => {
      if (shown) commit(layerId)
      refresh()
    },
  )
  const settings = useRef({ mode, size, pressure, distortion, momentum, amount })
  useEffect(() => {
    settings.current = { mode, size, pressure, distortion, momentum, amount }
  })
  /** The pen while it is down, and the frame loop that keeps twirls etc. going. */
  const live = useRef<{ x: number; y: number; dx: number; dy: number; pressure: number; down: boolean; fade: number; raf: number } | null>(null)
  const dirty = useRef(true)

  const dab = (x: number, y: number, dx: number, dy: number, pr: number, k = 1) => {
    const s = settings.current
    const strength = (s.mode === 'push' ? 1 : 0.5) * (1 - s.pressure + s.pressure * pr) * k
    field.apply({ mode: s.mode, x, y, dx, dy, radius: s.size / 2, strength, distortion: s.distortion, seed: Math.random() * 100 })
    dirty.current = true
  }

  const draw = () => {
    if (!session || !dirty.current) return
    dirty.current = false
    session.renderWarp(field.data, field.fw, field.fh, field.cell, settings.current.amount)
    refresh()
  }

  // First preview, and again when the overall amount changes.
  const drawRef = useRef(draw)
  useEffect(() => {
    drawRef.current = draw
  })
  useEffect(() => {
    dirty.current = true
    const raf = requestAnimationFrame(() => drawRef.current())
    return () => cancelAnimationFrame(raf)
  }, [amount, session])

  const tick = () => {
    const l = live.current
    if (!l) return
    const s = settings.current
    if (l.down) {
      if (s.mode !== 'push') dab(l.x, l.y, 0, 0, l.pressure)
    } else {
      // Momentum: the last movement carries on and slows down.
      l.fade *= 0.9
      if (l.fade < 0.05) {
        live.current = null
        draw()
        return
      }
      l.x += l.dx
      l.y += l.dy
      dab(l.x, l.y, l.dx, l.dy, l.pressure, l.fade)
    }
    draw()
    l.raf = requestAnimationFrame(tick)
  }
  useEffect(() => () => cancelAnimationFrame(live.current?.raf ?? 0), [])

  const onDown = (e: React.PointerEvent) => {
    cancelAnimationFrame(live.current?.raf ?? 0)
    const at = p.toDoc(e)
    live.current = { ...at, dx: 0, dy: 0, pressure: pressureOf(e.nativeEvent), down: true, fade: 1, raf: 0 }
    live.current.raf = requestAnimationFrame(tick)
  }
  const onMove = (e: React.PointerEvent) => {
    const l = live.current
    if (!l?.down) return
    for (const ev of pointsOf(e)) {
      const q = p.toDoc(ev)
      const dx = q.x - l.x
      const dy = q.y - l.y
      l.pressure = pressureOf(ev)
      if (settings.current.mode === 'push' && (dx || dy)) dab(q.x, q.y, dx, dy, l.pressure)
      l.dx = dx
      l.dy = dy
      l.x = q.x
      l.y = q.y
    }
  }
  const onUp = () => {
    const l = live.current
    if (!l) return
    l.down = false
    const m = settings.current.momentum
    if (!m || settings.current.mode === 'reconstruct') {
      cancelAnimationFrame(l.raf)
      live.current = null
      draw()
    } else {
      l.fade = m
      // Twirls and pinches keep going in place; pushes keep sliding.
      if (settings.current.mode !== 'push') l.dx = l.dy = 0
    }
  }

  const apply = () => {
    if (!session) return
    draw()
    commit(session.apply())
    onClose()
  }
  useKeys(apply, onClose, true)

  return (
    <>
      <Overlay view={p.view} cursor="none" onDown={onDown} onMove={onMove} onUp={onUp} onHover={setHover} toDoc={p.toDoc}>
        {hover && <BrushCursor at={hover} brush={{ size, roundness: 1, rotation: 0, shape: 'round' }} scale={p.view.scale} erase={false} />}
      </Overlay>
      <Panel
        title={UI.liquify}
        actions={
          <>
            <button
              className="btn btn-ghost sketch-small"
              onClick={() => {
                field.reset()
                dirty.current = true
                draw()
              }}
            >
              {UI.reset}
            </button>
            <button className="btn sketch-small" onClick={onClose}>
              {UI.cancel}
            </button>
            <button className="btn btn-primary sketch-small" onClick={apply}>
              {UI.apply}
            </button>
          </>
        }
      >
        <Seg<LiquifyMode> value={mode} options={LIQUIFY_MODES.map((m) => ({ id: m.id, label: m.label }))} onChange={setMode} />
        <div className="adjust-params">
          <Range def={{ label: UI.size, min: 5, max: 800, unit: 'px' }} value={size} onChange={setSize} />
          <Range def={{ label: UI.pressure, min: 0, max: 1, step: 0.01, unit: '%' }} value={pressure} onChange={setPressure} />
          <Range def={{ label: UI.distortion, min: 0, max: 1, step: 0.01, unit: '%' }} value={distortion} onChange={setDistortion} />
          <Range def={{ label: UI.momentum, min: 0, max: 1, step: 0.01, unit: '%' }} value={momentum} onChange={setMomentum} />
          <Range def={{ label: UI.amount, min: 0, max: 1, step: 0.01, unit: '%' }} value={amount} onChange={setAmount} />
        </div>
        <p className="adjust-hint">{UI.liquifyHint}</p>
        {session && !session.onGpu && <p className="adjust-hint">{UI.noGpu}</p>}
      </Panel>
    </>
  )
}

// ---- Clone --------------------------------------------------------------------------

function CloneStudio(p: AdjustStudioProps) {
  const { engine, layerId, refresh, commit, onClose } = p
  const [clone] = useState(() => new CloneSession(engine))
  const [picking, setPicking] = useState(false)
  const [locked, setLocked] = useState(false)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [, setTick] = useState(0)
  useEffect(
    () => () => {
      clone.cancel()
      refresh()
    },
    [clone, refresh],
  )
  // Each stroke is its own undo step, so undo stays available between strokes.
  useKeys(onClose, onClose, clone.painting)

  const point = (e: PointerEvent | React.PointerEvent): StrokePoint => ({ ...p.toDoc(e), pressure: pressureOf('nativeEvent' in e ? e.nativeEvent : e) })

  const onDown = (e: React.PointerEvent) => {
    if (picking || e.altKey) {
      clone.setSource(p.toDoc(e))
      setPicking(false)
      setTick((t) => t + 1)
      return
    }
    if (clone.begin(layerId, p.brush, point(e))) refresh()
    else setPicking(true)
  }
  const onMove = (e: React.PointerEvent) => {
    if (!clone.painting) return
    for (const ev of pointsOf(e)) clone.move(point(ev))
    refresh()
  }
  const onUp = () => {
    if (!clone.painting) return
    commit(clone.end())
    setTick((t) => t + 1)
  }

  const src = hover ? clone.sourceFor(hover) : clone.source
  return (
    <>
      <Overlay view={p.view} cursor={picking ? 'crosshair' : 'none'} onDown={onDown} onMove={onMove} onUp={onUp} onHover={setHover} toDoc={p.toDoc}>
        {src && <Marker at={src} scale={p.view.scale} />}
        {!picking && hover && <BrushCursor at={hover} brush={p.brush} scale={p.view.scale} erase={false} />}
      </Overlay>
      <Panel
        title={UI.clone}
        actions={
          <>
            <button className={`btn sketch-small${picking ? ' is-active' : ''}`} onClick={() => setPicking(!picking)}>
              {picking ? UI.pickSource : UI.setSource}
            </button>
            <button className="btn btn-primary sketch-small" onClick={onClose}>
              {UI.done}
            </button>
          </>
        }
      >
        <Seg
          value={locked ? 1 : 0}
          options={[
            { id: 0, label: UI.follows, title: UI.followsHelp },
            { id: 1, label: UI.locked, title: UI.lockedHelp },
          ]}
          onChange={(v) => {
            setLocked(!!v)
            clone.setLocked(!!v)
          }}
        />
        <p className="adjust-hint">{UI.sourceHint}</p>
      </Panel>
    </>
  )
}
