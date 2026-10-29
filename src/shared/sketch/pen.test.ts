import { applyCurve, isEraserEnd, LINEAR, MotionFilter, penButton, penData, PenPipeline, pressureOf, resetPressureDetection, tiltToAngles } from './pen'

describe('applyCurve', () => {
  it('is the identity for the straight line', () => {
    for (const x of [0, 0.1, 0.5, 0.9, 1]) expect(applyCurve(LINEAR, x)).toBeCloseTo(x)
  })
  it('passes through every handle and stays monotone', () => {
    const c = [
      { x: 0, y: 0 },
      { x: 0.3, y: 0.6 },
      { x: 0.7, y: 0.8 },
      { x: 1, y: 1 },
    ]
    for (const p of c) expect(applyCurve(c, p.x)).toBeCloseTo(p.y)
    let prev = -1
    for (let x = 0; x <= 1; x += 0.01) {
      const y = applyCurve(c, x)
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = y
    }
  })
  it('is flat outside the handles and accepts unsorted points', () => {
    const c = [
      { x: 0.8, y: 1 },
      { x: 0.2, y: 0.1 },
    ]
    expect(applyCurve(c, 0)).toBe(0.1)
    expect(applyCurve(c, 1)).toBe(1)
    expect(applyCurve(c, 0.5)).toBeCloseTo(0.55)
  })
})

describe('reading the pen', () => {
  beforeEach(resetPressureDetection)
  it('mice and touch draw at full pressure', () => {
    expect(pressureOf({ pointerType: 'mouse', pressure: 0.5 })).toBe(1)
    expect(pressureOf({ pointerType: 'touch', pressure: 0.3 })).toBe(1)
  })
  it('pens without pressure (always 0.5) draw at full pressure, real pressure counts', () => {
    expect(pressureOf({ pointerType: 'pen', pressure: 0.5 })).toBe(1)
    expect(pressureOf({ pointerType: 'pen', pressure: 0.3 })).toBeCloseTo(0.3)
    expect(pressureOf({ pointerType: 'pen', pressure: 0.5 })).toBeCloseTo(0.5)
    expect(pressureOf({ pointerType: 'pen', pressure: 0.01 })).toBe(0.05)
  })
  it('applies the curve', () => {
    pressureOf({ pointerType: 'pen', pressure: 0.3 })
    const soft = [
      { x: 0, y: 0.5 },
      { x: 1, y: 1 },
    ]
    expect(pressureOf({ pointerType: 'pen', pressure: 0 + 1e-6 }, soft)).toBeCloseTo(0.5, 3)
  })
  it('turns tilt into angles', () => {
    expect(tiltToAngles(0, 0).altitude).toBeCloseTo(Math.PI / 2)
    const a = tiltToAngles(45, 0)
    expect(a.altitude).toBeCloseTo(Math.PI / 4)
    expect(a.azimuth).toBeCloseTo(0)
    expect(tiltToAngles(0, 45).azimuth).toBeCloseTo(Math.PI / 2)
    expect(tiltToAngles(-45, 0).azimuth).toBeCloseTo(Math.PI)
  })
  it('prefers the browser angles when present', () => {
    const d = penData({ pointerType: 'pen', pressure: 0.4, button: 0, buttons: 1, tiltX: 10, tiltY: 0, altitudeAngle: 1, azimuthAngle: 2 })
    expect(d.altitude).toBe(1)
    expect(d.azimuth).toBe(2)
    expect(d.tiltX).toBe(10)
    expect(penData({ pointerType: 'mouse', pressure: 0, button: 0, buttons: 1 })).toEqual({ pressure: 1 })
  })
  it('finds the eraser end and side buttons', () => {
    expect(isEraserEnd({ pointerType: 'pen', button: 5, buttons: 32 })).toBe(true)
    expect(isEraserEnd({ pointerType: 'pen', button: -1, buttons: 32 })).toBe(true)
    expect(isEraserEnd({ pointerType: 'eraser', button: 0, buttons: 1 })).toBe(true)
    expect(isEraserEnd({ pointerType: 'pen', button: 0, buttons: 1 })).toBe(false)
    expect(isEraserEnd({ pointerType: 'mouse', button: 5, buttons: 32 })).toBe(false)
    expect(penButton({ pointerType: 'pen', button: 2 })).toBe('barrel')
    expect(penButton({ pointerType: 'pen', button: 1 })).toBe('middle')
    expect(penButton({ pointerType: 'pen', button: 0 })).toBe(null)
    expect(penButton({ pointerType: 'mouse', button: 2 })).toBe(null)
  })
})

describe('smoothing', () => {
  it('a tether only pulls the brush once the pen is farther than its length', () => {
    const pipe = new PenPipeline({ streamline: 0, stabilization: 0, motionFilter: 0, tether: 20 })
    expect(pipe.push({ x: 0, y: 0, pressure: 1 }, 0)).toHaveLength(1)
    expect(pipe.push({ x: 15, y: 0, pressure: 1 }, 16)).toEqual([]) // still slack
    const [q] = pipe.push({ x: 50, y: 0, pressure: 1 }, 32)
    expect(q.x).toBeCloseTo(30) // 20 px behind the pen
    expect(pipe.tetherTip?.x).toBeCloseTo(30)
    expect(pipe.flush()).toEqual([])
  })

  it('smooths the same no matter how many points the pen sends', () => {
    const run = (hz: number) => {
      const pipe = new PenPipeline({ streamline: 0.6, stabilization: 0, motionFilter: 0 })
      const dt = 1000 / hz
      let last = { x: 0, y: 0 }
      for (let t = 0; t <= 100; t += dt) for (const q of pipe.push({ x: t >= dt ? 100 : 0, y: 0, pressure: 1 }, t)) last = q
      return last.x
    }
    // After the same 100 ms, a 240 Hz pen and a 60 Hz mouse are about equally far along.
    expect(Math.abs(run(240) - run(60))).toBeLessThan(8)
    expect(run(60)).toBeLessThan(80)
  })

  it('a smoothed stroke still ends where the pen was lifted', () => {
    const pipe = new PenPipeline({ streamline: 1, stabilization: 0, motionFilter: 0 })
    pipe.push({ x: 0, y: 0, pressure: 1 }, 0)
    pipe.push({ x: 200, y: 0, pressure: 1 }, 16)
    const tail = pipe.flush()
    expect(tail[tail.length - 1].x).toBeGreaterThan(199)
  })

  it('motion filter calms slow jitter but follows fast moves', () => {
    const f = new MotionFilter(0.8)
    let out = { x: 0, y: 0 }
    for (let i = 0; i < 60; i++) out = f.filter(100 + (i % 2 ? 2 : -2), 100, i * 8)
    expect(Math.abs(out.x - 100)).toBeLessThan(1)
    const g = new MotionFilter(0.8)
    for (let i = 0; i < 30; i++) out = g.filter(i * 40, 0, i * 8)
    expect(out.x).toBeGreaterThan(29 * 40 * 0.85)
    expect(new MotionFilter(0).filter(5, 6, 0)).toEqual({ x: 5, y: 6 })
  })
  it('pipeline without smoothing passes points through', () => {
    const p = new PenPipeline({ streamline: 0, stabilization: 0, motionFilter: 0 })
    expect(p.push({ x: 1, y: 2, pressure: 0.5, tiltX: 3 }, 0)).toEqual([{ x: 1, y: 2, pressure: 0.5, tiltX: 3 }])
    expect(p.push({ x: 5, y: 2, pressure: 0.5 }, 8)[0].x).toBeCloseTo(5)
    expect(p.flush()).toEqual([])
  })
  it('stabilization lags and catches up at pen up', () => {
    const p = new PenPipeline({ streamline: 0, stabilization: 0.5, motionFilter: 0 })
    p.push({ x: 0, y: 0, pressure: 1 }, 0)
    const [q] = p.push({ x: 100, y: 0, pressure: 1 }, 8)
    expect(q.x).toBeLessThan(100)
    const rest = p.flush()
    expect(rest[rest.length - 1].x).toBeCloseTo(100)
  })
  it('peek does not change the stroke', () => {
    const make = () => new PenPipeline({ streamline: 0.5, stabilization: 0.3, motionFilter: 0.5 })
    const a = make()
    const b = make()
    for (const pl of [a, b]) {
      pl.push({ x: 0, y: 0, pressure: 1 }, 0)
      pl.push({ x: 10, y: 0, pressure: 1 }, 8)
    }
    const predicted = a.peek([{ p: { x: 30, y: 5, pressure: 1 }, t: 16 }])
    expect(predicted).toHaveLength(1)
    expect(a.push({ x: 20, y: 0, pressure: 1 }, 16)).toEqual(b.push({ x: 20, y: 0, pressure: 1 }, 16))
  })
})

describe('pen read from GTK (Linux)', () => {
  it('turns a mouse event into a pen with the fresh native pressure and tilt', () => {
    const g = globalThis as { __nativePen?: unknown }
    g.__nativePen = { pressure: 0.3, tiltX: 20, tiltY: -10, t: performance.now() }
    const d = penData({ pointerType: 'mouse', pressure: 0.5, button: 0, buttons: 1 })
    expect(d.tiltX).toBe(20)
    expect(d.tiltY).toBe(-10)
    g.__nativePen = { pressure: 0.3, tiltX: 20, tiltY: -10, t: performance.now() - 1000 }
    expect(penData({ pointerType: 'mouse', pressure: 0.5, button: 0, buttons: 1 }).tiltX).toBeUndefined()
    delete g.__nativePen
  })

  it('keeps the last pressure when the pen reports 0 while lifting', () => {
    const g = globalThis as { __nativePen?: unknown }
    resetPressureDetection()
    g.__nativePen = { pressure: 0.6, tiltX: 0, tiltY: 0, t: performance.now() }
    expect(penData({ pointerType: 'mouse', pressure: 0.5, button: 0, buttons: 1 }).pressure).toBeCloseTo(0.6)
    g.__nativePen = { pressure: 0, tiltX: 0, tiltY: 0, t: performance.now() }
    expect(penData({ pointerType: 'mouse', pressure: 0.5, button: 0, buttons: 1 }).pressure).toBeCloseTo(0.6)
    delete g.__nativePen
  })
})
