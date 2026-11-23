import { useState } from 'react'
import { BringToFront, Check, ChevronDown, ChevronUp, ClipboardCopy, ClipboardPaste, FlipHorizontal2, FlipVertical2, Hand, Layers2, Magnet, Maximize, Pin, PinOff, RotateCcw, RotateCw, Undo2, X } from 'lucide-react'
import { localized } from '../i18n'
import type { Interpolation } from './meshRender'
import type { SketchLayer } from './model'
import { rotation, type Shape3d } from './model3d'
import { spotPos } from './mold'
import { mapPoint, outerBounds } from './transform'
import { coarsePointer, type Transformer, type XfMode } from './transformer'
import './layers.css'

const EN = {
  modes: {
    free: 'Freeform',
    uniform: 'Uniform',
    distort: 'Distort',
    warp: 'Warp',
    turn: 'Rotate object',
    mold: 'Mold object',
  } as Record<XfMode, string>,
  modeHints: {
    free: 'Stretch freely; Shift keeps the shape',
    uniform: 'Scale keeping the shape',
    distort: 'Move each corner on its own',
    warp: 'Bend the picture with a mesh',
    turn: 'Turn the drawing as a 3D shape: drag around it to turn, drag the object to move it, or use the sliders',
    mold: 'Pin what should stay, then drag anywhere on the drawing: it bends and keeps its shape',
  } as Record<XfMode, string>,
  turnX: 'Tilt',
  turnXHelp: 'Tilt forward or back (around the across axis, X)',
  turnY: 'Turn',
  turnYHelp: 'Turn left or right (around the up axis, Y)',
  turnZ: 'Spin',
  turnZHelp: 'Spin flat (around the view axis, Z)',
  depth: 'Perspective',
  depthHelp: 'How much nearer parts grow: none is flat, full is a close camera',
  turnNote: 'The drawing becomes a 3D shape from its outline. Sides it cannot see are guessed: the edges stretch around, and the back shows what you pick under Back.',
  thick: 'Thickness',
  thickHelp: 'How thick the 3D shape is: 0 is a flat card',
  bevel: 'Edge width',
  bevelHelp: 'How far in the edge slopes or curves: small is cut out with straight sides, 100% is puffed all the way like a pillow',
  round: 'Roundness',
  roundHelp: 'How the edge rises: 0 a straight slope (a bevel), 100% a round curve',
  light: 'Light',
  lightHelp: 'How strong the shading is, so the shape reads as 3D (0 is no shading)',
  lightAngle: 'Light from',
  lightAngleHelp: 'Where the light comes from on the screen: 0° right, 90° below, 180° left, 270° above (225° is top left)',
  lightColor: 'Light colour',
  back: 'Back',
  backHelp: 'What the back of the object shows when you turn it around',
  backModes: { mirror: 'Front, mirrored', color: 'One colour', layer: 'A layer' } as Record<Shape3d['back']['mode'], string>,
  backColor: 'Colour of the back',
  backLayer: 'The layer painted as the back, as seen from behind (it is read mirrored)',
  pickLayer: 'Pick a layer',
  no3d: 'This computer can’t show 3D here (no WebGL2), so the drawing turns as a flat card.',
  collapse: 'Hide the settings (the bar gets small)',
  expand: 'Show the settings',
  again: 'Click the 3D object to turn it again with the settings it had. To turn something else on this layer, select it first.',
  grid: 'Points',
  gridHelp: 'How fine the mesh is: more points bend smaller parts on their own (your bend and pins stay)',
  reach: 'Reach',
  reachHelp: 'How far away other points still follow the one you drag',
  keep: 'Keep shape',
  keepHelp: 'Bend like a puppet: pin what should stay (hip, shoulder), drag the rest; pieces turn instead of stretching. Off: nearby points simply follow by Reach and Follow.',
  moldTools: {
    drag: 'Drag anywhere on the drawing. Alt-click places or takes off a pin, Shift-click picks pins to move together',
    pin: 'Click anywhere to place a pin, click a pin to take it off; pinned spots stay put',
    front: 'Paint over a part to bring it to the front where it overlaps; Alt paints it to the back',
  },
  moldToolNames: { drag: 'Drag', pin: 'Pin', front: 'Front' },
  clearPins: 'Take all pins off',
  clearDepth: 'Put every part back to the same level',
  turnPins: 'Turn the picked pins about their middle instead of moving them',
  turnPinsName: 'Turn',
  picked: (n: number) => `${n} pins picked`,
  copyPose: 'Copy this bend, to put on another drawing (the next animation frame)',
  pastePose: 'Bend this drawing like the copied pose (works best on drawings of the same size)',
  pull: 'Follow',
  pullHelp: 'How strongly the other points follow: 0 only the dragged point moves',
  flipX: 'Flip horizontally',
  flipY: 'Flip vertically',
  rotate: 'Rotate 45°',
  fit: 'Fit to the canvas',
  reset: 'Reset',
  snapping: 'Snapping: edges and centre stick to the canvas',
  distance: 'Distance',
  magnetics: 'Magnetics: moves keep to 45°, turns to 15° (or hold Shift)',
  interp: {
    nearest: 'Nearest (crisp pixels)',
    bilinear: 'Bilinear (smooth)',
    bicubic: 'Bicubic (sharp and smooth)',
  } as Record<Interpolation, string>,
  done: 'Done (Enter)',
  doneShort: 'Done',
  cancel: 'Cancel (Esc)',
  hint: 'Drag inside to move, handles to scale, the round handle to turn.',
}

const UI = localized(EN, {
  modes: { free: 'Frei', uniform: 'Gleichmäßig', distort: 'Verzerren', warp: 'Verbiegen', turn: 'Objekt drehen', mold: 'Objekt formen' },
  modeHints: {
    free: 'Frei strecken; Umschalt behält die Form',
    uniform: 'Skalieren, die Form bleibt',
    distort: 'Jede Ecke einzeln bewegen',
    warp: 'Das Bild mit einem Gitter verbiegen',
    turn: 'Die Zeichnung als 3D-Form drehen: um sie herum ziehen dreht, das Objekt ziehen verschiebt es, oder die Regler nutzen',
    mold: 'Pinne fest, was bleiben soll, dann zieh irgendwo an der Zeichnung: sie biegt sich und behält ihre Form',
  },
  turnX: 'Kippen',
  turnXHelp: 'Nach vorn oder hinten kippen (um die Querachse, X)',
  turnY: 'Drehen',
  turnYHelp: 'Nach links oder rechts drehen (um die Hochachse, Y)',
  turnZ: 'Rollen',
  turnZHelp: 'Flach rollen (um die Blickachse, Z)',
  depth: 'Perspektive',
  depthHelp: 'Wie stark nähere Teile wachsen: keine ist flach, voll ist eine nahe Kamera',
  turnNote: 'Die Zeichnung wird aus ihrem Umriss zu einer 3D-Form. Seiten, die sie nicht zeigt, werden geraten: die Ränder ziehen sich herum, und die Rückseite zeigt, was du unter Rückseite wählst.',
  thick: 'Dicke',
  thickHelp: 'Wie dick die 3D-Form ist: 0 ist eine flache Karte',
  bevel: 'Randbreite',
  bevelHelp: 'Wie weit nach innen der Rand schräg oder rund ist: klein ist ausgeschnitten mit geraden Seiten, 100 % ist ganz aufgepolstert wie ein Kissen',
  round: 'Rundung',
  roundHelp: 'Wie der Rand ansteigt: 0 eine gerade Schräge (Fase), 100 % eine runde Kurve',
  light: 'Licht',
  lightHelp: 'Wie stark die Schattierung ist, damit die Form nach 3D aussieht (0 ist keine)',
  lightAngle: 'Licht von',
  lightAngleHelp: 'Woher das Licht auf dem Bildschirm kommt: 0° rechts, 90° unten, 180° links, 270° oben (225° ist oben links)',
  lightColor: 'Lichtfarbe',
  back: 'Rückseite',
  backHelp: 'Was die Rückseite des Objekts zeigt, wenn du es umdrehst',
  backModes: { mirror: 'Vorderseite, gespiegelt', color: 'Eine Farbe', layer: 'Eine Ebene' },
  backColor: 'Farbe der Rückseite',
  backLayer: 'Die Ebene, die als Rückseite gemalt ist, so wie von hinten gesehen (sie wird gespiegelt gelesen)',
  pickLayer: 'Ebene wählen',
  no3d: 'Dieser Computer kann hier kein 3D zeigen (kein WebGL2), deshalb dreht sich die Zeichnung als flache Karte.',
  collapse: 'Einstellungen ausblenden (die Leiste wird klein)',
  expand: 'Einstellungen zeigen',
  again: 'Klick auf das 3D-Objekt, um es mit seinen Einstellungen weiter zu drehen. Um etwas anderes auf dieser Ebene zu drehen, wähle es zuerst aus.',
  grid: 'Punkte',
  gridHelp: 'Wie fein das Gitter ist: mehr Punkte biegen kleinere Teile einzeln (deine Biegung und Pins bleiben)',
  reach: 'Reichweite',
  reachHelp: 'Wie weit entfernte Punkte dem gezogenen noch folgen',
  keep: 'Form halten',
  keepHelp: 'Wie eine Puppe biegen: pinne fest, was bleiben soll (Hüfte, Schulter), zieh den Rest; Teile drehen sich statt sich zu dehnen. Aus: Punkte in der Nähe folgen einfach nach Reichweite und Folgen.',
  moldTools: {
    drag: 'Irgendwo an der Zeichnung ziehen. Alt-Klick setzt oder entfernt einen Pin, Umschalt-Klick wählt Pins, die sich zusammen bewegen',
    pin: 'Irgendwo klicken setzt einen Pin, Klick auf einen Pin entfernt ihn; gepinnte Stellen bleiben, wo sie sind',
    front: 'Über einen Teil malen holt ihn nach vorn, wo er überlappt; mit Alt nach hinten',
  },
  moldToolNames: { drag: 'Ziehen', pin: 'Pin', front: 'Vorne' },
  clearPins: 'Alle Pins entfernen',
  clearDepth: 'Alle Teile wieder auf eine Ebene',
  turnPins: 'Die gewählten Pins um ihre Mitte drehen statt sie zu bewegen',
  turnPinsName: 'Drehen',
  picked: (n: number) => `${n} Pins gewählt`,
  copyPose: 'Diese Biegung kopieren, für eine andere Zeichnung (das nächste Animationsbild)',
  pastePose: 'Diese Zeichnung wie die kopierte Pose biegen (am besten bei Zeichnungen gleicher Größe)',
  pull: 'Folgen',
  pullHelp: 'Wie stark die anderen Punkte folgen: 0 bewegt nur den gezogenen Punkt',
  flipX: 'Waagrecht spiegeln',
  flipY: 'Senkrecht spiegeln',
  rotate: 'Um 45° drehen',
  fit: 'An die Leinwand anpassen',
  reset: 'Zurücksetzen',
  snapping: 'Einrasten: Ränder und Mitte haften an der Leinwand',
  distance: 'Abstand',
  magnetics: 'Magnetisch: Bewegen in 45°-Schritten, Drehen in 15° (oder Umschalt halten)',
  interp: { nearest: 'Nächster (scharfe Pixel)', bilinear: 'Bilinear (weich)', bicubic: 'Bikubisch (scharf und weich)' },
  done: 'Fertig (Enter)',
  doneShort: 'Fertig',
  cancel: 'Abbrechen (Esc)',
  hint: 'Innen ziehen zum Bewegen, Griffe zum Skalieren, der runde Griff zum Drehen.',
})

const COLLAPSE_KEY = 'egd.sketch.xfCollapsed'

/** The Move tool's own modes; Rotate object and Mold object are tools of their own. */
const MOVE_MODES: XfMode[] = ['free', 'uniform', 'distort', 'warp']

/** The bar shown while transforming. */
export function TransformBar({ xf, layers = [], onDone, onCancel }: { xf: Transformer; layers?: SketchLayer[]; onDone(): void; onCancel(): void }) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })
  if (!xf.active) return null
  const toggle = () => {
    setCollapsed(!collapsed)
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '0' : '1')
    } catch {
      // ignore
    }
  }
  const turn = xf.mode === 'turn'
  const flat = turn && !xf.can3d
  // A change that isn't a slider drag (a colour, a pick): one undo step.
  const shape = (p: Partial<Shape3d>) => {
    xf.mark()
    xf.setShape(p)
  }
  const backLayers = layers.filter((l) => !l.kind && !l.text)
  // Molding only needs its own controls; flip, fit, snapping and magnetics stay with Move.
  const m = xf.mode === 'mold' ? xf.state?.mold : null
  return (
    <div className="sketch-selbar sketch-xfbar" title={UI.hint} onPointerDown={(e) => e.stopPropagation()}>
      {xf.mode === 'turn' || xf.mode === 'mold' ? (
        <span className="sketch-xf-title" title={UI.modeHints[xf.mode]}>
          {UI.modes[xf.mode]}
        </span>
      ) : (
        MOVE_MODES.map((m) => (
          <button key={m} className={`btn btn-ghost sketch-small${xf.mode === m ? ' is-active' : ''}`} title={UI.modeHints[m]} onClick={() => xf.patch({ mode: m })}>
            {UI.modes[m]}
          </button>
        ))
      )}
      {(turn || xf.mode === 'mold') && (
        <button className="icon-btn sketch-tool" title={collapsed ? UI.expand : UI.collapse} aria-label={collapsed ? UI.expand : UI.collapse} aria-expanded={!collapsed} onClick={toggle}>
          {collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
        </button>
      )}
      {flat && <span className="sketch-xf-hint">{UI.no3d}</span>}
      {turn && !collapsed && (
        <span className="sketch-xf-extra" title={UI.turnNote}>
          <Slider label={UI.turnX} help={UI.turnXHelp} min={-180} max={180} value={xf.turn.x} unit="°" xf={xf} onChange={(x) => xf.setTurn({ x })} />
          <Slider label={UI.turnY} help={UI.turnYHelp} min={-180} max={180} value={xf.turn.y} unit="°" xf={xf} onChange={(y) => xf.setTurn({ y })} />
          <Slider label={UI.turnZ} help={UI.turnZHelp} min={-180} max={180} value={xf.turn.z} unit="°" xf={xf} onChange={(z) => xf.setTurn({ z })} />
          <Slider label={UI.depth} help={UI.depthHelp} min={0} max={100} value={Math.round(xf.turn.depth * 100)} unit="%" xf={xf} onChange={(d) => xf.setTurn({ depth: d / 100 })} />
          {!flat && (
            <>
              <Slider label={UI.thick} help={UI.thickHelp} min={0} max={100} value={Math.round(xf.shape.thick * 100)} unit="%" xf={xf} onChange={(v) => xf.setShape({ thick: v / 100 })} />
              <Slider label={UI.bevel} help={UI.bevelHelp} min={2} max={100} value={Math.round(xf.shape.bevel * 100)} unit="%" xf={xf} onChange={(v) => xf.setShape({ bevel: v / 100 })} />
              <Slider label={UI.round} help={UI.roundHelp} min={0} max={100} value={Math.round(xf.shape.round * 100)} unit="%" xf={xf} onChange={(v) => xf.setShape({ round: v / 100 })} />
              <Slider label={UI.light} help={UI.lightHelp} min={0} max={100} value={Math.round(xf.shape.light * 100)} unit="%" xf={xf} onChange={(v) => xf.setShape({ light: v / 100 })} />
              <Slider label={UI.lightAngle} help={UI.lightAngleHelp} min={0} max={359} value={xf.shape.lightAngle} unit="°" xf={xf} onChange={(lightAngle) => xf.setShape({ lightAngle })} />
              <input type="color" className="sketch-xf-color" title={UI.lightColor} aria-label={UI.lightColor} value={xf.shape.lightColor} onChange={(e) => shape({ lightColor: e.target.value })} />
              <label className="sketch-selbar-slider" title={UI.backHelp}>
                {UI.back}
                <select className="input sketch-xf-interp" value={xf.shape.back.mode} onChange={(e) => shape({ back: { ...xf.shape.back, mode: e.target.value as Shape3d['back']['mode'] } })}>
                  {(Object.keys(UI.backModes) as Shape3d['back']['mode'][]).map((k) => (
                    <option key={k} value={k}>
                      {UI.backModes[k]}
                    </option>
                  ))}
                </select>
              </label>
              {xf.shape.back.mode === 'color' && <input type="color" className="sketch-xf-color" title={UI.backColor} aria-label={UI.backColor} value={xf.shape.back.color} onChange={(e) => shape({ back: { ...xf.shape.back, color: e.target.value } })} />}
              {xf.shape.back.mode === 'layer' && (
                <select className="input sketch-xf-interp" title={UI.backLayer} aria-label={UI.backLayer} value={xf.shape.back.layerId ?? ''} onChange={(e) => shape({ back: { ...xf.shape.back, layerId: e.target.value || null } })}>
                  <option value="">{UI.pickLayer}</option>
                  {backLayers.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
        </span>
      )}
      {xf.mode === 'mold' && m && !collapsed && (
        <span className="sketch-xf-extra">
          <Slider label={UI.grid} help={UI.gridHelp} min={2} max={48} value={xf.moldGrid} xf={xf} onChange={(n) => xf.setMoldGrid(n)} noMark />
          {(['drag', 'pin', 'front'] as const).map((t) => (
            <button key={t} className={`btn btn-ghost sketch-small${xf.moldTool === t ? ' is-active' : ''}`} title={UI.moldTools[t]} aria-pressed={xf.moldTool === t} onClick={() => xf.patch({ moldTool: t })}>
              {t === 'pin' ? <Pin size={13} /> : t === 'front' ? <BringToFront size={13} /> : <Hand size={13} />} {UI.moldToolNames[t]}
            </button>
          ))}
          <button className="icon-btn sketch-tool" title={UI.clearPins} aria-label={UI.clearPins} disabled={!m.pins.length} onClick={() => xf.clearPins()}>
            <PinOff size={15} />
          </button>
          <button className="icon-btn sketch-tool" title={UI.clearDepth} aria-label={UI.clearDepth} disabled={!m.depth.some(Boolean)} onClick={() => xf.clearDepth()}>
            <Layers2 size={15} />
          </button>
          {m.sel.length > 1 && (
            <button className={`btn btn-ghost sketch-small${xf.moldTurn ? ' is-active' : ''}`} title={UI.turnPins} aria-pressed={xf.moldTurn} onClick={() => xf.patch({ moldTurn: !xf.moldTurn })}>
              <RotateCcw size={13} /> {UI.turnPinsName} <span className="sketch-xf-num">{UI.picked(m.sel.length)}</span>
            </button>
          )}
          <button className={`btn btn-ghost sketch-small${xf.moldKeep ? ' is-active' : ''}`} title={UI.keepHelp} aria-pressed={xf.moldKeep} onClick={() => xf.patch({ moldKeep: !xf.moldKeep })}>
            {UI.keep}
          </button>
          {!xf.moldKeep && (
            <>
              <Slider label={UI.reach} help={UI.reachHelp} min={0} max={1000} value={xf.moldReach} unit="px" xf={xf} onChange={(moldReach) => xf.patch({ moldReach })} noMark />
              <Slider label={UI.pull} help={UI.pullHelp} min={0} max={100} value={Math.round(xf.moldPull * 100)} unit="%" xf={xf} onChange={(p) => xf.patch({ moldPull: p / 100 })} noMark />
            </>
          )}
          <span className="sketch-sep" />
          <button className="icon-btn sketch-tool" title={UI.copyPose} aria-label={UI.copyPose} onClick={() => xf.copyPose()}>
            <ClipboardCopy size={15} />
          </button>
          <button className="icon-btn sketch-tool" title={UI.pastePose} aria-label={UI.pastePose} disabled={!xf.pose} onClick={() => xf.pastePose()}>
            <ClipboardPaste size={15} />
          </button>
        </span>
      )}
      {!m && (
        <>
      <span className="sketch-sep" />
      <button className="icon-btn sketch-tool" title={UI.flipX} aria-label={UI.flipX} onClick={() => xf.flip('x')}>
        <FlipVertical2 size={15} />
      </button>
      <button className="icon-btn sketch-tool" title={UI.flipY} aria-label={UI.flipY} onClick={() => xf.flip('y')}>
        <FlipHorizontal2 size={15} />
      </button>
      {!turn && (
        <button className="icon-btn sketch-tool" title={UI.rotate} aria-label={UI.rotate} onClick={() => xf.rotate45()}>
          <RotateCw size={15} />
        </button>
      )}
      <button className="icon-btn sketch-tool" title={UI.fit} aria-label={UI.fit} onClick={() => xf.fit()}>
        <Maximize size={15} />
      </button>
        </>
      )}
      <button className="icon-btn sketch-tool" title={UI.reset} aria-label={UI.reset} onClick={() => xf.resetShape()}>
        <Undo2 size={15} />
      </button>
      {!m && (
        <>
      <span className="sketch-sep" />
      {!turn && (
        <label className="sketch-selbar-slider" title={UI.snapping}>
          <input type="checkbox" checked={xf.snapping} onChange={(e) => xf.patch({ snapping: e.target.checked })} />
          {UI.distance}
          <input type="range" min={2} max={40} value={xf.snapDistance} disabled={!xf.snapping} onChange={(e) => xf.patch({ snapDistance: Number(e.target.value) })} />
        </label>
      )}
      <button className={`icon-btn sketch-tool${xf.magnetics ? ' is-active' : ''}`} title={UI.magnetics} aria-label={UI.magnetics} aria-pressed={xf.magnetics} onClick={() => xf.patch({ magnetics: !xf.magnetics })}>
        <Magnet size={15} />
      </button>
        </>
      )}
      {(!turn || flat) && (
        <select className="input sketch-xf-interp" value={xf.interp} onChange={(e) => xf.patch({ interp: e.target.value as Interpolation })}>
          {(Object.keys(UI.interp) as Interpolation[]).map((k) => (
            <option key={k} value={k}>
              {UI.interp[k]}
            </option>
          ))}
        </select>
      )}
      <button className="btn btn-ghost sketch-small" title={UI.cancel} onClick={onCancel}>
        <X size={13} />
      </button>
      <button className="btn btn-primary sketch-small" title={UI.done} onClick={onDone}>
        <Check size={13} /> {UI.doneShort}
      </button>
    </div>
  )
}

/** A labelled slider of the transform bar; starting to drag it makes one undo step (unless `noMark`). */
function Slider(p: { label: string; help: string; min: number; max: number; value: number; unit?: string; xf: Transformer; noMark?: boolean; onChange(v: number): void }) {
  return (
    <label className="sketch-selbar-slider" title={p.help}>
      {p.label}
      <input type="range" min={p.min} max={p.max} value={p.value} aria-label={p.label} onPointerDown={() => !p.noMark && p.xf.mark()} onKeyDown={() => !p.noMark && p.xf.mark()} onChange={(e) => p.onChange(Number(e.target.value))} />
      {/* Type an exact number; one undo step per visit to the box. */}
      <input
        type="number"
        className="input sketch-xf-num"
        min={p.min}
        max={p.max}
        value={Math.round(p.value)}
        aria-label={p.label}
        onFocus={() => !p.noMark && p.xf.mark()}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (e.target.value !== '' && Number.isFinite(n)) p.onChange(Math.min(p.max, Math.max(p.min, n)))
        }}
      />
      {p.unit && <span className="sketch-xf-unit">{p.unit}</span>}
    </label>
  )
}

/** Box, mesh, handles and snap guides, drawn in the editor's canvas-space SVG group. */
export function TransformOverlay({ xf, scale, width, height }: { xf: Transformer; scale: number; width: number; height: number }) {
  const s = xf.state
  if (!xf.active || !s) return null
  const line = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x},${p.y}`).join(' ')
  const curves: string[] = []
  const steps = s.warp || s.mold ? 24 : 1
  const lines = xf.mode === 'warp' ? [0, 1 / 3, 2 / 3, 1] : [0, 1]
  const m = xf.mode === 'mold' ? s.mold : null
  let meshPath = ''
  let frontPath = ''
  let backPath = ''
  if (m) {
    for (let t = 0; t < m.tris.length; t += 3) {
      const [a, b, c] = [m.pts[m.tris[t]], m.pts[m.tris[t + 1]], m.pts[m.tris[t + 2]]]
      const tri = `M${a.x} ${a.y}L${b.x} ${b.y}L${c.x} ${c.y}Z`
      meshPath += tri
      const d = m.depth[t / 3]
      if (d > 0) frontPath += tri
      else if (d < 0) backPath += tri
    }
  } else
    for (const t of lines) {
      curves.push(line(Array.from({ length: steps + 1 }, (_, i) => mapPoint(s, i / steps, t))))
      curves.push(line(Array.from({ length: steps + 1 }, (_, i) => mapPoint(s, t, i / steps))))
    }
  const r = (coarsePointer() ? 9 : 5) / scale
  if (xf.mode === 'turn') return <OrbitGizmo xf={xf} r={r} />
  const rot = xf.rotateHandle(scale)
  const top = mapPoint(s, 0.5, 0)
  return (
    <g className="sketch-xf">
      {xf.guides.gx.map((x) => (
        <line key={`x${x}`} x1={x} y1={0} x2={x} y2={height} className="sketch-xf-guide" />
      ))}
      {xf.guides.gy.map((y) => (
        <line key={`y${y}`} x1={0} y1={y} x2={width} y2={y} className="sketch-xf-guide" />
      ))}
      {curves.map((c, i) => (
        <polyline key={i} points={c} className="sketch-xf-line" />
      ))}
      {backPath && <path d={backPath} className="sketch-xf-back" />}
      {frontPath && <path d={frontPath} className="sketch-xf-front" />}
      {meshPath && <path d={meshPath} className="sketch-xf-line sketch-xf-mesh" />}
      {rot && <line x1={top.x} y1={top.y} x2={rot.x} y2={rot.y} className="sketch-xf-line" />}
      {rot && <circle cx={rot.x} cy={rot.y} r={r * 1.2} className="sketch-xf-rot" />}
      {m
        ? m.pins.map((pin, i) => {
            const p = spotPos(m, pin)
            return <circle key={i} cx={p.x} cy={p.y} r={r} className={m.sel.includes(i) ? 'sketch-xf-pin is-picked' : 'sketch-xf-pin'} />
          })
        : xf.handles().map((p, i) => <rect key={i} x={p.x - r} y={p.y - r} width={r * 2} height={r * 2} rx={xf.mode === 'warp' ? r : 1 / scale} className="sketch-xf-handle" />)}
    </g>
  )
}

/**
 * Rotate object's handle on the canvas: a ring around the object (drag around it to turn) and its three axes as they
 * are turned now (X across, Y up, Z towards you), instead of a flat box that would not match the 3D shape.
 */
function OrbitGizmo({ xf, r }: { xf: Transformer; r: number }) {
  const s = xf.state!
  const c = mapPoint(s, 0.5, 0.5)
  const b = outerBounds(s)
  const R = Math.max(b.w, b.h) * 0.6 + r * 4
  const m = rotation(xf.turn)
  const axis = (k: number, cls: string, sign = 1) => <line x1={c.x} y1={c.y} x2={c.x + m[k] * R * 0.45 * sign} y2={c.y + m[k + 1] * R * 0.45 * sign} className={`sketch-xf-axis ${cls}`} />
  return (
    <g className="sketch-xf">
      <circle cx={c.x} cy={c.y} r={R} className="sketch-xf-ring" />
      {axis(0, 'is-x')}
      {axis(3, 'is-y', -1)}
      {axis(6, 'is-z')}
      <circle cx={c.x} cy={c.y} r={r} className="sketch-xf-handle" />
    </g>
  )
}

/** The note shown while Rotate object is picked on a layer whose 3D object can be turned again. */
export function TurnAgainNote() {
  return <div className="sketch-selbar sketch-xf-again">{UI.again}</div>
}
