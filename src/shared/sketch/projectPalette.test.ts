import { useProjectStore } from '@/core/state'
import type { ProjectMeta } from '@/core/model'
import { PROJECT_PALETTE_ID, usePalettes } from './palettes'

describe('project palette', () => {
  it('shows the open project palette first and saves changes into the project', () => {
    useProjectStore.setState({ meta: { name: 'P', palette: [{ hex: '#112233' }] } as unknown as ProjectMeta })
    const first = usePalettes.getState().palettes[0]
    expect(first.id).toBe(PROJECT_PALETTE_ID)
    expect(first.colors).toEqual([{ hex: '#112233' }])

    useProjectStore.setState({ updateMeta: (patch) => useProjectStore.setState((s) => ({ meta: { ...s.meta!, ...patch } })) })
    usePalettes.getState().update(PROJECT_PALETTE_ID, { colors: [{ hex: '#445566' }] })
    expect(useProjectStore.getState().meta?.palette).toEqual([{ hex: '#445566' }])
    expect(usePalettes.getState().palettes[0].colors).toEqual([{ hex: '#445566' }])

    useProjectStore.setState({ meta: null })
    expect(usePalettes.getState().palettes.some((p) => p.id === PROJECT_PALETTE_ID)).toBe(false)
  })
})
