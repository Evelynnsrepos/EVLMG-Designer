import { useLayoutEffect, useRef, useState } from 'react'
import { TEXT_LINE_HEIGHT } from './nodeTypes'
import type { CanvasTheme, NodeBase, NodeType, Rect, Viewport } from './types'

interface Props {
  node: NodeBase
  type: NodeType<any>
  theme: CanvasTheme
  viewport: Viewport
  /** Local (untransformed) bounds of the node. */
  getBounds(node: NodeBase): Rect
  /** New text, or null when nothing should change. */
  onDone(text: string | null): void
}

/** Textarea laid exactly over a node for inline editing. Enter adds lines; Esc, Ctrl+Enter or clicking away finishes. */
export function TextEditor({ node, type, theme, viewport, getBounds, onDone }: Props) {
  const spec = type.textEdit!
  const [value, setValue] = useState(() => spec.get(node))
  const ref = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)
  const grows = spec.autoWidth?.(node) ?? false

  const finish = (text: string | null) => {
    if (done.current) return
    done.current = true
    onDone(text)
  }

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (grows) {
      el.style.width = '0px'
      el.style.width = `${Math.max(40, el.scrollWidth + 4)}px`
    }
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- grows is fixed per edit
  }, [value])

  useLayoutEffect(() => {
    const el = ref.current
    el?.focus()
    el?.setSelectionRange(el.value.length, el.value.length)
  }, [])

  const b = getBounds(node)
  const pad = spec.padding ?? 0
  const s = viewport.scale
  const sx = node.scaleX ?? 1
  const sy = node.scaleY ?? 1
  const fontSize = spec.fontSize(node)

  return (
    <textarea
      ref={ref}
      className="canvas-text-editor"
      value={value}
      spellCheck
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault() // keeps Esc from toggling Layout Mode (ED-7)
          finish(value)
        }
      }}
      style={{
        left: node.x * s + viewport.x,
        top: node.y * s + viewport.y,
        width: grows ? undefined : Math.max(40, b.width - pad * 2),
        whiteSpace: grows ? 'pre' : undefined,
        minHeight: fontSize * TEXT_LINE_HEIGHT,
        fontSize,
        lineHeight: TEXT_LINE_HEIGHT,
        color: spec.color?.(node, theme) ?? theme.text,
        // Same order as Konva: rotate, then scale, then the local offset.
        transform: `rotate(${node.rotation ?? 0}deg) scale(${s * sx}, ${s * sy}) translate(${b.x + pad}px, ${b.y + pad}px)`,
      }}
    />
  )
}
