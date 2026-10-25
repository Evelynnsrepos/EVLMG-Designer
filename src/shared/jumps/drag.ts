import type { LinkTarget } from '@/core/model'
import { DOC_KIND, TOOL_KIND } from '@/shared/richtext/refs'
import type { RefTarget } from '@/shared/richtext/types'

/** 0.21: a jump point dragged out of the jump points list, onto a board (a jump point there) or into text (a [[link). */
export const JUMP_DRAG = 'application/x-egd-jump'

export function setJumpDrag(dt: DataTransfer, target: LinkTarget, label: string) {
  dt.setData(JUMP_DRAG, JSON.stringify(target))
  // Plain text fields get the name as it would be typed.
  dt.setData('text/plain', `[[${label}]]`)
  dt.effectAllowed = 'copy'
}

export function readJumpDrag(dt: DataTransfer | null): LinkTarget | null {
  const raw = dt?.getData(JUMP_DRAG)
  if (!raw) return null
  try {
    return JSON.parse(raw) as LinkTarget
  } catch {
    return null
  }
}

/** The [[link that points where a jump point does. */
export function refTargetOf(t: LinkTarget): RefTarget {
  if (t.kind === 'entity') return { kind: t.type, id: t.id }
  return t.documentId ? { kind: DOC_KIND, id: t.documentId } : { kind: TOOL_KIND, id: t.type }
}
