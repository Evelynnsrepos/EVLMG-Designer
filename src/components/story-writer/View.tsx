import { PanelRight } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { pickAndImportAssets, useAssetUrls } from '@/core/assets'
import type { Id } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useProjectStore } from '@/core/state'
import { CanvasEditor, deleteNodes, handTool, rectCenter, sceneBinding, selectTool, useCanvasState, type CanvasApi, type CanvasTool } from '@/shared/canvas'
import { combineRefProviders, useEntityRefProvider } from '@/shared/richtext'
import { useArticleRefProvider } from '@/shared/wiki'
import { createDefaultStory, isStoryNode, isUrlLink, patchStoryNode, setNodeColor, STORY_COLORS, storyNodes, type StoryItem, type StoryLink } from './model'
import { NodeDetails } from './NodeDetails'
import { NodeEditor } from './NodeEditor'
import { makeStoryNodeTypes, STORY_NODE_UI } from './storyNodeType'
import { connectTool, createTool, severTool, type StoryToolHost } from './tools'
import './story-writer.css'

const UI = {
  canvas: 'Story canvas',
  details: 'Node details (with the Select tool)',
  emptyHint: 'Click anywhere to make the first node. Each next click adds a node connected to the last one; click an older node to branch from it.',
  pickColor: 'Color for this branch',
}

export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument('story-writer', documentId!, createDefaultStory)
  const root = useProjectStore((s) => s.root)
  const entityRefs = useEntityRefProvider()
  const articleRefs = useArticleRefProvider()
  const refs = useMemo(() => combineRefProviders(articleRefs, entityRefs), [articleRefs, entityRefs])
  const canvas = useCanvasState({ toolId: 'create' })
  const apiRef = useRef<CanvasApi<StoryItem> | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const [lastId, setLastId] = useState<Id | null>(null)
  const [pendingId, setPendingId] = useState<Id | null>(null)
  const [severHoverId, setSeverHoverId] = useState<Id | null>(null)
  const [colorOfferId, setColorOfferId] = useState<Id | null>(null)
  const [showDetails, setShowDetails] = useState(true)
  /** 0.21: node open for typing (double-click, or right after Create). */
  const [editingId, setEditingId] = useState<Id | null>(null)

  // The color offer belongs to the node just created; it goes away once that node is no longer selected.
  const offerId = colorOfferId && canvas.selection.includes(colorOfferId) ? colorOfferId : null

  // Tools are created once and read current view state through refs.
  const live = useRef({ lastId, pendingId, colorOfferId: offerId })
  useLayoutEffect(() => {
    live.current = { lastId, pendingId, colorOfferId: offerId }
  })
  const tools = useMemo<CanvasTool<StoryItem>[]>(() => {
    const host: StoryToolHost = {
      getLastId: () => live.current.lastId,
      setLastId: (id) => {
        live.current.lastId = id
        setLastId(id)
      },
      getPendingId: () => live.current.pendingId,
      setPendingId: (id) => {
        live.current.pendingId = id
        setPendingId(id)
      },
      setSeverHoverId,
      offerColors: (id) => {
        live.current.colorOfferId = id
        setColorOfferId(id)
      },
      closeColorOffer: () => {
        const open = live.current.colorOfferId !== null
        live.current.colorOfferId = null
        setColorOfferId(null)
        return open
      },
      editNode: setEditingId,
    }
    return [selectTool, createTool(host), severTool(host), connectTool(host), handTool]
  }, [])

  // Unselect while typing so no handles or outlines sit around the node; it is selected again after.
  useEffect(() => {
    if (editingId) apiRef.current?.select([])
  }, [editingId])

  const scene = doc.data?.scene
  const nodes = useMemo(() => (scene ? storyNodes(scene) : []), [scene])

  const linkLabel = useMemo(
    () =>
      (link: StoryLink): string | null => {
        if (isUrlLink(link)) return link.url
        if (link.kind === 'node') {
          const n = nodes.find((x) => x.id === link.targetId)
          return n ? n.title || STORY_NODE_UI.untitled : null
        }
        return refs.resolve({ kind: link.kind, id: link.targetId })?.label ?? null
      },
    [nodes, refs],
  )
  const nodeTypes = useMemo(() => makeStoryNodeTypes({ lastId, pendingId, severHoverId, linkLabel, editingId }), [lastId, pendingId, severHoverId, linkLabel, editingId])
  const resolveImageSrc = useAssetUrls(nodes.map((n) => n.src))

  if (!doc.data || !scene) return null
  const binding = sceneBinding(doc)

  const selected = canvas.selection.length === 1 ? scene.nodes.find((n) => n.id === canvas.selection[0]) : undefined
  const selectedNode = isStoryNode(selected) ? selected : undefined

  const patch = (id: Id, p: Parameters<typeof patchStoryNode>[2], options?: { undoable?: boolean }) =>
    binding.onChange((s) => patchStoryNode(s, id, p), options)
  const recolor = (id: Id, color: string) => binding.onChange((s) => setNodeColor(s, id, color))

  const pickImage = async (id: Id) => {
    if (!root) return
    const [asset] = await pickAndImportAssets(root, 'image')
    if (asset) patch(id, { src: asset.path })
  }

  const goTo = (id: Id) => {
    const api = apiRef.current
    const b = api?.getWorldBounds(id)
    const el = wrapRef.current
    if (!api || !b || !el) return
    const c = rectCenter(b)
    const s = api.viewport.scale
    api.setViewport({ scale: s, x: el.clientWidth / 2 - c.x * s, y: el.clientHeight / 2 - c.y * s })
    api.select([id])
  }

  return (
    <div className="story-root">
      <div className="story-canvas" ref={wrapRef}>
        <CanvasEditor<StoryItem>
          scene={scene}
          {...binding}
          active={active}
          tools={tools}
          nodeTypes={nodeTypes}
          canvas={canvas}
          apiRef={apiRef}
          resolveImageSrc={resolveImageSrc}
          ariaLabel={UI.canvas}
          toolbarExtra={
            <button
              className={'canvas-toolbar-btn' + (showDetails ? ' is-active' : '')}
              title={UI.details}
              aria-label={UI.details}
              aria-pressed={showDetails}
              onClick={() => setShowDetails((v) => !v)}
            >
              <PanelRight size={17} strokeWidth={1.8} />
            </button>
          }
          onNodeDoubleClick={(id, api) => {
            if (isStoryNode(api.scene.nodes.find((n) => n.id === id))) setEditingId(id)
          }}
          html={(api) => {
            const editNode = editingId ? nodes.find((n) => n.id === editingId) : undefined
            if (editNode)
              return (
                <NodeEditor
                  key={editNode.id}
                  node={editNode}
                  onDone={(p) => {
                    setEditingId(null)
                    if (p) patch(editNode.id, p)
                    api.select([editNode.id])
                  }}
                />
              )
            if (!offerId) return null
            const b = api.getWorldBounds(offerId)
            if (!b) return null
            return (
              <div className="story-color-offer" style={{ left: b.x, top: b.y + b.height + 10 }} role="radiogroup" aria-label={UI.pickColor}>
                <span>{UI.pickColor}</span>
                {STORY_COLORS.map((c) => (
                  <button
                    key={c}
                    role="radio"
                    aria-label={c}
                    aria-checked={nodes.find((n) => n.id === offerId)?.fillColor === c}
                    className="story-swatch"
                    style={{ background: c }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => {
                      recolor(offerId, c)
                      setColorOfferId(null)
                    }}
                  />
                ))}
              </div>
            )
          }}
        />
        {nodes.length === 0 && <p className="story-empty-hint">{UI.emptyHint}</p>}
      </div>
      {/* Details belong to the Select tool (SW-8), so they never cover the canvas while creating or linking. */}
      {selectedNode && showDetails && canvas.toolId === 'select' && (
        <NodeDetails
          key={selectedNode.id}
          node={selectedNode}
          nodes={nodes}
          refs={refs}
          onPatch={(p, o) => patch(selectedNode.id, p, o)}
          onColor={(c) => recolor(selectedNode.id, c)}
          onPickImage={() => void pickImage(selectedNode.id)}
          onGoTo={goTo}
          onDelete={() => {
            binding.onChange((s) => deleteNodes(s, [selectedNode.id]))
            canvas.setSelection([])
          }}
          onClose={() => setShowDetails(false)}
          onEscape={() => wrapRef.current?.querySelector<HTMLElement>('.canvas-root')?.focus()}
        />
      )}
    </div>
  )
}
