import { describe, expect, it } from 'vitest'
import { COMPONENT_TYPES } from '@/core/model'
import { TOOL_INFO } from './toolGroups'

describe('Add tool groups', () => {
  it('give every built-in tool a group and a use-when line', () => {
    expect(COMPONENT_TYPES.filter((t) => !TOOL_INFO[t])).toEqual([])
  })
})
