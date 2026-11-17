import { Download, Flag, GitBranchPlus, LayoutGrid, Link2, MousePointer2, PanelRight, Play, Plus, Scissors } from 'lucide-react'
import { useHotwheel, type HotAction } from '@/shared/hotwheel'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { pickAndImportAssets, useAssetUrls } from '@/core/assets'
import type { Id } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { saveTextFile, safeFileName } from '@/core/export'
import { useDocument, useProjectStore } from '@/core/state'
import { CanvasEditor, deleteNodes, handTool, rectCenter, sceneBinding, selectTool, useCanvasState, type CanvasApi, type CanvasTool } from '@/shared/canvas'
import { combineRefProviders, useEntityRefProvider } from '@/shared/richtext'
import { useArticleRefProvider } from '@/shared/wiki'
import { addFollower, choicesOf, createDefaultStory, isStoryNode, isUrlLink, NEW_NODE_HEIGHT, patchStoryNode, setChoiceText, setNodeColor, STORY_COLORS, storyNodes, tidyLayout, toTwee, type StoryItem, type StoryLink } from './model'
import { PlayStory } from './PlayStory'
import { OVERVIEW_UI } from './overviewUi'
import { StoryOverview } from './StoryOverview'
import { NodeDetails } from './NodeDetails'
import { NodeEditor } from './NodeEditor'
import { makeStoryNodeTypes, STORY_NODE_UI } from './storyNodeType'
import { connectTool, createTool, severTool, type StoryToolHost } from './tools'
import './story-writer.css'

const HOTWHEEL_UI = {
  create: 'Create (C)',
  select: 'Select (V)',
  connect: 'Connect (L)',
  sever: 'Sever (S)',
  panel: 'Side panel',
}

const UI = {
  canvas: 'Story canvas',
  details: 'Side panel: story overview, or the selected node’s details',
  emptyTitle: 'Write a branching story',
  emptySteps: [
    'Click anywhere to place the first scene and type it.',
    'Click again: the next scene is connected to the last one.',
    'Click an older scene, then empty space, to branch into a choice.',
  ],
  pickColor: 'Color for this branch',
  addNext: 'Add next',
  addChoice: 'Add choice',
  addHint: 'A new scene after this one; a second one makes it a choice',
  ending: 'Ending',
  endingHint: 'Mark this scene as an ending (the line is meant to stop here)',
  playFrom: 'Play from here',
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
  /** v0.33 play mode: undefined = off, null = from the start, an id = from that node. */
  const [playFrom, setPlayFrom] = useState<Id | null | undefined>(undefined)
  const docTitle = useProjectStore((s) => s.meta?.documents.find((d) => d.id === documentId)?.title ?? '')

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

  // QuickSelect (hold Q): the story's tools and actions, the node ones only while one node is selected.
  useHotwheel(() => {
    if (!doc.data) return []
    const tool = (id: string, label: string, icon: HotAction['icon']): HotAction => ({ id: `story.${id}`, label, icon, on: canvas.toolId === id, run: () => apiRef.current?.setTool(id) })
    const sel = selectedNode
    return [
      tool('create', HOTWHEEL_UI.create, Plus),
      tool('select', HOTWHEEL_UI.select, MousePointer2),
      tool('connect', HOTWHEEL_UI.connect, Link2),
      tool('sever', HOTWHEEL_UI.sever, Scissors),
      ...(sel
        ? [
            { id: 'story.add', label: choicesOf(scene!, sel.id).length ? UI.addChoice : UI.addNext, icon: GitBranchPlus, run: () => addAfter(sel.id) },
            { id: 'story.ending', label: UI.ending, icon: Flag, on: sel.role === 'end', run: () => patch(sel.id, { role: sel.role === 'end' ? undefined : 'end' }) },
          ]
        : [{ id: 'story.tidy', label: OVERVIEW_UI.tidy, icon: LayoutGrid, run: tidy }]),
      { id: 'story.play', label: sel ? UI.playFrom : OVERVIEW_UI.play, icon: Play, run: () => nodes.length && setPlayFrom(sel?.id ?? null) },
      { id: 'story.panel', label: HOTWHEEL_UI.panel, icon: PanelRight, on: showDetails, run: () => setShowDetails((v) => !v) },
      { id: 'story.twine', label: OVERVIEW_UI.twine, icon: Download, run: exportTwine },
    ]
  })

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
  const heightOf = (id: Id) => apiRef.current?.getWorldBounds(id)?.height ?? NEW_NODE_HEIGHT

  /** The + under a node: a new scene after it, typed right away. */
  const addAfter = (fromId: Id) => {
    let made: ReturnType<typeof addFollower> = null
    binding.onChange((s) => {
      made = addFollower(s, fromId, heightOf)
      return made?.scene ?? s
    })
    const r = made as ReturnType<typeof addFollower>
    if (!r) return
    setLastId(r.node.id)
    apiRef.current?.select([r.node.id])
    if (r.isBranch) setColorOfferId(r.node.id)
    setEditingId(r.node.id)
  }
  // Declared as functions so the QuickSelect (set up above the loading check) can call them.
  function tidy() {
    binding.onChange((s) => tidyLayout(s, heightOf))
    requestAnimationFrame(() => apiRef.current?.fitToContent())
  }
  function exportTwine() {
    void saveTextFile({ title: OVERVIEW_UI.twine, defaultName: `${safeFileName(docTitle, 'story')}.twee`, text: toTwee(scene!, docTitle), filter: { name: 'Twine story', extensions: ['twee'] } })
  }

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
    <div
      className="story-root"
      onKeyDown={(e) => {
        // P plays the story (when typing nowhere); tool letters are handled by the canvas.
        const el = e.target as HTMLElement
        if (!active || e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== 'p' || el.closest('input, textarea, [contenteditable="true"]') || !nodes.length) return
        e.preventDefault()
        setPlayFrom(selectedNode?.id ?? null)
      }}
    >
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
            <>
            <button
              className="canvas-toolbar-btn"
              title={OVERVIEW_UI.playHint}
              aria-label={OVERVIEW_UI.play}
              disabled={!nodes.length}
              onClick={() => setPlayFrom(null)}
            >
              <Play size={17} strokeWidth={1.8} />
            </button>
            <button
              className={'canvas-toolbar-btn' + (showDetails ? ' is-active' : '')}
              title={UI.details}
              aria-label={UI.details}
              aria-pressed={showDetails}
              onClick={() => setShowDetails((v) => !v)}
            >
              <PanelRight size={17} strokeWidth={1.8} />
            </button>
            </>
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
            if (!offerId) {
              const qn = selectedNode && (canvas.toolId === 'select' || canvas.toolId === 'create') ? selectedNode : undefined
              const qb = qn && api.getWorldBounds(qn.id)
              if (!qn || !qb) return null
              const hasNext = choicesOf(scene, qn.id).length > 0
              return (
                <div className="story-quick" style={{ left: qb.x, top: qb.y + qb.height + 10 }} onPointerDown={(e) => e.stopPropagation()}>
                  <button className="story-quick-btn is-main" title={UI.addHint} onClick={() => addAfter(qn.id)}>
                    <Plus size={14} /> {hasNext ? UI.addChoice : UI.addNext}
                  </button>
                  <button
                    className={'story-quick-btn' + (qn.role === 'end' ? ' on' : '')}
                    title={UI.endingHint}
                    aria-pressed={qn.role === 'end'}
                    onClick={() => patch(qn.id, { role: qn.role === 'end' ? undefined : 'end' })}
                  >
                    <Flag size={13} /> {UI.ending}
                  </button>
                  <button className="story-quick-btn" title={UI.playFrom} aria-label={UI.playFrom} onClick={() => setPlayFrom(qn.id)}>
                    <Play size={13} />
                  </button>
                </div>
              )
            }
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
        {nodes.length === 0 && (
          <div className="story-empty-hint">
            <strong>{UI.emptyTitle}</strong>
            <ol>
              {UI.emptySteps.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ol>
          </div>
        )}
        {playFrom !== undefined && (
          <PlayStory
            scene={scene}
            fromId={playFrom}
            onClose={() => {
              setPlayFrom(undefined)
              wrapRef.current?.querySelector<HTMLElement>('.canvas-root')?.focus()
            }}
            onEdit={(id) => {
              setPlayFrom(undefined)
              apiRef.current?.setTool('select')
              goTo(id)
            }}
          />
        )}
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
          choices={choicesOf(scene, selectedNode.id)}
          onChoiceText={(arrowId, text, o) => binding.onChange((s) => setChoiceText(s, arrowId, text), o)}
        />
      )}
      {!selectedNode && showDetails && nodes.length > 0 && (
        <StoryOverview scene={scene} onGoTo={(id) => (apiRef.current?.setTool('select'), goTo(id))} onPlay={() => setPlayFrom(null)} onTidy={tidy} onTwine={exportTwine} onClose={() => setShowDetails(false)} />
      )}
    </div>
  )
}
