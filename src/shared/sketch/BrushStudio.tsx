import { Redo2, RotateCcw, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { newId, type Id } from '@/core/model'
import { promptDialog } from '../dialogs'
import { Modal } from '../ui'
import { BLEND_MODES, CANVAS_BLENDS } from './blend'
import {
  builtInBrush,
  canShade,
  DUAL_MODES,
  FILTERINGS,
  GRAIN_BLENDS,
  OUTLINE_COLORS,
  OUTLINE_FILLS,
  WIGGLE_STYLES,
  isRibbon,
  normalizeBrush,
  normalizeSettings,
  RENDER_MODES,
  settingsOf,
  type BrushDef,
  type BrushSettings,
  type CurvePoint,
} from './brushes'
import { CurveEditor } from './CurveEditor'
import { DrawingPad } from './DrawingPad'
import { STARTERS } from './brushDefaults'
import { letterStrip, loadAsciiFont } from './ascii'
import { useBrushLibrary } from './library'
import { blobToMask, TextureEditor } from './TextureEditor'
import { loadImageMask } from './brushTextures'
import './studio.css'

const PAGES = [
  'Easy',
  'Stroke path',
  'Stabilization',
  'Taper',
  'Shape',
  'Grain',
  'Rendering',
  'Wet mix',
  'Color dynamics',
  'Dynamics',
  'Pen',
  'Properties',
  'Dual brush',
  'About this brush',
] as const
type Page = (typeof PAGES)[number]

/** Pages that edit brush-wide things, not the main or second half of a dual brush. */
const WHOLE_BRUSH = new Set<Page>(['Easy', 'Properties', 'Dual brush', 'About this brush'])

const UI = {
  title: 'Brush Studio',
  cancel: 'Cancel',
  done: 'Done',
  undo: 'Undo (Ctrl+Z)',
  redo: 'Redo (Ctrl+Y)',
  editing: 'Editing',
  main: 'Main brush',
  second: 'Second brush',
  noGrain: 'No grain',
  startFrom: 'Start from',
  letters: 'Letter brush',
  lettersHint: 'Type a word or letters: they are written along your line, over and over, and turn with it. Uses the brush colour.',
  makeLetters: 'Make',
  startHint: 'Picks a starting point and replaces the settings (Ctrl+Z goes back). Then fine-tune with the sliders below, or open the other pages for every setting.',
  easyMore: 'Every other setting is on the pages on the left.',
  wetHint: 'Wet mix picks up the colors already on the layer and mixes them with the paint.',
  noDual: 'A dual brush paints two brushes along the same line and combines them.',
  addDual: 'Add a second brush',
  pickDual: 'Use another brush as the second',
  choose: 'Choose a brush…',
  removeDual: 'Remove the second brush',
  combine: 'Combine',
  dualSize: 'Second brush size',
  resetPoints: 'Reset points',
  resetHint: 'Save a version of this brush you like, and come back to it any time.',
  saveReset: 'Save a reset point',
  resetName: 'Name the reset point',
  goBack: 'Go back',
  deletePoint: 'Delete this reset point',
  original: 'Reset to the original settings',
  name: 'Name',
  author: 'Made by',
  created: 'Created',
  signature: 'Signature',
  clearSig: 'Clear',
  presets: 'Size presets (px)',
}

const clock = () => Date.now()

/** Edit every setting of a brush, with undo, Cancel / Done and a drawing pad to try it. */
export function BrushStudio({ brushId, color, onClose }: { brushId: Id; color: string; onClose: () => void }) {
  const stored = useBrushLibrary((s) => s.brushes.find((b) => b.id === brushId))
  const replace = useBrushLibrary((s) => s.replaceBrush)
  const [draft, setDraft] = useState<BrushDef | undefined>(stored)
  const [letters, setLetters] = useState('ASCII')
  const [page, setPage] = useState<Page>('Easy')
  const [target, setTarget] = useState<'main' | 'second'>('main')
  const hist = useRef<{ past: BrushDef[]; future: BrushDef[]; key: string; at: number }>({ past: [], future: [], key: '', at: 0 })

  const commit = (next: BrushDef, key: string) => {
    const h = hist.current
    // A slider drag is one undo step.
    if (draft && (key !== h.key || clock() - h.at > 700)) h.past.push(draft)
    h.future = []
    h.key = key
    h.at = clock()
    setDraft(next)
  }
  const undo = () => {
    const h = hist.current
    const prev = h.past.pop()
    if (!prev || !draft) return
    h.future.push(draft)
    h.key = ''
    setDraft(prev)
  }
  const redo = () => {
    const h = hist.current
    const next = h.future.pop()
    if (!next || !draft) return
    h.past.push(draft)
    h.key = ''
    setDraft(next)
  }
  const keys = useRef({ undo, redo })
  useEffect(() => {
    keys.current = { undo, redo }
  })
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).tagName === 'INPUT') return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) keys.current.undo()
      else if (k === 'y' || (k === 'z' && e.shiftKey)) keys.current.redo()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', down, true)
    return () => window.removeEventListener('keydown', down, true)
  }, [])

  if (!draft) return null
  const editSecond = target === 'second' && !!draft.dual && !WHOLE_BRUSH.has(page)
  const s: BrushSettings = editSecond ? draft.dual! : draft
  const set = (patch: Partial<BrushSettings>, key = Object.keys(patch).join()) =>
    commit(editSecond ? { ...draft, dual: { ...draft.dual!, ...patch } } : { ...draft, ...patch }, (editSecond ? 'dual.' : '') + key)
  const setDef = (patch: Partial<BrushDef>, key = Object.keys(patch).join()) => commit({ ...draft, ...patch }, key)

  const num = (key: keyof BrushSettings, label: string, min: number, max: number, unit: Unit = '%', hint?: string) => (
    <NumberRow key={key} label={label} hint={hint} value={s[key] as number} min={min} max={max} unit={unit} onChange={(v) => set({ [key]: v } as Partial<BrushSettings>, key)} />
  )
  const check = (key: keyof BrushSettings, label: string) => (
    <label key={key} className="studio-check">
      <input type="checkbox" checked={s[key] as boolean} onChange={(e) => set({ [key]: e.target.checked } as Partial<BrushSettings>)} /> {label}
    </label>
  )
  const choice = (key: keyof BrushSettings, label: string, options: readonly { id: string; label: string }[]) => (
    <Row key={key} label={label}>
      <select className="input" value={String(s[key])} onChange={(e) => set({ [key]: e.target.value } as Partial<BrushSettings>)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </Row>
  )
  const curve = (key: 'pressureCurve' | 'tiltCurve' | 'speedCurve', xLabel: string) => (
    <div className="studio-curve" title={xLabel}>
      <CurveEditor points={s[key]} onChange={(c: CurvePoint[]) => set({ [key]: c }, key)} />
    </div>
  )

  const done = () => {
    replace(normalizeBrush(draft))
    onClose()
  }

  return (
    <Modal onClose={onClose}>
      <div className="studio">
        <div className="studio-head">
          <h3>
            {UI.title}: {draft.name}
          </h3>
          <button className="icon-btn" title={UI.undo} onClick={undo}>
            <Undo2 size={15} />
          </button>
          <button className="icon-btn" title={UI.redo} onClick={redo}>
            <Redo2 size={15} />
          </button>
        </div>
        <div className="studio-body">
          <nav className="studio-nav">
            {PAGES.map((p) => (
              <button key={p} className={`studio-tab${p === page ? ' is-active' : ''}`} onClick={() => setPage(p)}>
                {p}
              </button>
            ))}
          </nav>
          <div className="studio-settings">
            {draft.dual && !WHOLE_BRUSH.has(page) && (
              <div className="studio-target">
                <span className="muted">{UI.editing}</span>
                <button className={`btn btn-small${target === 'main' ? ' is-active' : ''}`} onClick={() => setTarget('main')}>
                  {UI.main}
                </button>
                <button className={`btn btn-small${target === 'second' ? ' is-active' : ''}`} onClick={() => setTarget('second')}>
                  {UI.second}
                </button>
              </div>
            )}
            {page === 'Easy' && (
              <>
                <div className="studio-sub">{UI.startFrom}</div>
                <div className="studio-starters">
                  {STARTERS.map((t) => (
                    <button
                      key={t.id}
                      className="btn btn-small"
                      title={t.hint}
                      onClick={() => commit({ ...draft, ...normalizeSettings({ ...t.settings, size: draft.size }) }, 'starter')}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="studio-starters" title={UI.lettersHint}>
                  <span className="muted">{UI.letters}</span>
                  <input className="input" value={letters} onChange={(e) => setLetters(e.target.value)} aria-label={UI.letters} spellCheck={false} />
                  <button
                    className="btn btn-small"
                    onClick={() =>
                      void loadAsciiFont().then(async () => {
                        const shapeImage = letterStrip(letters)
                        // Decoded before the first stroke needs it.
                        await loadImageMask(shapeImage)
                        commit({ ...draft, ...normalizeSettings({ hardness: 1, ribbon: 'tile', shaded: false, pressureSize: 0.2, pressureOpacity: 0, streamline: 0.6, spacing: 0.05, stampPreview: false, size: Math.max(24, draft.size), shapeImage }) }, 'starter')
                      })
                    }
                  >
                    {UI.makeLetters}
                  </button>
                </div>
                <div className="studio-note muted">{UI.startHint}</div>
                {num('size', 'Size', s.minSize, s.maxSize, 'px')}
                {num('opacity', 'Opacity', 0, 1)}
                {!s.shapeImage && num('hardness', 'Hard edge', 0, 1, '%', '100% = crisp edge, 0% = soft')}
                {num('streamline', 'Smooth lines', 0, 1, '%', 'Calmer lines that follow the pen a little later')}
                {num('spacing', 'Spacing', 0.02, 1.5, '%', 'Distance between stamps: low = solid line, high = dots')}
                {num('scatter', 'Scatter', 0, 2, '%', 'Stamps jump sideways from the line')}
                <NumberRow
                  label="Pointed ends"
                  hint="How long the line grows and shrinks at its start and end"
                  value={Math.max(s.taperStart, s.taperEnd)}
                  min={0}
                  max={400}
                  unit="px"
                  onChange={(v) => set({ taperStart: v, taperEnd: v, touchTaperStart: v, touchTaperEnd: v }, 'taper')}
                />
                {num('pressureSize', 'Pressure changes size', 0, 1)}
                {num('pressureOpacity', 'Pressure changes opacity', 0, 1)}
                {num('outline', 'Outline', 0, 60, 'px', 'A line around the shape you paint, following it as you draw')}
                {(s.outline ?? 0) > 0 && choice('outlineFill', 'Inside the outline', OUTLINE_FILLS)}
                {s.grain !== 'none' || s.grainImage ? num('grainDepth', 'Texture', 0, 1, '%', 'How strongly the paper grain shows') : null}
                {num('wiggle', 'Wiggle (animated)', 0, 1, '%', 'The line moves in a loop. Strokes go on an Animated layer, which exports as GIF, animated PNG, video or sprite sheet')}
                {(s.wiggle ?? 0) > 0 && choice('wiggleStyle', 'How it wiggles', WIGGLE_STYLES)}
                <div className="studio-note muted">{UI.easyMore}</div>
              </>
            )}
            {page === 'Stroke path' && (
              <>
                {num('spacing', 'Spacing', 0.02, 1.5, '%', 'Distance between stamps')}
                {num('spacingJitter', 'Spacing jitter', 0, 1)}
                {num('scatter', 'Jitter sideways', 0, 2)}
                {num('count', 'Stamps per point', 1, 16, 'n')}
                {num('countJitter', 'Count jitter', 0, 1)}
                {num('falloff', 'Fall off', 0, 1, '%', 'The stroke fades as it gets longer')}
                {num('wiggle', 'Wiggle (animated)', 0, 1, '%', 'The line moves in a loop on an Animated layer')}
                {(s.wiggle ?? 0) > 0 && choice('wiggleStyle', 'How it wiggles', WIGGLE_STYLES)}
              </>
            )}
            {page === 'Stabilization' && (
              <>
                {num('streamline', 'StreamLine', 0, 1, '%', 'Smooths the line as you draw')}
                {num('stabilization', 'Stabilization', 0, 1, '%', 'Steadier lines that trail the pen a little')}
                {num('tether', 'Tether', 0, 1, '%', 'Pulls the brush behind the pen on a string, for very calm lines')}
                {num('motionFilter', 'Motion filtering', 0, 1, '%', 'Removes shaky wobbles')}
                {num('motionExpression', 'Expression', 0, 1, '%', 'Keeps some of the wobble for lively lines')}
              </>
            )}
            {page === 'Taper' && (
              <>
                <h5 className="studio-sub">Pen</h5>
                {num('taperStart', 'Start', 0, 400, 'px')}
                {num('taperEnd', 'End', 0, 400, 'px')}
                <h5 className="studio-sub">Mouse and touch</h5>
                {num('touchTaperStart', 'Start', 0, 400, 'px')}
                {num('touchTaperEnd', 'End', 0, 400, 'px')}
                <h5 className="studio-sub">The taper changes</h5>
                {num('taperSize', 'Size', 0, 1)}
                {num('taperOpacity', 'Opacity', 0, 1)}
                {num('taperPressure', 'Pressure', 0, 1)}
                {num('taperTip', 'Tip size', 0, 1)}
                {check('tipAnimation', 'Show the end taper while drawing')}
              </>
            )}
            {page === 'Shape' && (
              <>
                <TextureEditor kind="shape" brush={s} onChange={(p) => set(p)} />
                {!s.shapeImage && num('hardness', 'Hardness', 0, 1)}
                {num('roundness', 'Roundness', 0.05, 1)}
                <Row label="Rotation">
                  <select
                    className="input"
                    value={typeof s.rotation === 'number' ? 'fixed' : s.rotation}
                    onChange={(e) => set({ rotation: e.target.value === 'fixed' ? 0 : (e.target.value as 'follow' | 'random') })}
                  >
                    <option value="follow">Follow the stroke</option>
                    <option value="random">Random</option>
                    <option value="fixed">Fixed angle</option>
                  </select>
                </Row>
                {typeof s.rotation === 'number' && <NumberRow label="Angle" value={s.rotation} min={0} max={360} unit="°" onChange={(v) => set({ rotation: v }, 'rotation')} />}
                {num('rotationJitter', 'Rotation jitter', 0, 1)}
                {num('pressureRoundness', 'Flatter with light pressure', 0, 1)}
                {num('tiltRoundness', 'Flatter when tilted', 0, 1)}
                {check('azimuth', 'Turn with the pen’s direction')}
                {check('randomize', 'Flip stamps at random')}
                {check('flipX', 'Flip left to right')}
                {check('flipY', 'Flip upside down')}
                {choice('shapeFiltering', 'Edges', FILTERINGS)}
                {canShade(s) && check('shaded', 'Keep the image’s light and dark (its greys shade the colour)')}
                {choice('ribbon', 'Ribbon', [
                  { id: 'off', label: 'Off: stamps' },
                  { id: 'stretch', label: 'Bend the image along the stroke, stretched' },
                  { id: 'tile', label: 'Bend the image along the stroke, repeated' },
                ])}
                {isRibbon(s) && (
                  <>
                    <CapRow label="Start cap" value={s.capStart} onChange={(v) => set({ capStart: v })} />
                    <CapRow label="End cap" value={s.capEnd} onChange={(v) => set({ capEnd: v })} />
                  </>
                )}
              </>
            )}
            {page === 'Grain' && (
              <>
                <TextureEditor kind="grain" brush={s} onChange={(p) => set(p)} />
                <button className={`btn btn-small${s.grain === 'none' && !s.grainImage ? ' is-active' : ''}`} onClick={() => set({ grain: 'none', grainImage: null })}>
                  {UI.noGrain}
                </button>
                {choice('grainMode', 'Grain', [
                  { id: 'texturized', label: 'Fixed to the paper' },
                  { id: 'moving', label: 'Moves with the brush' },
                ])}
                {s.grainMode === 'moving' && num('grainMovement', 'Movement', 0, 1, '%', '100% stays with each stamp')}
                {num('grainScale', 'Scale', 0.1, 5, 'x')}
                {num('grainZoom', 'Grow with brush size', 0, 1)}
                {num('grainRotation', 'Rotation', 0, 360, '°')}
                {num('grainDepth', 'Depth', 0, 1)}
                {num('grainContrast', 'Contrast', -1, 1)}
                {num('grainBrightness', 'Brightness', -1, 1)}
                {choice('grainBlend', 'Blend', GRAIN_BLENDS)}
                {choice('grainFiltering', 'Edges', FILTERINGS)}
              </>
            )}
            {page === 'Rendering' && (
              <>
                {num('outline', 'Outline', 0, 60, 'px', 'A line around the shape you paint, following it as you draw')}
                {(s.outline ?? 0) > 0 && choice('outlineColor', 'Outline colour', OUTLINE_COLORS)}
                {(s.outline ?? 0) > 0 && choice('outlineFill', 'Inside the outline', OUTLINE_FILLS)}
                {num('height', 'Height (3D paint)', 0, 1, '%', 'Thick paint: strokes look raised and catch the light')}
                <div className="studio-modes">
                  {RENDER_MODES.map((m) => (
                    <label key={m.id} className={`studio-mode${s.renderMode === m.id ? ' is-active' : ''}`}>
                      <input type="radio" name="render" checked={s.renderMode === m.id} onChange={() => set({ renderMode: m.id })} />
                      <b>{m.label}</b>
                      <span className="muted">{m.hint}</span>
                    </label>
                  ))}
                </div>
                {num('flow', 'Flow', 0.01, 1)}
                {num('wetEdges', 'Wet edges', 0, 1)}
                {num('burntEdges', 'Burnt edges', 0, 1)}
                {choice(
                  'blend',
                  'Blend mode',
                  BLEND_MODES.filter((b) => CANVAS_BLENDS.has(b.id)),
                )}
                {check('luminanceBlend', 'Luminance blending (mix colors in light)')}
                {num('alphaThreshold', 'Alpha threshold', 0, 1, '%', 'Solid pixels with no soft edge')}
              </>
            )}
            {page === 'Wet mix' && (
              <>
                <p className="muted studio-note">{UI.wetHint}</p>
                {num('dilution', 'Dilution', 0, 1, '%', 'More water, thinner paint')}
                {num('charge', 'Charge', 0, 1, '%', 'Paint on the brush; 100% never runs out')}
                {num('attack', 'Attack', 0, 1, '%', 'How strongly paint sticks')}
                {num('pull', 'Pull', 0, 1, '%', 'Drags the colors underneath')}
                {num('grade', 'Grade', 0, 1, '%', 'Deeper color where paint overlaps')}
                {num('wetBlur', 'Blur', 0, 1)}
                {choice('smudgeMode', 'With the Smudge tool', [
                  { id: 'drag', label: 'Drag colour along' },
                  { id: 'blur', label: 'Blur what is underneath' },
                ])}
                {num('wetJitter', 'Wetness jitter', 0, 1)}
              </>
            )}
            {page === 'Color dynamics' && (
              <>
                <h5 className="studio-sub">Each stamp</h5>
                {num('hueJitter', 'Hue', 0, 1)}
                {num('satJitter', 'Saturation', 0, 1)}
                {num('brightJitter', 'Brightness', 0, 1)}
                <h5 className="studio-sub">Each stroke</h5>
                {num('strokeHueJitter', 'Hue', 0, 1)}
                {num('strokeSatJitter', 'Saturation', 0, 1)}
                {num('strokeBrightJitter', 'Brightness', 0, 1)}
                <h5 className="studio-sub">Light pressure changes</h5>
                {num('pressureHue', 'Hue', -1, 1)}
                {num('pressureSat', 'Saturation', -1, 1)}
                {num('pressureBright', 'Brightness', -1, 1)}
                <h5 className="studio-sub">Tilting changes</h5>
                {num('tiltHue', 'Hue', -1, 1)}
                {num('tiltSat', 'Saturation', -1, 1)}
                {num('tiltBright', 'Brightness', -1, 1)}
              </>
            )}
            {page === 'Dynamics' && (
              <>
                <h5 className="studio-sub">Speed</h5>
                {num('speedSize', 'Size', -1, 1, '%', 'Faster strokes get bigger (+) or thinner (−)')}
                {num('speedOpacity', 'Opacity', -1, 1)}
                {curve('speedCurve', 'Speed')}
                <h5 className="studio-sub">Jitter</h5>
                {num('sizeJitter', 'Size', 0, 1)}
                {num('opacityJitter', 'Opacity', 0, 1)}
              </>
            )}
            {page === 'Pen' && (
              <>
                <h5 className="studio-sub">Pressure</h5>
                {num('pressureSize', 'Size', 0, 1)}
                {num('pressureOpacity', 'Opacity', 0, 1)}
                {curve('pressureCurve', 'Pressure')}
                <h5 className="studio-sub">Tilt</h5>
                {num('tiltAngle', 'Starts at', 0, 80, '°')}
                {num('tiltSize', 'Size', 0, 1)}
                {num('tiltOpacity', 'Opacity', 0, 1)}
                {curve('tiltCurve', 'Tilt')}
              </>
            )}
            {page === 'Properties' && (
              <>
                <Row label={UI.name}>
                  <input className="input" value={draft.name} onChange={(e) => setDef({ name: e.target.value }, 'name')} />
                </Row>
                {check('stampPreview', 'Show as one stamp in the library')}
                {num('size', 'Size', s.minSize, s.maxSize, 'px')}
                {num('minSize', 'Smallest size', 0.5, 2000, 'px')}
                {num('maxSize', 'Largest size', 1, 2000, 'px')}
                {num('opacity', 'Opacity', s.minOpacity, s.maxOpacity)}
                {num('minOpacity', 'Lowest opacity', 0, 1)}
                {num('maxOpacity', 'Highest opacity', 0.01, 1)}
                <Row label={UI.presets}>
                  <div className="studio-presets">
                    {s.sizePresets.map((p, i) => (
                      <input
                        key={i}
                        className="input"
                        type="number"
                        min={0}
                        value={p ?? ''}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          set({ sizePresets: s.sizePresets.map((q, j) => (j === i ? (v > 0 ? v : null) : q)) }, `preset${i}`)
                        }}
                      />
                    ))}
                  </div>
                </Row>
              </>
            )}
            {page === 'Dual brush' && <DualPage draft={draft} onChange={(p) => setDef(p)} onEdit={setTarget} />}
            {page === 'About this brush' && <AboutPage draft={draft} onChange={setDef} />}
          </div>
          <DrawingPad brush={draft} color={color} />
        </div>
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {UI.cancel}
          </button>
          <button className="btn btn-primary" onClick={done}>
            {UI.done}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function DualPage({ draft, onChange, onEdit }: { draft: BrushDef; onChange: (p: Partial<BrushDef>) => void; onEdit: (t: 'main' | 'second') => void }) {
  const brushes = useBrushLibrary((s) => s.brushes)
  const pick = (
    <Row label={UI.pickDual}>
      <select
        className="input"
        value=""
        onChange={(e) => {
          const b = brushes.find((x) => x.id === e.target.value)
          if (b) onChange({ dual: { ...settingsOf(b), dual: null } })
        }}
      >
        <option value="">{UI.choose}</option>
        {brushes.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </Row>
  )
  if (!draft.dual)
    return (
      <>
        <p className="muted studio-note">{UI.noDual}</p>
        <div className="studio-target">
          <button className="btn" onClick={() => onChange({ dual: { ...settingsOf(draft), dual: null, shape: 'splatter', shapeImage: null, scatter: 0.4, rotation: 'random' } })}>
            {UI.addDual}
          </button>
        </div>
        {pick}
      </>
    )
  return (
    <>
      <p className="muted studio-note">{UI.noDual}</p>
      <div className="studio-target">
        <span className="muted">{UI.editing}</span>
        <button className="btn btn-small" onClick={() => onEdit('main')}>
          {UI.main}
        </button>
        <button className="btn btn-small" onClick={() => onEdit('second')}>
          {UI.second}
        </button>
      </div>
      <Row label={UI.combine}>
        <select className="input" value={draft.dualMode} onChange={(e) => onChange({ dualMode: e.target.value as BrushDef['dualMode'] })}>
          {DUAL_MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </Row>
      <NumberRow label={UI.dualSize} value={draft.dualScale} min={0.05} max={4} unit="x" onChange={(v) => onChange({ dualScale: v })} />
      {pick}
      <div className="studio-target">
        <button className="btn btn-ghost" onClick={() => onChange({ dual: null })}>
          <Trash2 size={14} /> {UI.removeDual}
        </button>
      </div>
    </>
  )
}

function AboutPage({ draft, onChange }: { draft: BrushDef; onChange: (p: Partial<BrushDef>, key?: string) => void }) {
  const points = draft.resetPoints ?? []
  const restore = (settings: BrushSettings) => onChange({ ...normalizeSettings(settings) })
  return (
    <>
      <Row label={UI.name}>
        <input className="input" value={draft.name} onChange={(e) => onChange({ name: e.target.value }, 'name')} />
      </Row>
      <Row label={UI.author}>
        <input className="input" value={draft.author ?? ''} onChange={(e) => onChange({ author: e.target.value }, 'author')} />
      </Row>
      {draft.createdAt && (
        <Row label={UI.created}>
          <span>{new Date(draft.createdAt).toLocaleDateString()}</span>
        </Row>
      )}
      <Row label={UI.signature}>
        <Signature value={draft.signature ?? null} onChange={(signature) => onChange({ signature }, 'signature')} />
      </Row>
      <h5 className="studio-sub">{UI.resetPoints}</h5>
      <p className="muted studio-note">{UI.resetHint}</p>
      {points.map((r) => (
        <div key={r.id} className="studio-reset">
          <span>
            {r.name} <span className="muted">{new Date(r.createdAt).toLocaleString()}</span>
          </span>
          <button className="btn btn-small" onClick={() => restore(r.settings)}>
            <RotateCcw size={13} /> {UI.goBack}
          </button>
          <button className="icon-btn" title={UI.deletePoint} onClick={() => onChange({ resetPoints: points.filter((x) => x.id !== r.id) })}>
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <div className="studio-target">
        <button
          className="btn"
          onClick={async () => {
            const name = (await promptDialog(UI.resetName, `Version ${points.length + 1}`))?.trim()
            if (name) onChange({ resetPoints: [...points, { id: newId(), name, createdAt: Date.now(), settings: settingsOf(draft) }] })
          }}
        >
          {UI.saveReset}
        </button>
        {draft.builtIn && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              const orig = builtInBrush(draft.id)
              if (orig) restore(orig)
            }}
          >
            <RotateCcw size={14} /> {UI.original}
          </button>
        )}
      </div>
    </>
  )
}

/** A small pad to sign the brush. */
function Signature({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const last = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const c = ref.current!
    const g = c.getContext('2d')!
    g.clearRect(0, 0, c.width, c.height)
    if (!value) return
    const img = new Image()
    img.onload = () => g.drawImage(img, 0, 0)
    img.src = value
  }, [value])
  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * ref.current!.width, y: ((e.clientY - r.top) / r.height) * ref.current!.height }
  }
  return (
    <div className="studio-signature">
      <canvas
        ref={ref}
        width={260}
        height={70}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          last.current = at(e)
        }}
        onPointerMove={(e) => {
          if (!last.current) return
          const p = at(e)
          const g = ref.current!.getContext('2d')!
          g.strokeStyle = getComputedStyle(ref.current!).color
          g.lineWidth = 2
          g.lineCap = 'round'
          g.beginPath()
          g.moveTo(last.current.x, last.current.y)
          g.lineTo(p.x, p.y)
          g.stroke()
          last.current = p
        }}
        onPointerUp={() => {
          last.current = null
          onChange(ref.current!.toDataURL('image/png'))
        }}
      />
      <button className="btn btn-ghost btn-small" onClick={() => onChange(null)}>
        {UI.clearSig}
      </button>
    </div>
  )
}

type Unit = '%' | 'px' | '°' | 'x' | 'n'

/** A ribbon's cap image: pick a file (see-through PNGs keep their shape and shading) or remove it. */
function CapRow({ label, value, onChange }: { label: string; value: string | null | undefined; onChange: (v: string | null) => void }) {
  const file = useRef<HTMLInputElement>(null)
  return (
    <Row label={label} hint="Drawn on that end of the ribbon, turned along the stroke, as tall as the ribbon is wide">
      {value && <img src={value} alt="" className="studio-cap" />}
      <button className="btn btn-small" onClick={() => file.current?.click()}>
        {value ? 'Change…' : 'Choose an image…'}
      </button>
      {value && (
        <button className="btn btn-small" onClick={() => onChange(null)}>
          Remove
        </button>
      )}
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void blobToMask(f).then((url) => url && onChange(url))
        }}
      />
    </Row>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="studio-row" title={hint}>
      <span>{label}</span>
      {children}
    </div>
  )
}

/** A slider with an exact number box. Percent values are shown 0..100. */
function NumberRow(p: { label: string; hint?: string; value: number; min: number; max: number; unit: Unit; onChange: (v: number) => void }) {
  const { label, hint, value, min, max, unit, onChange } = p
  const k = unit === '%' ? 100 : 1
  const step = unit === '%' ? 0.01 : unit === 'x' ? 0.05 : unit === 'px' && max <= 50 ? 0.5 : 1
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  // Size-like ranges use a log slider so small values are easy to set.
  const log = unit === 'px' && max / Math.max(min, 0.5) > 50
  const lo = log ? Math.max(min, 0.5) : min
  const toSlider = (v: number) => (log ? Math.log(Math.max(v, 0.5)) : v)
  const fromSlider = (v: number) => (log ? Math.round(Math.exp(v) * 10) / 10 : v)
  return (
    <div className="studio-row" title={hint}>
      <span>{label}</span>
      <input type="range" min={toSlider(lo)} max={toSlider(max)} step={log ? 0.01 : step} value={toSlider(value)} onChange={(e) => onChange(clamp(fromSlider(Number(e.target.value))))} />
      <span className="studio-num">
        <input
          className="input"
          type="number"
          value={Math.round(value * k * 10) / 10}
          step={unit === '%' ? 1 : step}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (e.target.value !== '' && Number.isFinite(v)) onChange(clamp(v / k))
          }}
        />
        <span className="muted">{unit === 'n' ? '' : unit}</span>
      </span>
    </div>
  )
}
