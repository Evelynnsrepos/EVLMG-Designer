import { afterEach, describe, expect, it } from 'vitest'
import { localized, useLangStore } from '.'

describe('localized texts', () => {
  afterEach(() => useLangStore.setState({ lang: 'en' }))
  it('uses German where translated and English for the rest', () => {
    const UI = localized({ save: 'Save', count: (n: number) => `${n} files`, only: 'Only English' }, { save: 'Speichern', count: (n: number) => `${n} Dateien` })
    expect(UI.save).toBe('Save')
    useLangStore.setState({ lang: 'de' })
    expect(UI.save).toBe('Speichern')
    expect(UI.count(2)).toBe('2 Dateien')
    expect(UI.only).toBe('Only English')
  })
})
