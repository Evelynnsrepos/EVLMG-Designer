import { ArrowLeft, ArrowRight, BookOpen, Brush, Clapperboard, Copy, Download, ImagePlus, LayoutGrid, Music, Pause, Play, Plus, Rows3, Settings2, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { importAssetFromBlob, pickAndImportAssets, resolveAssetPath, useAssetUrl } from '@/core/assets'
import { getFs } from '@/core/fs'
import type { Entity, Id } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { loadDocumentNow, updateDocument, useDocument, useIntentHandler, useProjectStore, useUndoRedoKeys, type Intent } from '@/core/state'
import { PresetHeader } from '@/shared/calculators'
import '@/shared/listDetail/listDetail.css'
import { createSketchDoc, newLayer } from '@/shared/sketch/model'
import { ProofTextarea } from '@/shared/spell'
import { Modal } from '@/shared/ui'
import { openComponent } from '@/shell/editor/actions'
import { ExportDialog } from './ExportDialog'
import {
  ASPECTS,
  CAMERA,
  createStoryboardDoc,
  cutLabel,
  formatTime,
  formatTimecode,
  FPS_CHOICES,
  aspectOf,
  fpsOf,
  isBlank,
  newFrame,
  numberFrames,
  parseTime,
  sceneLabel,
  SHOTS,
  STATUSES,
  TRANSITIONS,
  type Frame,
  type Numbered,
  type Status,
  type StoryboardDoc,
} from './model'
import { FromWriterDialog, WriterLinkBox } from './WriterLink'
import './storyboard.css'

/**
 * Storyboard (v0.10, studio board in v0.27): panels grouped into cuts and scenes, each with a picture (a file,
 * or a Draw drawing made for the panel that stays up to date), shot, camera, transition, time in seconds + frames,
 * action, dialogue, sound, notes, characters, status and a live link to the Writer script. Played as an animatic
 * with sound; exported as print sheets, shot list, script, pictures, video or Pitch Deck slides.
 *
 * Intents: `add-image` ({ path, name }) adds one panel with the picture; `add-frames` ({ frames: { path, name, seconds }[] })
 * adds several (Draw frames and pages, Pixel Art).
 */

const UI = {
  play: 'Play animatic',
  playHint: 'Plays from the selected panel with sound (Space)',
  stop: 'Stop',
  panel: 'Panel',
  panelHint: 'A new panel in the same cut, after the selected one',
  cut: 'Cut',
  cutHint: 'A new cut after the selected panel',
  scene: 'Scene',
  sceneHint: 'A new scene after the selected panel',
  board: 'Board',
  boardHint: 'Big picture, the strip and the selected panel',
  sheet: 'Sheet',
  sheetHint: 'Every panel in a row with its text next to it, like a paper storyboard',
  fromWriter: 'From Writer…',
  fromWriterHint: 'Make panels from a Writer script, one per heading or paragraph',
  export: 'Export…',
  settings: 'Board settings',
  stats: (scenes: number, cuts: number, panels: number) => `${scenes} scene${scenes === 1 ? '' : 's'} · ${cuts} cut${cuts === 1 ? '' : 's'} · ${panels} panel${panels === 1 ? '' : 's'}`,
  noPicture: 'No picture',
  addPicture: 'Add picture',
  changePicture: 'Change picture',
  draw: 'Draw this panel',
  drawHint: 'Opens Draw on a drawing made for this panel; the board shows it and updates when you draw',
  openDrawing: 'Open the drawing',
  unlinkDrawing: 'Stop using the drawing',
  sceneStart: 'Starts a new scene',
  sceneName: 'Scene name',
  sameCut: 'Same cut as the panel before',
  sameCutHint: 'Several panels for one cut: the camera keeps running, the drawings show what changes',
  shot: 'Shot',
  camera: 'Camera',
  transition: 'Into the next cut',
  time: 'Time',
  timeHint: (fps: number) => `Seconds + frames at ${fps} fps, e.g. 3+12. You can also type 36k (frames) or 2.5 (seconds).`,
  action: 'What happens',
  dialogue: 'Dialogue',
  sound: 'Sound and music',
  notes: 'Notes for the team',
  notesHint: 'Layout, effects, colour, timing, anything the next person needs',
  audio: 'Sound clip',
  audioHint: 'A voice line or sound that starts with this panel in the animatic',
  addAudio: 'Add sound',
  status: 'Status',
  noStatus: 'No status',
  characters: 'Characters',
  addCharacter: 'Add a character…',
  script: 'Script',
  earlier: 'Move earlier',
  later: 'Move later',
  duplicate: 'Duplicate',
  delete: 'Delete',
  aspect: 'Board shape',
  fps: 'Frames per second',
  safe: 'Show title-safe and action-safe lines',
  soundtrack: 'Music or voice track under the whole animatic',
  addSoundtrack: 'Add a track',
  remove: 'Remove',
  done: 'Done',
}

/** Frames for an `add-image` or `add-frames` intent; empty for anything else. */
function framesFromIntent(intent: Intent): Frame[] {
  const list = intent.action === 'add-image' ? [intent] : intent.action === 'add-frames' && Array.isArray(intent.frames) ? (intent.frames as Record<string, unknown>[]) : []
  return list.filter((f) => typeof f?.path === 'string').map((f) => newFrame({ image: f.path as string, seconds: typeof f.seconds === 'number' && f.seconds > 0 ? f.seconds : 3 }))
}

const ratio = (aspect: string) => aspect.replace(':', ' / ')

/** The picture a panel shows: its linked drawing (live), else its own picture. */
function PanelPicture({ frame, className, aspect }: { frame: Frame; className: string; aspect: string }) {
  const sketch = useDocument<{ sticker?: string | null; backgroundColor?: string | null } | null>('sketch', frame.sketchId ?? 'none', () => null)
  const fromSketch = frame.sketchId ? (sketch.data?.sticker ?? null) : null
  const url = useAssetUrl(fromSketch ?? frame.image)
  const style = { aspectRatio: ratio(aspect), background: fromSketch ? (sketch.data?.backgroundColor ?? '#ffffff') : undefined }
  return url ? (
    <img className={className} style={style} src={url} alt="" />
  ) : (
    <div className={`${className} sb-blank`} style={style}>
      {UI.noPicture}
    </div>
  )
}

/** Plays an audio asset while `playing`, starting `offset` seconds in. */
function AudioPlayer({ path, playing, offset }: { path: string; playing: boolean; offset: number }) {
  const url = useAssetUrl(path)
  const el = useRef<HTMLAudioElement>(null)
  const offsetRef = useRef(offset)
  useEffect(() => {
    offsetRef.current = offset
  })
  useEffect(() => {
    const a = el.current
    if (!a || !url) return
    if (playing) {
      a.currentTime = offsetRef.current
      void a.play().catch(() => {})
    } else a.pause()
  }, [playing, url])
  return url ? <audio ref={el} src={url} preload="auto" /> : null
}

function TimeInput({ seconds, fps, onChange }: { seconds: number; fps: number; onChange: (s: number) => void }) {
  const [text, setText] = useState<string | null>(null)
  const commit = () => {
    if (text === null) return
    const s = parseTime(text, fps)
    if (s !== null) onChange(s)
    setText(null)
  }
  return (
    <input
      className={`input sb-time${text !== null && parseTime(text, fps) === null ? ' sb-bad' : ''}`}
      value={text ?? formatTime(seconds, fps)}
      title={UI.timeHint(fps)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') {
          e.preventDefault()
          setText(null)
        }
      }}
    />
  )
}

function Select({ value, options, onChange, empty }: { value: string | undefined; options: readonly string[]; onChange: (v: string) => void; empty?: string }) {
  // Values from older boards (or typed elsewhere) stay pickable.
  const list = value && !options.includes(value) ? [value, ...options] : options
  return (
    <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      {empty !== undefined && <option value="">{empty}</option>}
      {list.map((s) => (
        <option key={s}>{s}</option>
      ))}
    </select>
  )
}

function Characters({ ids, onChange }: { ids: Id[]; onChange: (ids: Id[]) => void }) {
  const all = useProjectStore((s) => s.entities.character) as Entity[]
  const left = all.filter((c) => !ids.includes(c.id))
  return (
    <div className="sb-chips">
      {ids.map((id) => (
        <span key={id} className="sb-chip">
          {all.find((c) => c.id === id)?.name || 'Deleted character'}
          <button className="icon-btn" aria-label={UI.remove} onClick={() => onChange(ids.filter((x) => x !== id))}>
            <X size={11} />
          </button>
        </span>
      ))}
      {left.length > 0 && (
        <select className="input sb-chip-add" value="" onChange={(e) => e.target.value && onChange([...ids, e.target.value])}>
          <option value="">{UI.addCharacter}</option>
          {left.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || 'Untitled'}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

/** Copy an asset to a new file (a drawing's sticker is replaced on every save, so references keep their own copy). */
async function copyAsset(root: string, path: string, name: string) {
  try {
    const bytes = await getFs().readBinary(await resolveAssetPath(root, path))
    return (await importAssetFromBlob(root, new Blob([bytes as BlobPart], { type: 'image/png' }), 'image', name))?.path ?? null
  } catch {
    return null
  }
}

/** A picture scaled into w × h (Draw layers are canvas-sized), as a new asset. */
async function fittedCopy(root: string, path: string, w: number, h: number) {
  try {
    const bytes = await getFs().readBinary(await resolveAssetPath(root, path))
    const img = await createImageBitmap(new Blob([bytes as BlobPart]))
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const k = Math.min(w / img.width, h / img.height)
    c.getContext('2d')!.drawImage(img, (w - img.width * k) / 2, (h - img.height * k) / 2, img.width * k, img.height * k)
    img.close()
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
    return blob ? ((await importAssetFromBlob(root, blob, 'image', 'Panel picture.png'))?.path ?? null) : null
  } catch {
    return null
  }
}

/** The selected panel per board, so it stays when the panel moves in the layout (opening Draw next to it). */
const lastSelected = new Map<string, number>()

export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<StoryboardDoc>('storyboard', documentId!, createStoryboardDoc)
  useUndoRedoKeys(doc, active)
  const root = useProjectStore((s) => s.root)
  const title = useProjectStore((s) => s.meta?.documents.find((d) => d.id === documentId)?.title ?? 'Storyboard')
  const [sel, setSelState] = useState(() => lastSelected.get(documentId!) ?? 0)
  const setSel = (k: number) => {
    lastSelected.set(documentId!, k)
    setSelState(k)
  }
  const [playing, setPlaying] = useState<number | null>(null)
  const [playStart, setPlayStart] = useState(0)
  const [view, setView] = useState<'board' | 'sheet'>('board')
  const [dialog, setDialog] = useState<'writer' | 'export' | 'settings' | null>(null)
  const frames = useMemo(() => doc.data?.frames ?? [], [doc.data])
  const numbers = useMemo(() => numberFrames(frames), [frames])

  useIntentHandler(
    'storyboard',
    (intent) => {
      const added = framesFromIntent(intent)
      if (!added.length) return
      // Pictures sent from other tools go at the end; an untouched starting frame makes way for them.
      doc.update((d) => ({ ...d, frames: [...(d.frames.length === 1 && isBlank(d.frames[0]) ? [] : d.frames), ...added] }))
    },
    !!doc.data,
  )

  useEffect(() => {
    if (playing === null) return
    const f = frames[playing]
    const t = setTimeout(() => setPlaying(f && playing + 1 < frames.length ? playing + 1 : null), f ? f.seconds * 1000 : 0)
    return () => clearTimeout(t)
  }, [playing, frames])

  if (!doc.data) return null
  const data = doc.data
  const fps = fpsOf(data)
  const aspect = aspectOf(data).id
  const set = (fn: (f: Frame[]) => Frame[]) => doc.update((d) => ({ ...d, frames: fn(d.frames) }))
  const i = Math.min(sel, frames.length - 1)
  const f = frames[i]
  const n = numbers[i]
  const editAt = (id: Id, patch: Partial<Frame>) => set((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const edit = (patch: Partial<Frame>) => f && editAt(f.id, patch)
  const total = frames.reduce((s, x) => s + x.seconds, 0)
  const last = numbers.at(-1)

  const insert = (frame: Frame) => {
    set((list) => [...list.slice(0, i + 1), frame, ...list.slice(i + 1)])
    setSel(i + 1)
  }
  const move = (by: number) => {
    const j = i + by
    if (j < 0 || j >= frames.length) return
    set((list) => {
      const next = [...list]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
    setSel(j)
  }
  const play = () => {
    if (playing !== null) return setPlaying(null)
    if (!frames.length) return
    setPlayStart(numbers[i]?.start ?? 0)
    setPlaying(i)
  }

  const drawPanel = async () => {
    if (!root || !f || !n) return
    const store = useProjectStore.getState()
    if (f.sketchId && store.meta?.documents.some((d) => d.id === f.sketchId)) return openComponent('sketch', f.sketchId)
    const a = aspectOf(data)
    const ref = store.addDocument('sketch', `${title} ${sceneLabel(n)} ${cutLabel(n)}`)
    // The panel's picture becomes the bottom layer to draw over; the panel before floats next to the canvas.
    const prev = frames[i - 1]
    const refs: string[] = []
    if (prev?.sketchId) {
      const p = await loadDocumentNow<{ sticker?: string | null } | null>(root, 'sketch', prev.sketchId, () => null).catch(() => null)
      const copy = p?.sticker ? await copyAsset(root, p.sticker, 'Previous panel.png') : null
      if (copy) refs.push(copy)
    } else if (prev?.image) refs.push(prev.image)
    const base = f.image ? await fittedCopy(root, f.image, a.w, a.h) : null
    const drawing = createSketchDoc(a.w, a.h)
    await loadDocumentNow(root, 'sketch', ref.id, () => ({
      ...drawing,
      layers: base ? [{ ...newLayer('Picture'), image: base }, ...drawing.layers] : drawing.layers,
      started: true,
      references: refs.map((image, k) => ({ id: `${ref.id}-ref${k}`, image, x: 24 + k * 30, y: 80 + k * 30, width: 320 })),
    }))
    // Write it now so Draw opens it at the board's size instead of asking for one.
    updateDocument(root, 'sketch', ref.id, (d) => ({ ...(d as object) }), { undoable: false })
    edit({ sketchId: ref.id })
    openComponent('sketch', ref.id)
  }

  const onKey = (e: KeyboardEvent) => {
    if (!active || (e.target as HTMLElement).closest('input, textarea, select, button, [contenteditable="true"]')) return
    if (e.key === ' ') {
      e.preventDefault()
      play()
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') setSel(Math.min(frames.length - 1, i + 1))
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') setSel(Math.max(0, i - 1))
  }

  const shownIndex = playing ?? i
  const shown = frames[shownIndex]
  const shownN = numbers[shownIndex]

  return (
    <div className="sb" tabIndex={-1} onKeyDown={onKey}>
      <div className="sb-head">
        <PresetHeader documentId={documentId!} kind="Storyboard" undo={doc.undo} redo={doc.redo} canUndo={doc.canUndo} canRedo={doc.canRedo} />
      </div>
      <div className="ld-toolbar sb-toolbar">
        <button className="btn btn-primary" title={UI.playHint} onClick={play} disabled={!frames.length}>
          {playing === null ? <Play size={14} /> : <Pause size={14} />} {playing === null ? UI.play : UI.stop}
        </button>
        <span className="sb-group">
          <button className="btn" title={UI.panelHint} onClick={() => insert(newFrame({ sameCut: true, shot: f?.shot, camera: f?.camera }))} disabled={!f}>
            <Plus size={14} /> {UI.panel}
          </button>
          <button className="btn" title={UI.cutHint} onClick={() => insert(newFrame())}>
            <Plus size={14} /> {UI.cut}
          </button>
          <button className="btn" title={UI.sceneHint} onClick={() => insert(newFrame({ sceneStart: true, scene: '' }))}>
            <Plus size={14} /> {UI.scene}
          </button>
        </span>
        <span className="sb-group">
          <button className={`btn${view === 'board' ? ' btn-primary' : ''}`} title={UI.boardHint} onClick={() => setView('board')}>
            <LayoutGrid size={14} /> {UI.board}
          </button>
          <button className={`btn${view === 'sheet' ? ' btn-primary' : ''}`} title={UI.sheetHint} onClick={() => setView('sheet')}>
            <Rows3 size={14} /> {UI.sheet}
          </button>
        </span>
        <button className="btn" title={UI.fromWriterHint} onClick={() => setDialog('writer')}>
          <BookOpen size={14} /> {UI.fromWriter}
        </button>
        <button className="btn" onClick={() => setDialog('export')}>
          <Download size={14} /> {UI.export}
        </button>
        <button className="icon-btn" title={UI.settings} aria-label={UI.settings} onClick={() => setDialog('settings')}>
          <Settings2 size={15} />
        </button>
        <span className="muted sb-stats">
          {last ? UI.stats(last.scene, last.cut, frames.length) : ''} · {formatTimecode(total, fps)}
        </span>
      </div>

      {data.soundtrack && <AudioPlayer path={data.soundtrack} playing={playing !== null} offset={playStart} />}
      {playing !== null && frames[playing]?.audio && <AudioPlayer key={frames[playing].id} path={frames[playing].audio!} playing offset={0} />}

      {view === 'board' ? (
        <div className="sb-body">
          <div className="sb-main">
            {shown && shownN && (
              <div className="sb-player">
                <div className="sb-screen" style={{ aspectRatio: ratio(aspect) }}>
                  <PanelPicture frame={shown} className="sb-big" aspect={aspect} />
                  {data.safeArea && <div className="sb-safe" />}
                  {shown.dialogue && <div className="sb-sub">{shown.dialogue}</div>}
                </div>
                <div className="sb-count">
                  {sceneLabel(shownN)} · {cutLabel(shownN)} · {shown.shot} · {shown.camera} · {formatTime(shown.seconds, fps)} · {formatTimecode(shownN.start, fps)} / {formatTimecode(total, fps)}
                </div>
              </div>
            )}
            <div className="sb-strip">
              {frames.map((x, k) => {
                const nk = numbers[k]
                return (
                  <div key={x.id} className={`sb-slot${nk.firstOfScene ? ' sb-scene-start' : ''}${nk.panel > 0 ? ' sb-same-cut' : ''}`}>
                    <div className="sb-scene-tag">{nk.firstOfScene ? sceneLabel(nk) : ''}</div>
                    <button className={`sb-frame${k === i ? ' on' : ''}${k === playing ? ' playing' : ''}`} onClick={() => setSel(k)}>
                      <PanelPicture frame={x} className="sb-thumb" aspect={aspect} />
                      <span>
                        {cutLabel(nk)} · {formatTime(x.seconds, fps)}
                        {x.status && <em className={`sb-status sb-status-${x.status.replace(/\s/g, '-').toLowerCase()}`}>{x.status}</em>}
                      </span>
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
          {f && n && (
            <aside className="sb-side">
              <strong>
                {sceneLabel(n)} · {cutLabel(n)}
              </strong>
              <PanelFields frame={f} n={n} fps={fps} root={root} first={i === 0} edit={edit} onDraw={() => void drawPanel()} />
              <div className="ld-inline">
                <button className="icon-btn" title={UI.earlier} aria-label={UI.earlier} onClick={() => move(-1)}>
                  <ArrowLeft size={14} />
                </button>
                <button className="icon-btn" title={UI.later} aria-label={UI.later} onClick={() => move(1)}>
                  <ArrowRight size={14} />
                </button>
                <button className="icon-btn" title={UI.duplicate} aria-label={UI.duplicate} onClick={() => insert({ ...f, id: newFrame().id, sceneStart: false, scene: undefined, sameCut: true })}>
                  <Copy size={14} />
                </button>
                <button
                  className="btn btn-danger"
                  disabled={frames.length < 2}
                  onClick={() => {
                    set((list) => list.filter((x) => x.id !== f.id))
                    setSel(Math.max(0, i - 1))
                  }}
                >
                  <Trash2 size={14} /> {UI.delete}
                </button>
              </div>
            </aside>
          )}
        </div>
      ) : (
        <Sheet frames={frames} numbers={numbers} fps={fps} aspect={aspect} selected={i} playing={playing} onSelect={setSel} editAt={editAt} />
      )}

      {dialog === 'writer' && (
        <FromWriterDialog
          onClose={() => setDialog(null)}
          onMake={(made) => {
            setDialog(null)
            doc.update((d) => ({ ...d, frames: [...(d.frames.length === 1 && isBlank(d.frames[0]) ? [] : d.frames), ...made] }))
            setView('sheet')
          }}
        />
      )}
      {dialog === 'export' && root && <ExportDialog root={root} doc={data} title={title} onClose={() => setDialog(null)} />}
      {dialog === 'settings' && <Settings doc={data} root={root} update={(patch) => doc.update((d) => ({ ...d, ...patch }))} onClose={() => setDialog(null)} />}
    </div>
  )
}

/** Every field of one panel (the Board's side panel). */
function PanelFields({ frame: f, n, fps, root, first, edit, onDraw }: { frame: Frame; n: Numbered; fps: number; root: string | null; first: boolean; edit: (p: Partial<Frame>) => void; onDraw: () => void }) {
  const audioUrl = useAssetUrl(f.audio)
  return (
    <>
      <div className="sb-pic-actions">
        <button className="btn" title={UI.drawHint} onClick={onDraw}>
          <Brush size={14} /> {f.sketchId ? UI.openDrawing : UI.draw}
        </button>
        {root && (
          <button
            className="btn"
            onClick={async () => {
              const [a] = await pickAndImportAssets(root, 'image', 'Picture for the panel')
              if (a) edit({ image: a.path, sketchId: undefined })
            }}
          >
            <ImagePlus size={14} /> {f.image || f.sketchId ? UI.changePicture : UI.addPicture}
          </button>
        )}
        {f.sketchId && (
          <button className="btn btn-ghost" onClick={() => edit({ sketchId: undefined })}>
            {UI.unlinkDrawing}
          </button>
        )}
      </div>
      {!first && (
        <>
          <label className="sb-check">
            <input type="checkbox" checked={!!f.sceneStart} onChange={(e) => edit({ sceneStart: e.target.checked, sameCut: e.target.checked ? false : f.sameCut })} /> {UI.sceneStart}
          </label>
          {!f.sceneStart && (
            <label className="sb-check" title={UI.sameCutHint}>
              <input type="checkbox" checked={!!f.sameCut} onChange={(e) => edit({ sameCut: e.target.checked })} /> {UI.sameCut}
            </label>
          )}
        </>
      )}
      {(first || f.sceneStart) && (
        <label className="ld-field">
          <span>{UI.sceneName}</span>
          <input className="input" value={f.scene ?? ''} placeholder={`Scene ${n.scene}`} onChange={(e) => edit({ scene: e.target.value })} />
        </label>
      )}
      <div className="sb-two">
        <label className="ld-field">
          <span>{UI.shot}</span>
          <Select value={f.shot} options={SHOTS} onChange={(shot) => edit({ shot })} />
        </label>
        <label className="ld-field">
          <span>{UI.camera}</span>
          <Select value={f.camera} options={CAMERA} onChange={(camera) => edit({ camera })} />
        </label>
      </div>
      <div className="sb-two">
        <label className="ld-field">
          <span>{UI.time}</span>
          <TimeInput seconds={f.seconds} fps={fps} onChange={(seconds) => edit({ seconds })} />
        </label>
        <label className="ld-field">
          <span>{UI.transition}</span>
          <Select value={f.transition} options={TRANSITIONS.slice(1)} empty="Cut" onChange={(v) => edit({ transition: v || undefined })} />
        </label>
      </div>
      {n.panels > 1 && (
        <span className="muted sb-small">
          Cut {n.cut}: {n.panels} panels, {formatTime(n.cutSeconds, fps)}
        </span>
      )}
      <label className="ld-field">
        <span>{UI.action}</span>
        <ProofTextarea className="input" rows={3} value={f.action} onChange={(e) => edit({ action: e.target.value })} />
      </label>
      <label className="ld-field">
        <span>{UI.dialogue}</span>
        <ProofTextarea className="input" rows={2} value={f.dialogue} onChange={(e) => edit({ dialogue: e.target.value })} />
      </label>
      <label className="ld-field">
        <span>{UI.sound}</span>
        <input className="input" value={f.sound} onChange={(e) => edit({ sound: e.target.value })} />
      </label>
      <div className="ld-field">
        <span title={UI.audioHint}>{UI.audio}</span>
        {f.audio ? (
          <div className="sb-audio">
            {audioUrl && <audio controls src={audioUrl} />}
            <button className="icon-btn" aria-label={UI.remove} title={UI.remove} onClick={() => edit({ audio: undefined })}>
              <X size={13} />
            </button>
          </div>
        ) : (
          root && (
            <button
              className="btn"
              title={UI.audioHint}
              onClick={async () => {
                const [a] = await pickAndImportAssets(root, 'audio', UI.audio)
                if (a) edit({ audio: a.path })
              }}
            >
              <Music size={14} /> {UI.addAudio}
            </button>
          )
        )}
      </div>
      <div className="ld-field">
        <span>{UI.script}</span>
        <WriterLinkBox link={f.writer} onChange={(writer) => edit({ writer })} />
      </div>
      <label className="ld-field">
        <span>{UI.notes}</span>
        <ProofTextarea className="input" rows={2} value={f.notes ?? ''} placeholder={UI.notesHint} onChange={(e) => edit({ notes: e.target.value })} />
      </label>
      <div className="ld-field">
        <span>{UI.characters}</span>
        <Characters ids={f.characterIds ?? []} onChange={(characterIds) => edit({ characterIds })} />
      </div>
      <label className="ld-field">
        <span>{UI.status}</span>
        <Select value={f.status} options={STATUSES} empty={UI.noStatus} onChange={(v) => edit({ status: (v || undefined) as Status | undefined })} />
      </label>
    </>
  )
}

interface SheetProps {
  frames: Frame[]
  numbers: Numbered[]
  fps: number
  aspect: string
  selected: number
  playing: number | null
  onSelect: (i: number) => void
  editAt: (id: Id, p: Partial<Frame>) => void
}

/** The Sheet view: one row per panel, the picture with its text next to it, all editable. */
function Sheet({ frames, numbers, fps, aspect, selected, playing, onSelect, editAt }: SheetProps) {
  return (
    <div className="sb-sheet">
      <div className="sb-sheet-head">
        <span>Cut</span>
        <span>Picture</span>
        <span>What happens · Script · Notes</span>
        <span>Dialogue · Sound</span>
        <span>Time</span>
      </div>
      {frames.map((f, k) => {
        const n = numbers[k]
        return (
          <div key={f.id} className="sb-sheet-item">
            {n.firstOfScene && (
              <div className="sb-sheet-scene">
                <Clapperboard size={14} /> {sceneLabel(n)}
              </div>
            )}
            <div className={`sb-row${k === selected ? ' on' : ''}${k === playing ? ' playing' : ''}${n.panel > 0 ? ' sb-same-cut' : ''}`} onFocus={() => onSelect(k)} onClick={() => onSelect(k)}>
              <div className="sb-row-cut">
                <strong>{cutLabel(n)}</strong>
                <Select value={f.shot} options={SHOTS} onChange={(shot) => editAt(f.id, { shot })} />
                <Select value={f.camera} options={CAMERA} onChange={(camera) => editAt(f.id, { camera })} />
                {f.status && <em className={`sb-status sb-status-${f.status.replace(/\s/g, '-').toLowerCase()}`}>{f.status}</em>}
              </div>
              <PanelPicture frame={f} className="sb-row-pic" aspect={aspect} />
              <div className="sb-row-text">
                <ProofTextarea className="input" rows={3} placeholder={UI.action} value={f.action} onChange={(e) => editAt(f.id, { action: e.target.value })} />
                {f.writer && <WriterLinkBox link={f.writer} onChange={(writer) => editAt(f.id, { writer })} />}
                <ProofTextarea className="input" rows={1} placeholder={UI.notes} value={f.notes ?? ''} onChange={(e) => editAt(f.id, { notes: e.target.value })} />
              </div>
              <div className="sb-row-text">
                <ProofTextarea className="input" rows={3} placeholder={UI.dialogue} value={f.dialogue} onChange={(e) => editAt(f.id, { dialogue: e.target.value })} />
                <input className="input" placeholder={UI.sound} value={f.sound} onChange={(e) => editAt(f.id, { sound: e.target.value })} />
              </div>
              <div className="sb-row-time">
                <TimeInput seconds={f.seconds} fps={fps} onChange={(seconds) => editAt(f.id, { seconds })} />
                <span className="muted sb-small">{formatTimecode(n.start, fps)}</span>
                {n.panels > 1 && n.panel === n.panels - 1 && <span className="muted sb-small">Cut {formatTime(n.cutSeconds, fps)}</span>}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Settings({ doc, root, update, onClose }: { doc: StoryboardDoc; root: string | null; update: (p: Partial<StoryboardDoc>) => void; onClose: () => void }) {
  const trackUrl = useAssetUrl(doc.soundtrack)
  return (
    <Modal onClose={onClose}>
      <div className="sb-pick">
        <h3>{UI.settings}</h3>
        <label className="ld-field">
          <span>{UI.aspect}</span>
          <select className="input" value={aspectOf(doc).id} onChange={(e) => update({ aspect: e.target.value as StoryboardDoc['aspect'] })}>
            {ASPECTS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="ld-field">
          <span>{UI.fps}</span>
          <select className="input" value={fpsOf(doc)} onChange={(e) => update({ fps: Number(e.target.value) })}>
            {[...new Set([...FPS_CHOICES, fpsOf(doc)])].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="sb-check">
          <input type="checkbox" checked={!!doc.safeArea} onChange={(e) => update({ safeArea: e.target.checked })} /> {UI.safe}
        </label>
        <div className="ld-field">
          <span>{UI.soundtrack}</span>
          {doc.soundtrack ? (
            <div className="sb-audio">
              {trackUrl && <audio controls src={trackUrl} />}
              <button className="icon-btn" aria-label={UI.remove} title={UI.remove} onClick={() => update({ soundtrack: null })}>
                <X size={13} />
              </button>
            </div>
          ) : (
            root && (
              <button
                className="btn"
                onClick={async () => {
                  const [a] = await pickAndImportAssets(root, 'audio', UI.soundtrack)
                  if (a) update({ soundtrack: a.path })
                }}
              >
                <Music size={14} /> {UI.addSoundtrack}
              </button>
            )
          )}
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>
            {UI.done}
          </button>
        </div>
      </div>
    </Modal>
  )
}
