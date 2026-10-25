import { describe, expect, it } from 'vitest'
import { useProjectStore } from '@/core/state'
import { addJump, syncBoardJumps } from './Jumps'
import { refTargetOf } from './drag'

describe('jump points', () => {
  it('keeps the project list in step with a board, and leaves hand-made ones alone', () => {
    useProjectStore.setState({ meta: { jumps: [], documents: [] } as never })
    useProjectStore.setState({ updateMeta: (patch: object) => useProjectStore.setState((s) => ({ meta: { ...s.meta!, ...patch } })) } as never)
    addJump({ kind: 'document', type: 'moodboard', documentId: 'm' }, { kind: 'document', type: 'writer', documentId: 'w' }, 'hand')
    const to = { kind: 'entity' as const, type: 'character' as const, id: 'c' }
    syncBoardJumps('moodboard', 'm', [{ id: 'n1', target: to }])
    expect(useProjectStore.getState().meta!.jumps!.map((j) => j.id).sort()).toEqual(['hand', 'n1'])
    syncBoardJumps('moodboard', 'm', [])
    expect(useProjectStore.getState().meta!.jumps!.map((j) => j.id)).toEqual(['hand'])
  })

  it('turns a dragged jump point into the [[link that goes to the same place', () => {
    expect(refTargetOf({ kind: 'entity', type: 'item', id: 'i' })).toEqual({ kind: 'item', id: 'i' })
    expect(refTargetOf({ kind: 'document', type: 'writer', documentId: 'w' })).toEqual({ kind: 'doc', id: 'w' })
    expect(refTargetOf({ kind: 'document', type: 'map', documentId: null })).toEqual({ kind: 'tool', id: 'map' })
  })
})
