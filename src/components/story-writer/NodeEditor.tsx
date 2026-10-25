import { useLayoutEffect, useRef, useState } from 'react'
import type { StoryNode } from './model'
import { STORY_NODE_LOOK, STORY_NODE_UI } from './storyNodeType'

const { PAD, TITLE_SIZE, BODY_SIZE, LINE_HEIGHT, DIVIDER } = STORY_NODE_LOOK

/**
 * Typing into a story node (0.21): title and story text laid over the node, nothing else around it.
 * Enter in the title goes to the story text, Shift+Tab or Up at its start goes back; Esc, Ctrl+Enter
 * or clicking away finishes. Drawn in the canvas' world space, so it zooms with the board.
 */
export function NodeEditor({ node, onDone }: { node: StoryNode; onDone(patch: { title: string; body: string } | null): void }) {
  const [title, setTitle] = useState(node.title)
  const [body, setBody] = useState(node.body)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)
  const finish = () => {
    if (done.current) return
    done.current = true
    onDone(title !== node.title || body !== node.body ? { title, body } : null)
  }

  const grow = (el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }
  useLayoutEffect(() => grow(titleRef.current), [title])
  useLayoutEffect(() => grow(bodyRef.current), [body])
  useLayoutEffect(() => {
    // A new node starts in the title; an existing one where there is less written.
    const el = node.title && !node.body ? bodyRef.current : titleRef.current
    el?.focus()
    el?.setSelectionRange(el.value.length, el.value.length)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- only when the editor opens
  }, [])

  const common = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault() // keeps Esc from toggling Layout Mode (ED-7)
      finish()
      return true
    }
    return false
  }

  return (
    <div
      className="story-node-editor"
      style={{ left: node.x, top: node.y, width: node.width, minHeight: node.minHeight, padding: PAD, ['--story-color' as string]: node.fillColor }}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && finish()}
    >
      <textarea
        ref={titleRef}
        className="story-node-editor-title"
        rows={1}
        value={title}
        placeholder={STORY_NODE_UI.titleHint}
        spellCheck
        style={{ fontSize: TITLE_SIZE, lineHeight: LINE_HEIGHT }}
        onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))}
        onKeyDown={(e) => {
          if (common(e)) return
          if (e.key === 'Enter' || (e.key === 'ArrowDown' && e.currentTarget.selectionStart === title.length)) {
            e.preventDefault()
            bodyRef.current?.focus()
            bodyRef.current?.setSelectionRange(0, 0)
          }
        }}
      />
      <div className="story-node-editor-line" style={{ margin: `${DIVIDER}px 0` }} />
      <textarea
        ref={bodyRef}
        className="story-node-editor-body"
        rows={2}
        value={body}
        placeholder={STORY_NODE_UI.bodyHint}
        spellCheck
        style={{ fontSize: BODY_SIZE, lineHeight: LINE_HEIGHT }}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (common(e)) return
          const atStart = e.currentTarget.selectionStart === 0 && e.currentTarget.selectionEnd === 0
          if ((e.key === 'Tab' && e.shiftKey) || (e.key === 'ArrowUp' && atStart)) {
            e.preventDefault()
            titleRef.current?.focus()
          }
        }}
      />
    </div>
  )
}
