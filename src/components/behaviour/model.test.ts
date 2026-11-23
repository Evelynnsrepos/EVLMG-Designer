import { describe, expect, it } from 'vitest'
import { addNodes } from '@/shared/canvas'
import {
  applyEnter,
  checkGraph,
  condsOf,
  createBehaviourDoc,
  describeCondition,
  describeLink,
  evalLink,
  initialValues,
  isLink,
  link,
  linksFrom,
  minutesOf,
  newGroup,
  newState,
  onDay,
  outgoing,
  reorder,
  resolveTarget,
  shiftBlock,
  statesOf,
  toStateMachine,
  type LinkNode,
} from './model'

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
    const lonely = newState(d.scene.layers[0].id, 0, 900, 'Sleep')
    const g = checkGraph(addNodes(d.scene, [lonely]))
    expect(g.unreachable).toEqual([lonely.id])
    expect(g.deadEnds).toEqual([lonely.id])
  })

  it('describes conditions in plain words', () => {
    expect(describeCondition({ mode: 'health', value: 30, text: '' })).toBe('health below 30%')
    expect(describeCondition({ mode: 'time', value: 7, text: '' })).toBe('at 07:00')
    expect(describeCondition({ mode: 'flag', value: 0, flagId: 'f', text: '' }, { flagName: () => 'alarm_on' })).toBe('alarm_on is set')
    expect(describeCondition({ mode: 'sees', value: 5, text: '' }, { distance: 'tiles' })).toBe('sees the target within 5 tiles')
    expect(describeCondition({ mode: 'k1', value: 2, text: '' }, { kinds: [{ id: 'k1', label: 'cards in hand below', unit: 'cards' }] })).toBe('cards in hand below 2 cards')
    expect(describeCondition({ mode: 'arrived', value: 0, text: '', not: true })).toBe('not reaches the spot')
    expect(minutesOf('07:30')).toBe(450)
  })

  it('reads old one-condition arrows and joins several with and/or', () => {
    const old = { cond: { mode: 'timer', value: 5, text: '' } } as LinkNode
    expect(condsOf(old)).toHaveLength(1)
    const two = { conds: [{ mode: 'timer', value: 5, text: '' }, { mode: 'health', value: 30, text: '' }], join: 'any' } as LinkNode
    expect(describeLink(two)).toBe('after 5 s or health below 30%')
    expect(describeLink({ conds: [] } as unknown as LinkNode)).toBe('always')
  })

  it('variables change on entering a state and decide variable checks', () => {
    const d = createBehaviourDoc()
    const hear = statesOf(d.scene).find((s) => s.title === 'Go to noise')!
    let v = initialValues(d)
    for (let i = 0; i < 3; i++) v = applyEnter(hear, v)
    expect(Object.values(v)).toEqual([3])
    const toChase = linksFrom(d.scene, hear.id).find((l) => condsOf(l).length === 2)!
    expect(evalLink(toChase, v)).toBe(true) // 'any': the variable check alone is enough
    expect(evalLink(toChase, initialValues(d))).toBe(null) // "sees" is up to the person trying
    expect(evalLink({ ...toChase, join: 'all' }, initialValues(d))).toBe(false)
  })

  it('arrows out of a group leave from every state inside, arrows in go to its entry', () => {
    const d = createBehaviourDoc()
    const L = d.scene.layers[0].id
    const p2a = newState(L, 2000, 0, 'Phase 2 slam')
    const p2b = newState(L, 2000, 200, 'Phase 2 roar')
    const phase1 = newGroup(L, -100, -300, 1600, 700, 'Phase 1')
    const phase2 = newGroup(L, 1900, -100, 400, 500, 'Phase 2')
    let s = { ...d.scene, nodes: [phase1, phase2, ...d.scene.nodes] }
    s = addNodes(s, [p2a, p2b])
    s = addNodes(s, [link(s, L, phase1.id, phase2.id, [{ mode: 'health', value: 50, text: '' }]), link(s, L, p2a.id, p2b.id, []), link(s, L, p2b.id, p2a.id, [])])
    expect(resolveTarget(s, phase2.id)).toBe(p2a.id)
    const attack = statesOf(s).find((x) => x.title === 'Attack')!
    expect(outgoing(s, attack.id).at(-1)!.fromId).toBe(phase1.id)
    expect(checkGraph(s).unreachable).toEqual([])
    s = { ...s, nodes: s.nodes.map((n) => (n.id === phase2.id ? { ...phase2, entryId: p2b.id } : n)) }
    expect(resolveTarget(s, phase2.id)).toBe(p2b.id)
  })

  it('reorders the arrows out of a state', () => {
    const d = createBehaviourDoc()
    const idle = statesOf(d.scene).find((s) => s.start)!
    const before = linksFrom(d.scene, idle.id).map((l) => l.id)
    const after = linksFrom(reorder(d.scene, idle.id, 0, 1), idle.id).map((l) => l.id)
    expect(after).toEqual([before[1], before[0], before[2]])
    expect(reorder(d.scene, idle.id, 0, -1)).toBe(d.scene)
  })

  it('routine blocks move in 15-minute steps and filter by weekday', () => {
    const b = { id: 'b', from: '09:00', to: '17:00', place: '', does: '' }
    expect(shiftBlock(b, 37, 'move')).toMatchObject({ from: '09:30', to: '17:30' })
    expect(shiftBlock(b, -60, 'end')).toMatchObject({ from: '09:00', to: '16:00' })
    expect(shiftBlock({ ...b, from: '22:00', to: '06:00' }, 60, 'end').to).toBe('07:00')
    expect(onDay({ ...b, days: [0, 1] }, 5)).toBe(false)
    expect(onDay(b, 5)).toBe(true)
  })

  it('exports a plain state machine', () => {
    const d = createBehaviourDoc()
    const m = toStateMachine(d)
    expect(m.states).toHaveLength(6)
    expect(m.start).toBe(statesOf(d.scene).find((s) => s.start)!.id)
    expect(m.transitions).toHaveLength(d.scene.nodes.filter(isLink).length)
    const both = m.transitions.find((t) => t.conditions.length === 2)!
    expect(both.join).toBe('any')
    expect(both.conditions[1]).toMatchObject({ type: 'var', variable: 'noises_heard', op: '>=', value: 3 })
    expect(m.states.find((s) => s.name === 'Go to noise')!.onEnter).toEqual([{ variable: 'noises_heard', op: 'add', value: 1 }])
  })
})
