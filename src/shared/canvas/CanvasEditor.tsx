import Konva from 'konva'
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { Group, Layer as KonvaLayer, Rect, Stage, Transformer } from 'react-konva'
import { isPresenceActive, setPresence } from '@/core/collab'
import type { Id } from '@/core/model'
import { panelKey, usePanelContext } from '@/core/state'
import { boardShortcut, comboOf, isShortcut } from '@/core/shortcuts'
import { RemoteCursors } from './RemoteCursors'
import { CanvasToolbar } from './CanvasToolbar'
import { fitRect, screenToWorld, transformBounds, unionRects, zoomAt } from './geometry'
import { BUILTIN_NODE_TYPES, UNKNOWN_NODE_TYPE } from './nodeTypes'
import {
  addLayer,
  addNodes,
  deleteNodes,
  duplicateNodes,
  renderOrder,
  resolveActiveLayer,
  selectableNodes,
  translateNodes,
  reorderNodes,
  updateNode,
  updateNodes,
  visibleNodes,
} from './scene'
import { TextEditor } from './TextEditor'
import { useCanvasTheme } from './theme'
import { handTool, selectTool } from './tools'
import type {
  CanvasApi,
  CanvasTool,
  NodeBase,
  NodeType,
  NodeTypes,
  Point,
  Rect as RectT,
  RenderContext,
  Scene,
  SceneRecipe,
  ToolGesture,
  ToolPointerEvent,
  UpdateOptions,
  Viewport,
} from './types'
import './canvas.css'

/** View state of one canvas: viewport, selection, tool, active layer. */
export interface CanvasState {
  viewport: Viewport
  setViewport: Dispatch<SetStateAction<Viewport>>
  selection: Id[]
  setSelection: Dispatch<SetStateAction<Id[]>>
  toolId: string
  setToolId: Dispatch<SetStateAction<string>>
  /** Where tools add nodes; null = topmost usable layer. */
  activeLayerId: Id | null
  setActiveLayerId: Dispatch<SetStateAction<Id | null>>
}

/**
 * Create the view state yourself when your component needs to read or set the
 * selection, tool or viewport (e.g. a layers panel or the story writer's "last node").
 */
export function useCanvasState(init: { toolId?: string; viewport?: Viewport } = {}): CanvasState {
  const [viewport, setViewport] = useState<Viewport>(init.viewport ?? { x: 40, y: 40, scale: 1 })
  const [selection, setSelection] = useState<Id[]>([])
  const [toolId, setToolId] = useState(init.toolId ?? 'select')
  const [activeLayerId, setActiveLayerId] = useState<Id | null>(null)
  return { viewport, setViewport, selection, setSelection, toolId, setToolId, activeLayerId, setActiveLayerId }
}

export interface CanvasEditorProps<N extends NodeBase> {
  scene: Scene<N>
  /** Apply a change synchronously, e.g. `(r, o) => doc.update(d => ({ ...d, scene: r(d.scene) }), o)`. */
  onChange(recipe: SceneRecipe<N>, options?: UpdateOptions): void
  onUndo?(): void
  onRedo?(): void
  canUndo?: boolean
  canRedo?: boolean
  /** From PanelProps: shortcuts only work while true. */
  active: boolean
  /** Toolbar tools in order; shortcuts come from each tool. Default: select and pan. */
  tools?: CanvasTool<N>[]
  /** Custom node kinds, merged over the built-ins (rect, ellipse, line, text, note, image, connector). */
  nodeTypes?: NodeTypes
  /** Controlled view state from `useCanvasState()`. */
  canvas?: CanvasState
  /** Extra controls in the bottom toolbar. */
  toolbarExtra?: ReactNode
  showToolbar?: boolean
  /** Dotted background grid (default true). */
  grid?: boolean
  /** Zoom to fit the content when first shown (default true). */
  fitOnOpen?: boolean
  /** Turn stored image paths into URLs (Tauri `convertFileSrc`, see work package F2). Default: unchanged. */
  resolveImageSrc?(src: string): string
  /** Double-click on a node. Default: inline text editing when the kind supports it. */
  onNodeDoubleClick?(id: Id, api: CanvasApi<N>): void
  /** Replace the default delete (nodes plus attached connectors), e.g. to confirm or clean up references. */
  onDeleteNodes?(ids: Id[], api: CanvasApi<N>): void
  /** World-space HTML drawn over the canvas (audio players, badges). Position children with absolute world coordinates. */
  html?(api: CanvasApi<N>, scene: Scene<N>): ReactNode
  /** Receive the API once, for actions triggered outside the canvas (export buttons, layers panel). */
  apiRef?: { current: CanvasApi<N> | null }
  ariaLabel?: string
}

const DEFAULT_TOOLS: CanvasTool<any>[] = [selectTool, handTool]
const DOUBLE_CLICK_MS = 400
const ZOOM_STEP = 1.25
const identity = (s: string) => s

function isTypingTarget(t: EventTarget | null) {
  if (!(t instanceof HTMLElement)) return false
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
}

function isTransformerPart(shape: Konva.Node | null) {
  for (let n: Konva.Node | null = shape; n; n = n.getParent()) if (n.getClassName() === 'Transformer') return true
  return false
}

function nodeIdOf(shape: Konva.Node | null): Id | null {
  for (let n: Konva.Node | null = shape; n; n = n.getParent()) if (n.hasName('canvas-node')) return n.id()
  return null
}

interface NodeViewProps {
  node: NodeBase
  type: NodeType<any>
  ctx: RenderContext
  /** Being edited inline: draw it without its text so the editor's text is the only copy. */
  editingText: boolean
  draft?: boolean
}

function NodeViewInner({ node, type, ctx, editingText, draft }: NodeViewProps) {
  const common = {
    id: draft ? undefined : node.id,
    name: draft ? undefined : 'canvas-node',
    listening: !draft && !node.locked,
    opacity: draft ? 0.7 : 1,
  }
  const content = type.render(editingText && type.textEdit ? type.textEdit.set(node, '') : node, ctx)
  if (type.absolute) return <Group {...common}>{content}</Group>
  return (
    <Group {...common} x={node.x} y={node.y} rotation={node.rotation ?? 0} scaleX={node.scaleX ?? 1} scaleY={node.scaleY ?? 1}>
      {content}
    </Group>
  )
}

const NodeView = memo(
  NodeViewInner,
  (a, b) => b.type.memo !== false && a.node === b.node && a.type === b.type && a.ctx === b.ctx && a.editingText === b.editingText,
)

/**
 * The shared canvas (work package C1, spec 10.2): pan with middle mouse,
 * Space+drag or the hand tool, wheel zoom at the cursor, select/move/
 * transform/delete, undo via the owner's document, bottom toolbar, layers.
 */
export function CanvasEditor<N extends NodeBase>(props: CanvasEditorProps<N>) {
  const own = useCanvasState()
  const state = props.canvas ?? own
  const { viewport, selection, toolId } = state
  const theme = useCanvasTheme()
  const tools = props.tools ?? (DEFAULT_TOOLS as CanvasTool<N>[])
  const tool = tools.find((t) => t.id === toolId) ?? tools[0]
  const nodeTypes = useMemo<NodeTypes>(() => ({ ...BUILTIN_NODE_TYPES, ...props.nodeTypes }), [props.nodeTypes])
  const resolveImageSrc = props.resolveImageSrc ?? identity

  const rootRef = useRef<HTMLDivElement>(null)
  // Shared projects: show teammates' pointers and selections on this canvas.
  const presenceKey = panelKey(usePanelContext())
  const lastCursorAt = useRef(0)
  const stageRef = useRef<Konva.Stage>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const overlayRef = useRef<Konva.Layer>(null)

  const [size, setSize] = useState({ width: 0, height: 0 })
  const [preview, setPreviewState] = useState<SceneRecipe<N> | null>(null)
  const previewRef = useRef<SceneRecipe<N> | null>(null)
  const [draft, setDraft] = useState<N[] | null>(null)
  const [marquee, setMarquee] = useState<RectT | null>(null)
  const [editing, setEditing] = useState<{ id: Id; draft?: N } | null>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const [panning, setPanning] = useState(false)
  const gestureRef = useRef<{ gesture: ToolGesture; cleanup(): void } | null>(null)
  const lastDown = useRef({ time: 0, x: 0, y: 0, count: 0 })

  const scene = useMemo(() => (preview ? preview(props.scene) : props.scene), [preview, props.scene])
  const nodeMap = useMemo(() => new Map(scene.nodes.map((n) => [n.id, n])), [scene.nodes])
  const typeOf = useCallback((n: NodeBase): NodeType<any> => nodeTypes[n.kind] ?? UNKNOWN_NODE_TYPE, [nodeTypes])

  // Everything handlers need, always current, so the API object can stay stable.
  const live = useRef({ props, state, scene, nodeMap, nodeTypes, tool, size, typeOf, editing })
  live.current = { props, state, scene, nodeMap, nodeTypes, tool, size, typeOf, editing }
  const selectionRef = useRef(selection)
  selectionRef.current = selection

  // ---- bounds and render context ----
  const boundsCache = useRef(new WeakMap<object, RectT>())
  const ctxRef = useRef<RenderContext | null>(null)
  const getWorldBounds = useCallback((id: Id): RectT | null => {
    const node = live.current.nodeMap.get(id) as NodeBase | undefined
    if (!node || !ctxRef.current) return null
    const type = live.current.typeOf(node)
    if (type.absolute) return type.bounds(node, ctxRef.current)
    let b = boundsCache.current.get(node)
    if (!b) {
      b = transformBounds(type.bounds(node, ctxRef.current), node)
      boundsCache.current.set(node, b)
    }
    return b
  }, [])
  const ctx = useMemo<RenderContext>(() => {
    boundsCache.current = new WeakMap()
    return {
      theme,
      resolveImageSrc,
      getNode: (id) => live.current.nodeMap.get(id),
      getWorldBounds,
    }
  }, [theme, resolveImageSrc, getWorldBounds])
  ctxRef.current = ctx

  // ---- API for tools and owners ----
  const api = useMemo<CanvasApi<N>>(() => {
    const L = () => live.current
    const contentBounds = () => unionRects(visibleNodes(L().scene).flatMap((n) => getWorldBounds(n.id) ?? []))
    const a: CanvasApi<N> = {
      get scene() {
        return L().props.scene
      },
      get nodeTypes() {
        return L().nodeTypes
      },
      update: (recipe, options) => L().props.onChange(recipe, options),
      preview(recipe) {
        previewRef.current = recipe
        setPreviewState(() => recipe)
      },
      commitPreview() {
        const r = previewRef.current
        previewRef.current = null
        setPreviewState(null)
        if (r) L().props.onChange(r)
      },
      get selection() {
        return selectionRef.current
      },
      select(ids, mode = 'replace') {
        const cur = selectionRef.current
        let next: Id[]
        if (mode === 'add') next = [...cur, ...ids.filter((id) => !cur.includes(id))]
        else if (mode === 'toggle') next = [...cur.filter((id) => !ids.includes(id)), ...ids.filter((id) => !cur.includes(id))]
        else next = ids
        selectionRef.current = next
        L().state.setSelection(next)
      },
      get toolId() {
        return L().state.toolId
      },
      setTool(id) {
        const { tool: current, state: st } = L()
        if (current && current.id !== id) current.deactivate?.(a)
        st.setToolId(id)
      },
      setDraft: (nodes) => setDraft(nodes),
      setMarquee: (r) => setMarquee(r),
      activateNode(id) {
        const { props: p, nodeMap: m, typeOf: t } = L()
        if (p.onNodeDoubleClick) return p.onNodeDoubleClick(id, a)
        const node = m.get(id)
        if (node && t(node).textEdit) setEditing({ id })
      },
      get viewport() {
        return L().state.viewport
      },
      setViewport: (v) => L().state.setViewport(v),
      get activeLayerId() {
        return resolveActiveLayer(L().props.scene, L().state.activeLayerId)
      },
      screenToWorld: (p) => screenToWorld(p, L().state.viewport),
      getWorldBounds,
      editText: (id, newNode) => setEditing({ id, draft: newNode }),
      fitToContent() {
        const b = contentBounds()
        const { size: sz, state: st } = L()
        if (b && sz.width > 0) st.setViewport(fitRect(b, sz, 48, 1))
      },
      exportPng(options = {}) {
        const stage = stageRef.current
        const area = options.area ?? contentBounds()
        if (!stage || !area) return null
        const pad = options.padding ?? 24
        const v = L().state.viewport
        const ratio = options.pixelRatio ?? 2
        const overlay = overlayRef.current
        overlay?.hide()
        try {
          const canvas = stage.toCanvas({
            x: (area.x - pad) * v.scale + v.x,
            y: (area.y - pad) * v.scale + v.y,
            width: (area.width + pad * 2) * v.scale,
            height: (area.height + pad * 2) * v.scale,
            pixelRatio: ratio / v.scale,
          })
          const out = document.createElement('canvas')
          out.width = canvas.width
          out.height = canvas.height
          const g = out.getContext('2d')!
          g.fillStyle = options.background ?? ctxRef.current!.theme.bgSunken
          g.fillRect(0, 0, out.width, out.height)
          g.drawImage(canvas, 0, 0)
          return out.toDataURL('image/png')
        } finally {
          overlay?.show()
        }
      },
    }
    return a
  }, [getWorldBounds])
  useEffect(() => {
    if (props.apiRef) props.apiRef.current = api
  }, [api, props.apiRef])

  // ---- housekeeping ----

  // A scene always needs a layer to draw into.
  useEffect(() => {
    if (props.scene.layers.length === 0) props.onChange((s) => (s.layers.length ? s : addLayer(s, {}).scene), { undoable: false })
  }, [props.scene.layers.length, props])

  // Drop selected ids that no longer exist (after undo or delete elsewhere).
  useEffect(() => {
    const valid = selection.filter((id) => nodeMap.has(id))
    if (valid.length !== selection.length) state.setSelection(valid)
  }, [selection, nodeMap, state])

  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }))
    ro.observe(el)
    setSize({ width: el.clientWidth, height: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current || size.width === 0) return
    fitted.current = true
    if (props.fitOnOpen !== false && props.scene.nodes.length > 0) api.fitToContent()
  }, [size.width, props.fitOnOpen, props.scene.nodes.length, api])

  // ---- pointer input ----

  const localPoint = (ev: { clientX: number; clientY: number }): Point => {
    const r = rootRef.current!.getBoundingClientRect()
    return { x: ev.clientX - r.left, y: ev.clientY - r.top }
  }

  const toolEvent = (ev: PointerEvent | React.PointerEvent, clickCount: number): ToolPointerEvent => {
    const screen = localPoint(ev)
    const shape = stageRef.current?.getIntersection(screen) ?? null
    return {
      world: screenToWorld(screen, live.current.state.viewport),
      screen,
      targetId: nodeIdOf(shape),
      button: ev.button,
      shift: ev.shiftKey,
      alt: ev.altKey,
      mod: ev.ctrlKey || ev.metaKey,
      clickCount,
    }
  }

  const endGesture = () => {
    gestureRef.current?.cleanup()
    gestureRef.current = null
  }

  const runGesture = (gesture: ToolGesture, clickCount: number) => {
    const move = (ev: PointerEvent) => gesture.move?.(toolEvent(ev, clickCount))
    const up = (ev: PointerEvent) => {
      endGesture()
      gesture.up?.(toolEvent(ev, clickCount))
    }
    const cancel = () => {
      endGesture()
      gesture.cancel?.()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    gestureRef.current = {
      gesture,
      cleanup() {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', cancel)
      },
    }
  }

  const cancelGesture = () => {
    const g = gestureRef.current
    if (!g) return false
    endGesture()
    g.gesture.cancel?.()
    return true
  }

  const startPan = (e: React.PointerEvent) => {
    const start = localPoint(e)
    const v0 = state.viewport
    setPanning(true)
    runGesture(
      {
        move(m) {
          state.setViewport({ ...v0, x: v0.x + m.screen.x - start.x, y: v0.y + m.screen.y - start.y })
        },
        up: () => setPanning(false),
        cancel: () => setPanning(false),
      },
      1,
    )
  }

  const onPointerDown = (e: React.PointerEvent) => {
    // Only presses on the canvas itself; toolbar and HTML overlays handle their own.
    if (!(e.target instanceof HTMLCanvasElement) || gestureRef.current) return
    rootRef.current?.focus({ preventScroll: true })
    const screen = localPoint(e)
    // Transform handles are Konva's own; they need the browser's mouse events, so no preventDefault here.
    if (isTransformerPart(stageRef.current?.getIntersection(screen) ?? null)) return
    // The browser's own mousedown focus would steal focus from an inline text editor opened by this press.
    e.preventDefault()

    const d = lastDown.current
    const now = performance.now()
    const count = now - d.time < DOUBLE_CLICK_MS && Math.hypot(screen.x - d.x, screen.y - d.y) < 6 ? d.count + 1 : 1
    lastDown.current = { time: now, x: screen.x, y: screen.y, count }

    if (e.button === 1 || (e.button === 0 && (spaceDown || tool?.id === 'hand'))) {
      e.preventDefault()
      startPan(e)
      return
    }
    const gesture = tool?.pointerDown?.(toolEvent(e, count), api)
    if (gesture) runGesture(gesture, count)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (presenceKey && isPresenceActive() && e.timeStamp - lastCursorAt.current > 50) {
      lastCursorAt.current = e.timeStamp
      const r = rootRef.current?.getBoundingClientRect()
      if (r) {
        const w = screenToWorld({ x: e.clientX - r.left, y: e.clientY - r.top }, live.current.state.viewport)
        setPresence('pointer', { key: presenceKey, x: Math.round(w.x), y: Math.round(w.y) })
      }
    }
    if (gestureRef.current || !tool?.hover) return
    if (!(e.target instanceof HTMLCanvasElement)) return
    tool.hover(toolEvent(e, 0), api)
  }

  const onPointerLeave = () => {
    if (presenceKey) setPresence('pointer', null)
    if (!gestureRef.current) tool?.hover?.(null, api)
  }

  useEffect(() => {
    if (presenceKey) setPresence('selection', selection.length ? { key: presenceKey, ids: selection } : null)
  }, [presenceKey, selection])
  useEffect(
    () => () => {
      if (presenceKey) {
        setPresence('pointer', null)
        setPresence('selection', null)
      }
    },
    [presenceKey],
  )

  // Wheel zooms at the cursor; Shift+wheel pans sideways. Needs a non-passive listener.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const onWheel = (ev: WheelEvent) => {
      if (!(ev.target instanceof HTMLCanvasElement) && !(ev.target === el)) return
      ev.preventDefault()
      const unit = ev.deltaMode === 1 ? 33 : ev.deltaMode === 2 ? 400 : 1
      const setViewport = live.current.state.setViewport
      if (ev.shiftKey && !ev.ctrlKey) {
        const d = (ev.deltaX || ev.deltaY) * unit
        setViewport((v) => ({ ...v, x: v.x - d }))
        return
      }
      const r = el.getBoundingClientRect()
      const p = { x: ev.clientX - r.left, y: ev.clientY - r.top }
      const factor = Math.exp(-ev.deltaY * unit * 0.0015)
      setViewport((v) => zoomAt(v, p, factor))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ---- keyboard ----

  const zoomCentered = (factor: number) => state.setViewport((v) => zoomAt(v, { x: size.width / 2, y: size.height / 2 }, factor))
  const zoomReset = () => zoomCentered(1 / state.viewport.scale)

  const deleteSelection = () => {
    const ids = selectableNodes(props.scene)
      .filter((n) => selection.includes(n.id))
      .map((n) => n.id)
    if (ids.length === 0) return
    if (props.onDeleteNodes) props.onDeleteNodes(ids, api)
    else props.onChange((s) => deleteNodes(s, ids))
    api.select([])
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!props.active || isTypingTarget(e.target)) return
    const key = e.key
    const mod = e.ctrlKey || e.metaKey
    const handled = () => e.preventDefault()

    if (key === 'Escape') {
      // ED-7: only claim Esc when there is something to cancel; otherwise the shell opens Layout Mode.
      if (cancelGesture() || tool?.keyDown?.(e.nativeEvent, api)) return handled()
      if (selection.length > 0) {
        api.select([])
        handled()
      }
      return
    }
    if (tool?.keyDown?.(e.nativeEvent, api)) return handled()
    if (key === ' ') {
      if (!spaceDown) setSpaceDown(true)
      return handled()
    }
    if (isShortcut(e, 'app.undo')) return handled(), props.onUndo?.()
    if (isShortcut(e, 'app.redo')) return handled(), props.onRedo?.()
    if (mod) {
      const k = key.toLowerCase()
      if (k === 'a') api.select(selectableNodes(props.scene).map((n) => n.id))
      else if (k === 'd') {
        let ids: Id[] = []
        props.onChange((s) => {
          const r = duplicateNodes(s, selection)
          ids = r.ids
          return r.scene
        })
        api.select(ids)
      } else if (key === ']' || key === '}') props.onChange((s) => reorderNodes(s, selection, e.shiftKey ? 'front' : 'forward'))
      else if (key === '[' || key === '{') props.onChange((s) => reorderNodes(s, selection, e.shiftKey ? 'back' : 'backward'))
      else return
      return handled()
    }
    if (e.altKey) return
    if (key === 'Delete' || key === 'Backspace') {
      deleteSelection()
      return handled()
    }
    const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key]
    if (nudge) {
      if (selection.length === 0) return
      const step = e.shiftKey ? 10 : 1
      props.onChange((s) => translateNodes(s, selection, nudge[0] * step, nudge[1] * step, (n) => !!typeOf(n).absolute))
      return handled()
    }
    if (key === '+' || key === '=') return handled(), zoomCentered(ZOOM_STEP)
    if (key === '-' || key === '_') return handled(), zoomCentered(1 / ZOOM_STEP)
    if (key === '0') return handled(), zoomReset()
    if (key === '!' || (key === '1' && e.shiftKey)) return handled(), api.fitToContent()
    if (key.length === 1) {
      const t = tools.find((x) => boardShortcut(x.id, x.shortcut) === comboOf(e))
      if (!t) return
      api.setTool(t.id === toolId && t.toggle ? tools[0].id : t.id)
      handled()
    }
  }

  const onKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === ' ') setSpaceDown(false)
  }

  // v0.13: shortcuts also work while the focus is elsewhere in this tool (a side panel button, the toolbar),
  // not only right after clicking the canvas. Typing in a field still goes to the field.
  const keys = useRef({ onKeyDown, onKeyUp })
  useEffect(() => {
    keys.current = { onKeyDown, onKeyUp }
  })
  useEffect(() => {
    if (!props.active) return
    const forward = (kind: 'onKeyDown' | 'onKeyUp') => (e: KeyboardEvent) => {
      const root = rootRef.current
      const t = e.target as Node | null
      if (!root || e.defaultPrevented || e.key === 'Escape' || (t && root.contains(t)) || isTypingTarget(e.target)) return
      if (!(t === document.body || (t && root.closest('.panel')?.contains(t)))) return
      const shim = { key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey, target: e.target, nativeEvent: e, preventDefault: () => e.preventDefault() }
      keys.current[kind](shim as unknown as React.KeyboardEvent)
    }
    const down = forward('onKeyDown')
    const up = forward('onKeyUp')
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [props.active])

  // ---- transform handles ----

  const transformable = (n: NodeBase) => {
    const t = typeOf(n)
    return !n.locked && (t.transformable ?? !t.absolute)
  }

  const selectedNodes = selection.map((id) => nodeMap.get(id)).filter((n): n is N => !!n)
  const handleNodes = editing ? [] : selectedNodes.filter(transformable)

  useEffect(() => {
    const tr = trRef.current
    const stage = stageRef.current
    if (!tr || !stage) return
    const groups = handleNodes.map((n) => stage.findOne('#' + n.id)).filter((g): g is Konva.Node => !!g)
    tr.nodes(groups)
    tr.keepRatio(handleNodes.some((n) => typeOf(n).keepRatio))
    tr.rotateEnabled(handleNodes.every((n) => typeOf(n).rotatable !== false))
    tr.getLayer()?.batchDraw()
  })

  const onTransformEnd = () => {
    const tr = trRef.current
    if (!tr) return
    const attrs = new Map<Id, { x: number; y: number; rotation: number; scaleX: number; scaleY: number; group: Konva.Node }>()
    for (const g of tr.nodes()) attrs.set(g.id(), { x: g.x(), y: g.y(), rotation: g.rotation(), scaleX: g.scaleX(), scaleY: g.scaleY(), group: g })
    props.onChange((s) =>
      updateNodes(s, attrs.keys(), (n) => {
        const a = attrs.get(n.id)!
        const t = typeOf(n)
        const moved = { ...n, x: a.x, y: a.y, rotation: a.rotation }
        if (!t.resize) return { ...moved, scaleX: a.scaleX, scaleY: a.scaleY }
        // Bake the scale into the size and reset the Konva group, which React would not reset (props unchanged).
        a.group.scaleX(n.scaleX ?? 1)
        a.group.scaleY(n.scaleY ?? 1)
        return t.resize(moved, a.scaleX / (n.scaleX ?? 1), a.scaleY / (n.scaleY ?? 1))
      }),
    )
  }

  // ---- text editing ----

  const editNode = editing ? (editing.draft ?? (nodeMap.get(editing.id) as N | undefined)) : undefined
  const finishEdit = (text: string | null) => {
    const ed = live.current.editing
    setEditing(null)
    rootRef.current?.focus({ preventScroll: true })
    if (!ed || text === null) return
    if (ed.draft) {
      const spec = typeOf(ed.draft).textEdit
      if (!spec || text.trim() === '') return
      const node = spec.set(ed.draft, text) as N
      props.onChange((s) => addNodes(s, [node]))
      api.select([node.id])
      return
    }
    const node = live.current.nodeMap.get(ed.id)
    const spec = node && typeOf(node).textEdit
    if (!node || !spec) return
    if (text.trim() === '' && spec.deleteIfEmpty) props.onChange((s) => deleteNodes(s, [ed.id]))
    else if (spec.get(node) !== text) props.onChange((s) => updateNode(s, ed.id, (n) => spec.set(n, text) as N))
  }

  // ---- render ----

  const layers = renderOrder(scene)
  const s = viewport.scale
  const outlines = selectedNodes.filter((n) => !transformable(n) || editing).map((n) => ({ id: n.id, b: getWorldBounds(n.id) }))
  let gridStep = 24
  while (gridStep * s < 12) gridStep *= 2
  const cursor = panning ? 'grabbing' : spaceDown || tool?.id === 'hand' ? 'grab' : (tool?.cursor ?? 'default')

  return (
    <div
      ref={rootRef}
      className="canvas-root"
      tabIndex={0}
      aria-label={props.ariaLabel ?? 'Canvas'}
      style={{
        cursor,
        backgroundImage: props.grid === false ? undefined : 'radial-gradient(circle, var(--border) 1.2px, transparent 1.3px)',
        backgroundSize: `${gridStep * s}px ${gridStep * s}px`,
        backgroundPosition: `${viewport.x}px ${viewport.y}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={() => setSpaceDown(false)}
      onContextMenu={(e) => e.target instanceof HTMLCanvasElement && e.preventDefault()}
    >
      {size.width > 0 && (
        <Stage
          ref={stageRef}
          className="canvas-stage"
          width={size.width}
          height={size.height}
          x={viewport.x}
          y={viewport.y}
          scaleX={s}
          scaleY={s}
        >
          <KonvaLayer>
            {layers.map(({ layer, nodes }) =>
              layer.hidden ? null : (
                <Group key={layer.id} listening={!layer.locked}>
                  {nodes.map((n) =>
                    n.hidden ? null : <NodeView key={n.id} node={n} type={typeOf(n)} ctx={ctx} editingText={editing?.id === n.id} />,
                  )}
                </Group>
              ),
            )}
          </KonvaLayer>
          <KonvaLayer ref={overlayRef}>
            {draft?.map((n) => <NodeView key={n.id} node={n} type={typeOf(n)} ctx={ctx} editingText={false} draft />)}
            {outlines.map(({ id, b }) =>
              b ? (
                <Rect
                  key={id}
                  x={b.x - 4 / s}
                  y={b.y - 4 / s}
                  width={b.width + 8 / s}
                  height={b.height + 8 / s}
                  stroke={theme.accent}
                  strokeWidth={1.5 / s}
                  dash={[6 / s, 4 / s]}
                  listening={false}
                />
              ) : null,
            )}
            {marquee && (
              <Rect
                {...marquee}
                fill={theme.accent}
                opacity={0.12}
                stroke={theme.accent}
                strokeWidth={1 / s}
                listening={false}
              />
            )}
            {marquee && <Rect {...marquee} stroke={theme.accent} strokeWidth={1 / s} dash={[4 / s, 3 / s]} listening={false} />}
            <Transformer
              ref={trRef}
              borderStroke={theme.accent}
              anchorStroke={theme.accent}
              anchorFill={theme.bgElevated}
              anchorSize={8}
              anchorCornerRadius={2}
              rotateAnchorOffset={24}
              ignoreStroke
              flipEnabled={false}
              onTransformEnd={onTransformEnd}
            />
          </KonvaLayer>
        </Stage>
      )}
      {props.html && (
        <div className="canvas-html" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${s})` }}>
          {props.html(api, scene)}
        </div>
      )}
      {presenceKey && <RemoteCursors presenceKey={presenceKey} viewport={viewport} bounds={getWorldBounds} />}
      {editing && editNode && (
        <TextEditor key={editing.id} node={editNode} type={typeOf(editNode)} theme={theme} viewport={viewport} getBounds={(n) => typeOf(n).bounds(n, ctx)} onDone={finishEdit} />
      )}
      {props.showToolbar !== false && (
        <CanvasToolbar
          tools={tools}
          toolId={tool?.id ?? ''}
          onTool={(id) => {
            api.setTool(id)
            rootRef.current?.focus({ preventScroll: true })
          }}
          onUndo={props.onUndo}
          onRedo={props.onRedo}
          canUndo={props.canUndo}
          canRedo={props.canRedo}
          scale={s}
          onZoomIn={() => zoomCentered(ZOOM_STEP)}
          onZoomOut={() => zoomCentered(1 / ZOOM_STEP)}
          onZoomReset={zoomReset}
          onFit={() => api.fitToContent()}
        >
          {props.toolbarExtra}
        </CanvasToolbar>
      )}
    </div>
  )
}

type SceneNode<D extends { scene: Scene<any> }> = D['scene'] extends Scene<infer N> ? N : never

/** Helper for components that keep the scene under `scene` in their document. */
export function sceneBinding<D extends { scene: Scene<any> }>(doc: {
  data: D | undefined
  update(recipe: (d: D) => D, options?: UpdateOptions): void
  undo(): void
  redo(): void
  canUndo: boolean
  canRedo: boolean
}) {
  return {
    onChange: (recipe: SceneRecipe<SceneNode<D>>, options?: UpdateOptions) => doc.update((d) => ({ ...d, scene: recipe(d.scene) }), options),
    onUndo: doc.undo,
    onRedo: doc.redo,
    canUndo: doc.canUndo,
    canRedo: doc.canRedo,
  }
}
