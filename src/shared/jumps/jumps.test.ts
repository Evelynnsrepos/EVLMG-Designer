import { describe, expect, it } from 'vitest'
import { useProjectStore } from '@/core/state'
import { addJump, syncBoardJumps } from './Jumps'

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
})
