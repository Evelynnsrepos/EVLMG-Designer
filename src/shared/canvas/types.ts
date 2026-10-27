import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Id } from '@/core/model'

export type { Id }

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Maps world to screen: `screen = world * scale + (x, y)`. */
export interface Viewport {
  x: number
  y: number
  scale: number
}

/**
 * Every object on a canvas. Components add their own kinds by extending this
 * (e.g. `interface StoryNode extends NodeBase { kind: 'story-node'; title: string }`)
 * and registering a `NodeType` for the kind.
 *
 * Store non-prose strings under keys the word counter skips (`*Id`, `*Color`, `kind`, `src`, ...; see AGENTS.md).
 */
export interface NodeBase {
  id: Id
  kind: string
  layerId: Id
  /** Position of the node's origin in world units. */
  x: number
  y: number
  /** Degrees, clockwise. */
  rotation?: number
  scaleX?: number
  scaleY?: number
  /** Optional user label, e.g. shown in a layers panel. */
  name?: string
  hidden?: boolean
  locked?: boolean
}

export interface RectNode extends NodeBase {
  kind: 'rect'
  width: number
  height: number
  fillColor?: string
  strokeColor?: string
  strokeWidth?: number
  cornerRadius?: number
}

export interface EllipseNode extends NodeBase {
  kind: 'ellipse'
  width: number
  height: number
  fillColor?: string
  strokeColor?: string
  strokeWidth?: number
}

/** Straight line, arrow or freehand pen stroke. `points` are relative to (x, y). */
export interface LineNode extends NodeBase {
  kind: 'line'
  points: number[]
  strokeColor?: string
  strokeWidth?: number
  arrow?: boolean
  /** Smooth the stroke (freehand pen). */
  smooth?: boolean
  /** 0..1, pen strokes only. */
  opacity?: number
}

export interface TextNode extends NodeBase {
  kind: 'text'
  text: string
  fontSize: number
  width: number
  textColor?: string
  /** v0.20: the box is as wide as its longest line (no wrapping) until the user resizes it. */
  autoWidth?: boolean
}

/** Sticky note: colored square with text. */
export interface NoteNode extends NodeBase {
  kind: 'note'
  text: string
  width: number
  height: number
  fillColor?: string
}

export interface ImageNode extends NodeBase {
  kind: 'image'
  /** Project-relative asset path (or any URL); resolved through `resolveImageSrc`. Missing images show the placeholder. */
  src: string
  width: number
  height: number
}

/**
 * A line between two other nodes that follows them when they move (story links, brainstorm strings).
 * Deleting either end deletes the connector. Its own x/y are unused.
 */
export interface ConnectorNode extends NodeBase {
  kind: 'connector'
  fromId: Id
  toId: Id
  strokeColor?: string
  strokeWidth?: number
  /** Arrow head at the `to` end (default true). */
  arrow?: boolean
  dashed?: boolean
  label?: string
}

/** v0.17: a jump point on a board; double-click (or click with the jump tool) goes to its target. */
export interface JumpNode extends NodeBase {
  kind: 'jump'
  target: import('@/core/model').LinkTarget
  /** The target's name when it was placed (shown on the board). */
  label: string
}

/** Review comment pin (v0.7); its thread lives in the Reviews data. */
export interface CommentPinNode extends NodeBase {
  kind: 'comment-pin'
}

export type BuiltinNode = RectNode | EllipseNode | LineNode | TextNode | NoteNode | ImageNode | ConnectorNode

/** A drawing group. Layers are ordered bottom to top; `alwaysOnTop` layers render above all others (MB-6). */
export interface Layer {
  id: Id
  name: string
  hidden?: boolean
  locked?: boolean
  alwaysOnTop?: boolean
}

/** What a canvas component stores (usually inside its own document type). */
export interface Scene<N extends NodeBase = BuiltinNode> {
  layers: Layer[]
  /** Z-order inside each layer follows array order (later = above). */
  nodes: N[]
}

export type SceneRecipe<N extends NodeBase> = (scene: Scene<N>) => Scene<N>

export interface UpdateOptions {
  /** false for transient changes; see AGENTS.md. Defaults to true. */
  undoable?: boolean
}

/** Colors resolved from the CSS theme tokens, for drawing on the canvas. */
export interface CanvasTheme {
  bg: string
  bgElevated: string
  bgSunken: string
  border: string
  text: string
  textMuted: string
  accent: string
  danger: string
  focus: string
  font: string
}

export interface RenderContext {
  theme: CanvasTheme
  /** Turns a stored image path into a loadable URL. */
  resolveImageSrc(src: string): string
  getNode(id: Id): NodeBase | undefined
  /** World-space axis-aligned bounds of any node, or null if it does not exist. */
  getWorldBounds(id: Id): Rect | null
}

export interface TextEditSpec<N extends NodeBase> {
  get(node: N): string
  /** `theme` is passed when an edit finishes, so a kind can measure the new text. */
  set(node: N, text: string, theme?: CanvasTheme): N
  fontSize(node: N): number
  /** Inner padding in world units. */
  padding?: number
  color?(node: N, theme: CanvasTheme): string
  /** Remove the node when the edit leaves it empty (default false). */
  deleteIfEmpty?: boolean
  /** The editor grows with the typed text instead of wrapping (auto-width text). */
  autoWidth?(node: N): boolean
}

/** How a node kind draws and behaves. Register custom kinds through `nodeTypes`. */
export interface NodeType<N extends NodeBase = NodeBase> {
  /** Default label, e.g. "Rectangle". */
  label: string
  /** Konva elements in the node's local space (the engine positions, rotates and scales them). */
  render(node: N, ctx: RenderContext): ReactNode
  /** Local bounds before rotation/scale; for `absolute` kinds, world bounds. */
  bounds(node: N, ctx: RenderContext): Rect
  /** Drawn in world space, ignoring x/y/rotation/scale (connectors). Absolute kinds cannot be moved or transformed. */
  absolute?: boolean
  /** Allow the transform handles (default true unless absolute). */
  transformable?: boolean
  rotatable?: boolean
  keepRatio?: boolean
  /** Bake a resize into the node instead of storing scaleX/scaleY (sharper text and strokes). */
  resize?(node: N, scaleX: number, scaleY: number): N
  /** Inline text editing on double-click. */
  textEdit?: TextEditSpec<N>
  /** Set false when rendering depends on other nodes (re-render every frame). Default true. */
  memo?: boolean
}

export type NodeTypes = Record<string, NodeType<any>>

export interface ToolPointerEvent {
  world: Point
  screen: Point
  /** The node under the pointer (topmost, not locked), or null for empty canvas. */
  targetId: Id | null
  button: number
  shift: boolean
  alt: boolean
  /** Ctrl on Windows/Linux, Cmd on macOS. */
  mod: boolean
  /** 2 for the second click of a double-click. */
  clickCount: number
}

/** Returned by `pointerDown` to follow a drag until release. */
export interface ToolGesture {
  move?(e: ToolPointerEvent): void
  up?(e: ToolPointerEvent): void
  /** Esc or pointer cancel: undo previews and drafts. */
  cancel?(): void
}

export interface CanvasApi<N extends NodeBase = NodeBase> {
  /** The saved scene (without any preview). */
  readonly scene: Scene<N>
  readonly nodeTypes: NodeTypes
  update(recipe: SceneRecipe<N>, options?: UpdateOptions): void
  /** Show a transient change (e.g. while dragging) without saving or recording undo. */
  preview(recipe: SceneRecipe<N> | null): void
  /** Save the current preview as one undoable change. */
  commitPreview(): void
  readonly selection: Id[]
  select(ids: Id[], mode?: 'replace' | 'add' | 'toggle'): void
  readonly toolId: string
  setTool(id: string): void
  /** Non-interactive nodes drawn above everything (shape being drawn). */
  setDraft(nodes: N[] | null): void
  /** Dashed selection box in world units (select tool). */
  setMarquee(rect: Rect | null): void
  /** Double-click action: `onNodeDoubleClick` if given, else inline text editing. */
  activateNode(id: Id): void
  readonly viewport: Viewport
  setViewport(v: Viewport): void
  /** Layer where tools add new nodes. */
  readonly activeLayerId: Id
  /** With `layerScoped`, the only layer that can be selected and edited (the active one); null otherwise. */
  readonly scopeLayerId: Id | null
  screenToWorld(p: Point): Point
  getWorldBounds(id: Id): Rect | null
  /** Start inline text editing of an existing node, or of a new node that is added only if the text is not empty. */
  editText(id: Id, newNode?: N): void
  /** Zoom so all visible nodes fit. */
  fitToContent(): void
  /** PNG data URL of the given world area (default: all content), without selection handles. */
  exportPng(options?: { pixelRatio?: number; area?: Rect; padding?: number; background?: string }): string | null
}

export interface CanvasTool<N extends NodeBase = NodeBase> {
  id: string
  label: string
  icon?: LucideIcon
  /** Single key, e.g. 'V'. Only works while the canvas panel is active. */
  shortcut?: string
  cursor?: string
  /** Pressing the shortcut again returns to the first tool (TL-6). */
  toggle?: boolean
  pointerDown?(e: ToolPointerEvent, api: CanvasApi<N>): ToolGesture | void
  /** Pointer moved with no button pressed. */
  hover?(e: ToolPointerEvent | null, api: CanvasApi<N>): void
  /** Return true when the tool used the key (Esc included: return true to keep Layout Mode closed). */
  keyDown?(e: KeyboardEvent, api: CanvasApi<N>): boolean
  /** Called when the user switches away from this tool. */
  deactivate?(api: CanvasApi<N>): void
}
