import { describe, expect, it } from 'vitest'
import { addNodes } from '@/shared/canvas'
import { checkGraph, createBehaviourDoc, describeCondition, minutesOf, newState, statesOf } from './model'

describe('behaviour designer', () => {
  it('the example is fully connected', () => {
    const d = createBehaviourDoc()
    expect(statesOf(d.scene)).toHaveLength(6)
    const g = checkGraph(d.scene)
    expect(g.unreachable).toEqual([])
    expect(g.deadEnds).toEqual([])
  })

  it('finds states you can never reach or leave', () => {
    const d = createBehaviourDoc()
    const lonely = newState(d.scene.layers[0].id, 0, 500, 'Sleep')
    const g = checkGraph(addNodes(d.scene, [lonely]))
    expect(g.unreachable).toEqual([lonely.id])
    expect(g.deadEnds).toEqual([lonely.id])
  })

  it('describes conditions in plain words', () => {
    expect(describeCondition({ mode: 'health', value: 30, text: '' })).toBe('health below 30%')
    expect(describeCondition({ mode: 'time', value: 7, text: '' })).toBe('at 07:00')
    expect(describeCondition({ mode: 'flag', value: 0, flagId: 'f', text: '' }, () => 'alarm_on')).toBe('alarm_on is set')
    expect(minutesOf('07:30')).toBe(450)
  })
})
