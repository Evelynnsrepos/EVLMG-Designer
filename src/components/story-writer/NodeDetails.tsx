import { CornerDownRight, ExternalLink, Flag, ImagePlus, Play, Trash2, X } from 'lucide-react'
import { useRef } from 'react'
import type { Id } from '@/core/model'
import { AssetImage } from '@/shared/AssetImage'
import { openExternalUrl, RefPicker } from '@/shared/links'
import type { RefProvider } from '@/shared/richtext'
import type { ConnectorNode } from '@/shared/canvas'
import { isUrlLink, STORY_COLORS, type StoryLink, type StoryNode, type StoryRole } from './model'
import { STORY_NODE_UI } from './storyNodeType'
import { ProofTextarea } from '@/shared/spell'

const DETAILS_UI = {
  heading: 'Node',
  title: 'Title',
  body: 'Text',
  color: 'Color',
  image: 'Image',
  chooseImage: 'Choose image',
  removeImage: 'Remove image',
  link: 'Link',
  linkNone: 'No link',
  linkUrl: 'Web address',
  linkNode: 'Another node',
  linkRef: 'Character, town, item...',
  urlPlaceholder: 'https://...',
  open: 'Open',
  goTo: 'Go to node',
  pickNode: 'Choose a node',
  missing: 'Missing link (the target was deleted)',
  remove: 'Remove link',
  deleteNode: 'Delete node',
  close: 'Close details',
  role: 'This node is',
  roles: { none: 'Scene', start: 'Start', end: 'Ending' } as Record<'none' | StoryRole, string>,
  choices: 'Choices after this',
  noChoices: 'None yet. Use + Add next under the node, or the Connect tool (L).',
  choiceHint: 'What the player picks (optional)',
}

type LinkMode = 'none' | 'url' | 'node' | 'ref'

function modeOf(link: StoryLink | null | undefined): LinkMode {
  if (!link) return 'none'
  if (isUrlLink(link)) return 'url'
  return link.kind === 'node' ? 'node' : 'ref'
}

export interface NodeDetailsProps {
  node: StoryNode
  /** Every story node, for "link to another node". */
  nodes: StoryNode[]
  refs: RefProvider
  /** `undoable: false` while typing continues an edit already recorded. */
  onPatch(patch: Partial<StoryNode>, options?: { undoable?: boolean }): void
  onColor(color: string): void
  onPickImage(): void
  onGoTo(id: Id): void
  onDelete(): void
  /** Arrows leaving this node with their targets (v0.33). */
  choices: { arrow: ConnectorNode; to: StoryNode }[]
  onChoiceText(arrowId: Id, text: string, options?: { undoable?: boolean }): void
  onClose(): void
  /** Esc in the panel: hand the keyboard back to the canvas so tool keys work again. */
  onEscape(): void
}

/** Side panel for the selected node: text, color, image and link (SW-1, SW-2). */
export function NodeDetails({ node, nodes, refs, onPatch, onColor, onPickImage, onGoTo, onDelete, onClose, onEscape, choices, onChoiceText }: NodeDetailsProps) {
  // One undo step per field edit: the first keystroke records, the rest replace it.
  const editing = useRef(false)
  const typed = (patch: Partial<StoryNode>) => {
    onPatch(patch, { undoable: !editing.current })
    editing.current = true
  }
  const fieldEvents = { onFocus: () => (editing.current = false), onBlur: () => (editing.current = false) }

  const link = node.link ?? null
  const mode = modeOf(link)
  const target = link && !isUrlLink(link) ? link : null
  const targetNode = target?.kind === 'node' ? nodes.find((n) => n.id === target.targetId) : undefined
  const targetRef = target && target.kind !== 'node' ? refs.resolve({ kind: target.kind, id: target.targetId }) : undefined

  const setMode = (m: LinkMode) => {
    if (m === mode) return
    if (m === 'none') onPatch({ link: null })
    else if (m === 'url') onPatch({ link: { kind: 'url', url: '' } })
    else if (m === 'node') onPatch({ link: { kind: 'node', targetId: '' } })
    else onPatch({ link: { kind: 'character', targetId: '' } })
  }

  return (
    <aside className="story-details" aria-label={DETAILS_UI.heading} onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault() // keep Layout Mode closed (ED-7)
          onEscape()
        }
      }}
    >
      <header className="story-details-head">
        <span>{DETAILS_UI.heading}</span>
        <button className="icon-btn" title={DETAILS_UI.close} aria-label={DETAILS_UI.close} onClick={onClose}>
          <X size={15} />
        </button>
      </header>

      <div className="story-field">
        <span>{DETAILS_UI.role}</span>
        <div className="story-seg" role="radiogroup" aria-label={DETAILS_UI.role}>
          {(['none', 'start', 'end'] as const).map((r) => {
            const on = (node.role ?? 'none') === r
            return (
              <button key={r} role="radio" aria-checked={on} className={'story-seg-btn' + (on ? ' on' : '')} onClick={() => onPatch({ role: r === 'none' ? undefined : r })}>
                {r === 'start' && <Play size={12} />}
                {r === 'end' && <Flag size={12} />}
                {DETAILS_UI.roles[r]}
              </button>
            )
          })}
        </div>
      </div>

      <label className="story-field">
        <span>{DETAILS_UI.title}</span>
        <input className="input" value={node.title} placeholder={STORY_NODE_UI.untitled} onChange={(e) => typed({ title: e.target.value })} {...fieldEvents} />
      </label>

      <label className="story-field">
        <span>{DETAILS_UI.body}</span>
        <ProofTextarea className="input story-body" value={node.body} rows={5} onChange={(e) => typed({ body: e.target.value })} {...fieldEvents} />
      </label>

      <div className="story-field">
        <span>{DETAILS_UI.choices}</span>
        {choices.length === 0 && <p className="story-note">{node.role === 'end' ? DETAILS_UI.roles.end : DETAILS_UI.noChoices}</p>}
        {choices.map(({ arrow, to }) => (
          <div key={arrow.id} className="story-choice" style={{ ['--story-color' as string]: to.fillColor }}>
            <CornerDownRight size={14} className="story-choice-icon" />
            <input
              className="input"
              value={arrow.label ?? ''}
              placeholder={to.title || STORY_NODE_UI.untitled}
              title={DETAILS_UI.choiceHint}
              aria-label={`${DETAILS_UI.choiceHint}: ${to.title || STORY_NODE_UI.untitled}`}
              onChange={(e) => {
                onChoiceText(arrow.id, e.target.value, { undoable: !editing.current })
                editing.current = true
              }}
              {...fieldEvents}
            />
            <button className="icon-btn" title={DETAILS_UI.goTo} aria-label={DETAILS_UI.goTo} onClick={() => onGoTo(to.id)}>
              <ExternalLink size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="story-field">
        <span>{DETAILS_UI.color}</span>
        <div className="story-swatches" role="radiogroup" aria-label={DETAILS_UI.color}>
          {STORY_COLORS.map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={c === node.fillColor}
              aria-label={c}
              className={'story-swatch' + (c === node.fillColor ? ' is-active' : '')}
              style={{ background: c }}
              onClick={() => onColor(c)}
            />
          ))}
        </div>
      </div>

      <div className="story-field">
        <span>{DETAILS_UI.image}</span>
        {node.src ? (
          <div className="story-image-row">
            <AssetImage path={node.src} alt={node.title || STORY_NODE_UI.untitled} size={56} />
            <button className="btn" onClick={onPickImage}>
              {DETAILS_UI.chooseImage}
            </button>
            <button className="icon-btn" title={DETAILS_UI.removeImage} aria-label={DETAILS_UI.removeImage} onClick={() => onPatch({ src: null })}>
              <Trash2 size={15} />
            </button>
          </div>
        ) : (
          <button className="btn" onClick={onPickImage}>
            <ImagePlus size={15} /> {DETAILS_UI.chooseImage}
          </button>
        )}
      </div>

      <div className="story-field">
        <span>{DETAILS_UI.link}</span>
        <select className="input" value={mode} onChange={(e) => setMode(e.target.value as LinkMode)} aria-label={DETAILS_UI.link}>
          <option value="none">{DETAILS_UI.linkNone}</option>
          <option value="url">{DETAILS_UI.linkUrl}</option>
          <option value="node">{DETAILS_UI.linkNode}</option>
          <option value="ref">{DETAILS_UI.linkRef}</option>
        </select>

        {link && isUrlLink(link) && (
          <div className="story-link-row">
            <input
              className="input"
              value={link.url}
              placeholder={DETAILS_UI.urlPlaceholder}
              onChange={(e) => typed({ link: { kind: 'url', url: e.target.value } })}
              {...fieldEvents}
            />
            <button className="icon-btn" title={DETAILS_UI.open} aria-label={DETAILS_UI.open} disabled={!link.url.trim()} onClick={() => void openExternalUrl(link.url)}>
              <ExternalLink size={15} />
            </button>
          </div>
        )}

        {mode === 'node' && target && (
          <div className="story-link-row">
            <select
              className="input"
              value={targetNode ? target.targetId : ''}
              aria-label={DETAILS_UI.pickNode}
              onChange={(e) => onPatch({ link: { kind: 'node', targetId: e.target.value } })}
            >
              <option value="">{DETAILS_UI.pickNode}</option>
              {nodes
                .filter((n) => n.id !== node.id)
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title || STORY_NODE_UI.untitled}
                  </option>
                ))}
            </select>
            <button className="icon-btn" title={DETAILS_UI.goTo} aria-label={DETAILS_UI.goTo} disabled={!targetNode} onClick={() => targetNode && onGoTo(targetNode.id)}>
              <ExternalLink size={15} />
            </button>
          </div>
        )}

        {mode === 'ref' && target && (
          <>
            {target.targetId && (
              <div className="story-link-row">
                {targetRef ? (
                  <button className="btn story-ref-chip" title={DETAILS_UI.open} onClick={() => refs.open?.({ kind: target.kind, id: target.targetId })}>
                    {targetRef.label}
                    {targetRef.hint && <small>{targetRef.hint}</small>}
                  </button>
                ) : (
                  <span className="story-missing">{DETAILS_UI.missing}</span>
                )}
                <button className="icon-btn" title={DETAILS_UI.remove} aria-label={DETAILS_UI.remove} onClick={() => onPatch({ link: { kind: 'character', targetId: '' } })}>
                  <X size={15} />
                </button>
              </div>
            )}
            <RefPicker provider={refs} onPick={(item) => onPatch({ link: { kind: item.kind, targetId: item.id } })} />
          </>
        )}
      </div>

      <button className="btn btn-danger story-delete" onClick={onDelete}>
        <Trash2 size={15} /> {DETAILS_UI.deleteNode}
      </button>
    </aside>
  )
}
