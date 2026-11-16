import { ArrowLeft, Flag, Pencil, RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Id } from '@/core/model'
import { useAssetUrl } from '@/core/assets'
import type { Scene } from '@/shared/canvas'
import { choicesOf, storyNodes, storyStarts, type StoryItem } from './model'
import { STORY_NODE_UI } from './storyNodeType'

const PLAY_UI = {
  label: 'Play through the story',
  back: 'Back',
  restart: 'Start again',
  edit: 'Edit this node',
  close: 'Stop playing (Esc)',
  theEnd: 'The end',
  stuck: 'This line stops here. Mark it as an ending, or add what comes next.',
  steps: (n: number) => `Step ${n}`,
}

/** Play mode (v0.33): read the story as a player would, one node at a time, with its choices as buttons. */
export function PlayStory({ scene, fromId, onClose, onEdit }: { scene: Scene<StoryItem>; fromId?: Id | null; onClose(): void; onEdit(id: Id): void }) {
  const first = () => (fromId && storyNodes(scene).some((n) => n.id === fromId) ? fromId : storyStarts(scene)[0]?.id)
  const [path, setPath] = useState<Id[]>(() => {
    const id = first()
    return id ? [id] : []
  })
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => root.current?.focus(), [])
  const node = storyNodes(scene).find((n) => n.id === path[path.length - 1])
  const choices = node ? choicesOf(scene, node.id) : []
  const image = useAssetUrl(node?.src)
  const restart = () => setPath([storyStarts(scene)[0]?.id].filter(Boolean) as Id[])

  return (
    <div
      className="story-play"
      role="dialog"
      aria-label={PLAY_UI.label}
      tabIndex={-1}
      ref={root}
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') {
          e.preventDefault()
          onClose()
        } else if (/^[1-9]$/.test(e.key) && choices[Number(e.key) - 1]) setPath([...path, choices[Number(e.key) - 1].to.id])
        else if (e.key === 'Backspace' && path.length > 1) setPath(path.slice(0, -1))
      }}
    >
      <div className="story-play-card" style={{ ['--story-color' as string]: node?.fillColor ?? 'var(--accent)' }}>
        <header className="story-play-head">
          <span className="story-play-step">{PLAY_UI.steps(path.length)}</span>
          <button className="icon-btn" title={PLAY_UI.back} aria-label={PLAY_UI.back} disabled={path.length < 2} onClick={() => setPath(path.slice(0, -1))}>
            <ArrowLeft size={16} />
          </button>
          <button className="icon-btn" title={PLAY_UI.restart} aria-label={PLAY_UI.restart} onClick={restart}>
            <RotateCcw size={16} />
          </button>
          {node && (
            <button className="icon-btn" title={PLAY_UI.edit} aria-label={PLAY_UI.edit} onClick={() => onEdit(node.id)}>
              <Pencil size={15} />
            </button>
          )}
          <button className="icon-btn" title={PLAY_UI.close} aria-label={PLAY_UI.close} onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        {node && (
          <>
            <h2>{node.title || STORY_NODE_UI.untitled}</h2>
            {image && <img src={image} alt="" className="story-play-image" />}
            {node.body && <p className="story-play-body">{node.body}</p>}
            <div className="story-play-choices">
              {choices.map(({ arrow, to }, i) => (
                <button key={arrow.id} className="story-play-choice" style={{ ['--story-color' as string]: to.fillColor }} onClick={() => setPath([...path, to.id])}>
                  <kbd>{i + 1}</kbd>
                  {arrow.label?.trim() || to.title || STORY_NODE_UI.untitled}
                </button>
              ))}
              {!choices.length && (
                <p className={'story-play-end' + (node.role === 'end' ? ' is-end' : '')}>
                  {node.role === 'end' ? (
                    <>
                      <Flag size={15} /> {PLAY_UI.theEnd}
                    </>
                  ) : (
                    PLAY_UI.stuck
                  )}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
