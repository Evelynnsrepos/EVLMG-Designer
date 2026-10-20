import { describe, expect, it } from 'vitest'
import { formatCombo } from './shortcuts'

describe('formatCombo', () => {
  it('names keys, including the plus key itself', () => {
    expect(formatCombo('ctrl+shift+z')).toBe('Ctrl+Shift+Z')
    expect(formatCombo('+')).toBe('+')
    expect(formatCombo('ctrl++')).toBe('Ctrl++')
    expect(formatCombo('-')).toBe('-')
  })
})
