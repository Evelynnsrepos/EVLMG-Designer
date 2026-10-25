import { Group, Rect, Text } from 'react-konva'
import { BUILTIN_NODE_TYPES, CanvasImage, measureTextHeight, type ConnectorNode, type NodeType, type NodeTypes, type RenderContext } from '@/shared/canvas'
import { isLinkSet, MIN_NODE_WIDTH, type StoryLink, type StoryNode } from './model'

export const STORY_NODE_UI = {
  untitled: 'Untitled',
  titleHint: 'Title',
  bodyHint: 'What happens here…',
  label: 'Story node',
  missing: 'Missing link',
}

const PAD = 12
const BAR = 5
const TITLE_SIZE = 17
const BODY_SIZE = 13
const LINK_SIZE = 12
const GAP = 6
const LINE_HEIGHT = 1.25

interface Layout {
  titleH: number
  bodyY: number
  bodyH: number
  imageY: number
  imageH: number
  linkY: number
  height: number
}

/** Space around the line between title and story text (0.21). */
const DIVIDER = 8

/** Sizes the node editor matches, so typing looks like the node. */
export const STORY_NODE_LOOK = { PAD, TITLE_SIZE, BODY_SIZE, LINE_HEIGHT, DIVIDER }

/** A new node shows its (empty) story text area, so title and text are two clear places to type. */
const showsBody = (n: StoryNode) => !!n.body || !!n.minHeight

export function layout(n: StoryNode, font: string): Layout {
  const inner = n.width - PAD * 2
  const titleH = measureTextHeight(n.title || STORY_NODE_UI.titleHint, TITLE_SIZE, inner, font)
  let y = PAD + titleH
  const bodyH = showsBody(n) ? measureTextHeight(n.body || STORY_NODE_UI.bodyHint, BODY_SIZE, inner, font) : 0
  const bodyY = y + DIVIDER * 2
  if (showsBody(n)) y = bodyY + bodyH
  const imageH = n.src ? Math.round(inner * 0.6) : 0
  const imageY = y + GAP + 2
  if (n.src) y = imageY + imageH
  const linkY = y + GAP
  if (isLinkSet(n.link)) y = linkY + LINK_SIZE * LINE_HEIGHT
  return { titleH, bodyY, bodyH, imageY, imageH, linkY, height: Math.max(y + PAD, n.minHeight ?? 0) }
}

export interface StoryTypeOptions {
  /** Where the next Create click attaches (SW-9). */
  lastId: string | null
  /** First node picked with the Connect tool. */
  pendingId: string | null
  /** Connector under the Sever tool. */
  severHoverId: string | null
  /** Display text of a link, or null when its target is gone. */
  linkLabel(link: StoryLink): string | null
  /** 0.21: node open for typing; its texts are drawn by the editor on top instead. */
  editingId: string | null
}

/** Node kinds for the Story Writer canvas: story nodes plus a connector that highlights under the Sever tool. */
export function makeStoryNodeTypes(o: StoryTypeOptions): NodeTypes {
  const storyNode: NodeType<StoryNode> = {
    label: STORY_NODE_UI.label,
    render: (n: StoryNode, ctx: RenderContext) => {
      const { theme } = ctx
      const l = layout(n, theme.font)
      const inner = n.width - PAD * 2
      const editing = n.id === o.editingId
      const highlighted = !editing && (n.id === o.lastId || n.id === o.pendingId)
      const hasLink = isLinkSet(n.link)
      const linkText = hasLink ? o.linkLabel(n.link!) : null
      return (
        <Group>
          {highlighted && (
            <Rect
              x={-6}
              y={-6}
              width={n.width + 12}
              height={l.height + 12}
              cornerRadius={12}
              stroke={n.id === o.pendingId ? theme.focus : theme.accent}
              strokeWidth={2}
              dash={[8, 5]}
            />
          )}
          <Rect
            width={n.width}
            height={l.height}
            cornerRadius={8}
            fill={theme.bgElevated}
            stroke={n.fillColor}
            strokeWidth={2}
            shadowColor="#000"
            shadowOpacity={0.25}
            shadowBlur={10}
            shadowOffsetY={2}
          />
          <Rect width={n.width} height={BAR} cornerRadius={[8, 8, 0, 0]} fill={n.fillColor} />
          {!editing && (
            <Text
              x={PAD}
              y={PAD}
              width={inner}
              text={n.title || STORY_NODE_UI.titleHint}
              fontSize={TITLE_SIZE}
              fontStyle="bold"
              fontFamily={theme.font}
              lineHeight={LINE_HEIGHT}
              fill={n.title ? theme.text : theme.textMuted}
              opacity={n.title ? 1 : 0.6}
              wrap="word"
            />
          )}
          {showsBody(n) && <Rect x={PAD} y={l.bodyY - DIVIDER - 0.5} width={inner} height={1} fill={theme.border} listening={false} />}
          {showsBody(n) && !editing ? (
            <Text
              x={PAD}
              y={l.bodyY}
              width={inner}
              text={n.body || STORY_NODE_UI.bodyHint}
              fontSize={BODY_SIZE}
              fontFamily={theme.font}
              lineHeight={LINE_HEIGHT}
              fill={theme.textMuted}
              opacity={n.body ? 1 : 0.6}
              wrap="word"
            />
          ) : null}
          {n.src ? (
            <Group x={PAD} y={l.imageY}>
              <CanvasImage src={n.src} width={inner} height={l.imageH} ctx={ctx} />
            </Group>
          ) : null}
          {hasLink ? (
            <Text
              x={PAD}
              y={l.linkY}
              width={inner}
              text={'\u{1F517} ' + (linkText ?? STORY_NODE_UI.missing)}
              fontSize={LINK_SIZE}
              fontFamily={theme.font}
              fill={linkText ? theme.accent : theme.danger}
              wrap="none"
              ellipsis
            />
          ) : null}
        </Group>
      )
    },
    bounds: (n: StoryNode, ctx: RenderContext) => ({ x: 0, y: 0, width: n.width, height: layout(n, ctx.theme.font).height }),
    rotatable: false,
    // Only the width changes; the height follows the text.
    resize: (n: StoryNode, sx: number) => ({ ...n, width: Math.max(MIN_NODE_WIDTH, Math.round(n.width * sx)) }),
    // Typing happens in the story node editor (View), with the title and the story text together.
  }

  const base = BUILTIN_NODE_TYPES.connector as NodeType<ConnectorNode>
  const connector: NodeType<ConnectorNode> = {
    ...base,
    render: (n, ctx) => base.render(n.id === o.severHoverId ? { ...n, strokeColor: ctx.theme.danger, strokeWidth: 3, dashed: true } : n, ctx),
  }

  return { 'story-node': storyNode, connector }
}
