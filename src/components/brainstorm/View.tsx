import { ImagePlus, Mic, Square as StopIcon, TextCursorInput } from 'lucide-react'
import { CustomColor, softColor } from '@/shared/canvas/CustomColor'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { assetUrl, dragHasFiles, importAssetFromBlob, importAssetsFromDataTransfer, pickAndImportAssets, useAssetUrls, type ImportedAsset } from '@/core/assets'
import { newId, type Id } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useProjectStore } from '@/core/state'
import { promptDialog } from '@/shared/dialogs'
import { commentTool } from '@/shared/reviews'
import {
  addNodes,
  arrowTool,
  CanvasEditor,
  ellipseTool,
  handTool,
  lineTool,
  loadImageSize,
  noteTool,
  penTool,
  rectTool,
  sceneBinding,
  textTool,
  updateNode,
  updateNodes,
  useCanvasState,
  visibleNodes,
  type CanvasApi,
  type CanvasTool,
  type Point,
  type SceneRecipe,
  type UpdateOptions,
} from '@/shared/canvas'
import { BOARD_COLORS, colorPatch, type BoardColor } from './colors'
import { AUDIO_CARD, createBrainstormDoc, deleteBoardNodes, followPins, type AudioNode, type BoardNode, type BrainstormDoc } from './model'
import { AUDIO_PLAYER_BOX, BOARD_NODE_TYPES, audioTitle } from './nodeTypes'
import { formatSeconds, useVoiceRecorder } from './recorder'
import { areaTool, boardSelectTool, pinTool, stringTool } from './tools'
import './brainstorm.css'
import { pointIn } from '@/shared/zoom'

const TEXT = {
  board: 'Brainstorm board',
  colors: 'Color',
  auto: 'Automatic color',
  addMedia: 'Add image or audio',
  record: 'Record a voice clip',
  stopRecording: 'Stop recording',
  voiceClip: 'Voice clip',
  rename: 'Rename',
  renameArea: 'Rename area',
  renameClip: 'Rename clip',
  dropHere: 'Drop images or audio to add them',
  missingAudio: 'Audio file missing',
  importFailed: 'Only images and audio can be added.',
}

const nameOnly = (file: string) => file.replace(/\.[^.]+$/, '')

/** Brainstorm Board (spec 8.8): drawing, sticky notes, shapes, images, audio, pins and string, named areas. */
export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument<BrainstormDoc>('brainstorm', documentId!, createBrainstormDoc)
  const root = useProjectStore((s) => s.root)
  const canvas = useCanvasState()
  const apiRef = useRef<CanvasApi<BoardNode> | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [color, setColor] = useState<BoardColor | null>(null)
  const [dropping, setDropping] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  // Rebuilt when the picked color changes, so new shapes, notes, pins and areas use it.
  const tools = useMemo<CanvasTool<BoardNode>[]>(() => {
    const c = () => color
    const ink = () => (color ? { strokeColor: color.strong } : {})
    return [
      boardSelectTool,
      handTool,
      penTool({ defaults: ink }),
      noteTool({ defaults: () => (color ? { fillColor: color.soft } : {}) }),
      rectTool({ defaults: ink }),
      ellipseTool({ defaults: ink }),
      lineTool({ defaults: ink }),
      arrowTool({ defaults: ink }),
      textTool({ defaults: () => (color ? { textColor: color.strong } : {}) }),
      pinTool(c),
      stringTool(c),
      areaTool(c),
      commentTool('brainstorm', documentId ?? null),
    ]
  }, [color, documentId])

  const scene = doc.data?.scene
  const paths = useMemo(() => scene?.nodes.flatMap((n) => (n.kind === 'image' || n.kind === 'audio' ? [n.src] : [])) ?? [], [scene])
  const resolve = useAssetUrls(paths)

  useEffect(() => {
    if (!message) return
    const t = window.setTimeout(() => setMessage(null), 4000)
    return () => window.clearTimeout(t)
  }, [message])

  const viewCenter = useCallback((): Point => {
    const api = apiRef.current
    const box = boxRef.current
    if (!api || !box) return { x: 0, y: 0 }
    return api.screenToWorld({ x: box.clientWidth / 2, y: box.clientHeight / 2 })
  }, [])

  /** Put imported files on the board around `at` (MB-7 style: picker, drop, paste, recording). */
  const placeAssets = useCallback(
    async (assets: ImportedAsset[], at: Point) => {
      const api = apiRef.current
      if (!api || !root || assets.length === 0) return
      // Several files go side by side, starting at the drop point.
      const nodes: BoardNode[] = []
      let x = at.x
      for (const a of assets) {
        if (a.kind === 'image') {
          const size = await loadImageSize(await assetUrl(root, a.path).catch(() => null))
          nodes.push({ id: newId(), kind: 'image', layerId: api.activeLayerId, src: a.path, x, y: at.y - size.height / 2, ...size })
          x += size.width + 24
        } else {
          const clip: AudioNode = { id: newId(), kind: 'audio', layerId: api.activeLayerId, src: a.path, name: nameOnly(a.name), ...AUDIO_CARD, x, y: at.y - AUDIO_CARD.height / 2 }
          nodes.push(clip)
          x += AUDIO_CARD.width + 24
        }
      }
      // Center the row on the drop point.
      const shift = (x - 24 - at.x) / 2
      for (const n of nodes) n.x -= shift
      api.update((s) => addNodes(s, nodes))
      api.select(nodes.map((n) => n.id))
    },
    [root],
  )

  const recorder = useVoiceRecorder(
    async (blob) => {
      if (!root) return
      const asset = await importAssetFromBlob(root, blob, 'audio', `${TEXT.voiceClip}.webm`)
      if (asset) await placeAssets([{ ...asset, name: `${TEXT.voiceClip} ${new Date().toLocaleTimeString()}` }], viewCenter())
    },
    setMessage,
  )

  if (!doc.data || !scene) return null

  const binding = sceneBinding(doc)
  const onChange = (recipe: SceneRecipe<BoardNode>, options?: UpdateOptions) => binding.onChange((s) => followPins(recipe(s)), options)
  const selected = scene.nodes.filter((n) => canvas.selection.includes(n.id))
  const renameTarget = selected.length === 1 && (selected[0].kind === 'area' || selected[0].kind === 'audio') ? selected[0] : null

  const rename = async (id: Id) => {
    const node = scene.nodes.find((n) => n.id === id)
    if (!node) return
    const title = node.kind === 'area' ? TEXT.renameArea : TEXT.renameClip
    const name = await promptDialog(title, node.name ?? '')
    if (name !== null) onChange((s) => updateNode(s, id, { name: name.trim() }))
  }

  const pickColor = (c: BoardColor | null) => {
    setColor(c)
    if (canvas.selection.length === 0) return
    onChange((s) =>
      updateNodes(s, canvas.selection, (n) => {
        const patch = colorPatch(n, c)
        return patch ? ({ ...n, ...patch } as BoardNode) : n
      }),
    )
  }

  const addFromPicker = async () => {
    if (!root) return
    const assets = await pickAndImportAssets(root, 'any')
    await placeAssets(assets, viewCenter())
  }

  const onDrop = async (e: React.DragEvent) => {
    setDropping(false)
    if (!root || !dragHasFiles(e.dataTransfer)) return
    e.preventDefault()
    const at = apiRef.current?.screenToWorld(pointIn(boxRef.current!, e)) ?? viewCenter()
    const assets = await importAssetsFromDataTransfer(root, e.dataTransfer, 'any')
    if (assets.length === 0) setMessage(TEXT.importFailed)
    await placeAssets(assets, at)
  }

  const onPaste = async (e: React.ClipboardEvent) => {
    if (!active || !root || isTyping(e.target)) return
    const api = apiRef.current
    const hasFiles = Array.from(e.clipboardData.items).some((i) => i.kind === 'file')
    if (hasFiles) {
      e.preventDefault()
      await placeAssets(await importAssetsFromDataTransfer(root, e.clipboardData, 'any'), viewCenter())
      return
    }
    // Pasted text becomes a sticky note.
    const text = e.clipboardData.getData('text/plain').trim()
    if (!text || !api) return
    e.preventDefault()
    const at = viewCenter()
    const note: BoardNode = { id: newId(), kind: 'note', layerId: api.activeLayerId, x: at.x - 90, y: at.y - 90, width: 180, height: 180, text, ...(color ? { fillColor: color.soft } : {}) }
    api.update((s) => addNodes(s, [note]))
    api.select([note.id])
  }

  const recording = recorder.recording
  const toolbarExtra = (
    <>
      <div className="brainstorm-swatches" role="radiogroup" aria-label={TEXT.colors}>
        <button className={'brainstorm-swatch is-auto' + (color === null ? ' is-active' : '')} title={TEXT.auto} aria-label={TEXT.auto} role="radio" aria-checked={color === null} onClick={() => pickColor(null)} />
        {BOARD_COLORS.map((c) => (
          <button
            key={c.label}
            className={'brainstorm-swatch' + (color === c ? ' is-active' : '')}
            style={{ background: c.strong }}
            title={c.label}
            aria-label={c.label}
            role="radio"
            aria-checked={color === c}
            onClick={() => pickColor(c)}
          />
        ))}
        <CustomColor value={color?.strong ?? null} onPick={(hex) => pickColor({ label: 'Custom', strong: hex, soft: softColor(hex) })} />
      </div>
      <span className="canvas-toolbar-sep" />
      <button className="canvas-toolbar-btn" title={TEXT.addMedia} aria-label={TEXT.addMedia} onClick={addFromPicker}>
        <ImagePlus size={17} strokeWidth={1.8} />
      </button>
      <button
        className={'canvas-toolbar-btn' + (recording ? ' brainstorm-recording' : '')}
        title={recording ? TEXT.stopRecording : TEXT.record}
        aria-label={recording ? TEXT.stopRecording : TEXT.record}
        aria-pressed={recording}
        onClick={() => (recording ? recorder.stop() : void recorder.start())}
      >
        {recording ? (
          <>
            <StopIcon size={13} strokeWidth={2.4} fill="currentColor" />
            <span className="brainstorm-rec-time">{formatSeconds(recorder.elapsed)}</span>
          </>
        ) : (
          <Mic size={17} strokeWidth={1.8} />
        )}
      </button>
      {renameTarget ? (
        <button className="canvas-toolbar-btn" title={TEXT.rename} aria-label={TEXT.rename} onClick={() => rename(renameTarget.id)}>
          <TextCursorInput size={17} strokeWidth={1.8} />
        </button>
      ) : null}
    </>
  )

  return (
    <div
      ref={boxRef}
      className={'brainstorm-root' + (dropping ? ' is-dropping' : '')}
      onDragOver={(e) => {
        if (!dragHasFiles(e.dataTransfer)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        if (!dropping) setDropping(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
      }}
      onDrop={onDrop}
      onPaste={onPaste}
    >
      <CanvasEditor<BoardNode>
        scene={scene}
        onChange={onChange}
        onUndo={doc.undo}
        onRedo={doc.redo}
        canUndo={doc.canUndo}
        canRedo={doc.canRedo}
        active={active}
        tools={tools}
        nodeTypes={BOARD_NODE_TYPES}
        canvas={canvas}
        apiRef={apiRef}
        resolveImageSrc={resolve}
        toolbarExtra={toolbarExtra}
        ariaLabel={TEXT.board}
        onDeleteNodes={(ids) => onChange((s) => deleteBoardNodes(s, ids))}
        onNodeDoubleClick={(id, api) => {
          const node = api.scene.nodes.find((n) => n.id === id)
          if (node?.kind === 'area' || node?.kind === 'audio') void rename(id)
          else if (node && api.nodeTypes[node.kind]?.textEdit) api.editText(id)
        }}
        html={(_api, s) =>
          visibleNodes(s)
            .filter((n): n is AudioNode => n.kind === 'audio')
            .map((n) => <AudioPlayer key={n.id} node={n} url={resolve(n.src)} />)
        }
      />
      {dropping ? <div className="brainstorm-drop">{TEXT.dropHere}</div> : null}
      {message ? (
        <div className="brainstorm-message" role="status">
          {message}
        </div>
      ) : null}
    </div>
  )
}

function isTyping(t: EventTarget | null) {
  return t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')
}

/** The playable part of an audio card, drawn as HTML over the canvas card. */
function AudioPlayer({ node, url }: { node: AudioNode; url: string }) {
  const style = { left: node.x + AUDIO_PLAYER_BOX.x, top: node.y + AUDIO_PLAYER_BOX.y, width: node.width - AUDIO_PLAYER_BOX.x * 2, height: AUDIO_PLAYER_BOX.height }
  return (
    <div className="brainstorm-audio" style={style} title={audioTitle(node)}>
      {url ? <audio controls preload="metadata" src={url} /> : <span className="brainstorm-audio-missing">{TEXT.missingAudio}</span>}
    </div>
  )
}
