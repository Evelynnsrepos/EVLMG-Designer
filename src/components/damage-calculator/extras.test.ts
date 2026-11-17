import { describe, expect, it } from 'vitest'
import { createStack, damageAt, newStep, newWeapon, runStack, ttkAt } from './extras'

describe('time to kill', () => {
  it('30 damage at 600 RPM against 100 HP: 4 shots, 0.3 s', () => {
    const w = newWeapon('Rifle', 30, 600)
    expect(ttkAt(w, { hp: 100, armor: 0 }, 0)).toEqual({ shots: 4, seconds: 0.3 })
  })
  it('falloff lowers damage over distance', () => {
    const w = { ...newWeapon('Rifle', 30, 600), falloffStart: 20, falloffEnd: 50, minPercent: 50 }
    expect(damageAt(w, 10)).toBe(30)
    expect(damageAt(w, 35)).toBeCloseTo(22.5)
    expect(damageAt(w, 80)).toBe(15)
    expect(ttkAt(w, { hp: 100, armor: 0 }, 80).shots).toBe(7)
  })
})

describe('score stack', () => {
  it('order matters', () => {
    const base = { aName: 'Chips', bName: 'Mult', a: 10, b: 4, steps: [] }
    const plus = newStep('add-b', 4)
    const times = newStep('mul-b', 1.5)
    expect(runStack({ ...base, steps: [plus, times] }).score).toBe(120)
    expect(runStack({ ...base, steps: [times, plus] }).score).toBe(100)
    expect(runStack({ ...base, steps: [{ ...plus, on: false }, times] }).score).toBe(60)
    expect(runStack(createStack()).after).toHaveLength(4)
  })
})
