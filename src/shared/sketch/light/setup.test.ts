import { describe, expect, it } from 'vitest'
import { anglesAt, defaultSetup, lampPosition, MAX_LAMPS, restoreSetup, toneSteps } from './setup'

describe('light preview setup', () => {
  it('turns lamp angles into a position and back', () => {
    for (const l of [
      { azimuth: 0, elevation: 0, distance: 3 },
      { azimuth: 90, elevation: 30, distance: 5 },
      { azimuth: -135, elevation: -20, distance: 2 },
    ]) {
      const [x, y, z] = lampPosition(l)
      const back = anglesAt(x, y, z)
      expect(back.azimuth).toBeCloseTo(l.azimuth)
      expect(back.elevation).toBeCloseTo(l.elevation)
    }
    // In front, 0 degrees: straight towards the viewer side (+z).
    const [x, , z] = lampPosition({ azimuth: 0, elevation: 0, distance: 2 })
    expect(x).toBeCloseTo(0)
    expect(z).toBeCloseTo(2)
  })

  it('restores a broken or old setup safely', () => {
    expect(restoreSetup(null, new Set())).toEqual(defaultSetup())
    const s = restoreSetup(
      {
        lamps: Array.from({ length: 6 }, () => ({ strength: 99, color: 'red', elevation: 200, kind: 'laser' })),
        things: [{ shape: 'ball', x: 50 }, { shape: 'model', model: 'gone' }, { shape: 'model', model: 'here', name: 'Fox.glb' }, { shape: 'teapot' }],
        room: -1,
        color: 'blue',
        shine: 7,
        view: 'nope',
      },
      new Set(['here']),
    )
    expect(s.lamps).toHaveLength(MAX_LAMPS)
    expect(s.lamps[0]).toMatchObject({ strength: 3, color: '#ffffff', elevation: 85, kind: 'sun', on: true })
    expect(s.things.map((t) => t.shape)).toEqual(['ball', 'model'])
    expect(s.things[0].x).toBe(4)
    expect(s.things[1].name).toBe('Fox.glb')
    expect(s.room).toBe(0)
    expect(s.view).toBe('clay')
    expect(s.color).toBe(defaultSetup().color)
    expect(s.shine).toBe(1)
  })

  it('puts the shadow line where a surface turns away from the lamp', () => {
    for (const v of ['two', 'three'] as const) {
      const steps = toneSteps(v)
      // Step i covers facing values -1 + 0.2 i .. -1 + 0.2 (i + 1).
      expect(steps.slice(0, 5).every((s) => s === 0)).toBe(true)
      expect(steps[5]).toBeGreaterThan(0)
      expect(steps[9]).toBe(1)
    }
  })
})
