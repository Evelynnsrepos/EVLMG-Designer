import { newId } from '@/core/model'
import type { ScoreStack, ScoreStep, TtkSettings, TtkWeapon } from '@/shared/calculators'

/** Missing tools 6b and 6c: time to kill per weapon over distance, and a score stack in order. */

export const newWeapon = (name = 'Rifle', damage = 30, rpm = 600): TtkWeapon => ({ id: newId(), name, damage, rpm, falloffStart: 20, falloffEnd: 50, minPercent: 70 })

export const createTtk = (): TtkSettings => ({
  weapons: [newWeapon('Assault rifle', 30, 600), { ...newWeapon('SMG', 22, 900), falloffStart: 10, falloffEnd: 30, minPercent: 60 }, { ...newWeapon('Sniper', 120, 50), falloffStart: 100, falloffEnd: 200, minPercent: 100 }],
  hp: 100,
  armor: 0,
  maxRange: 60,
})

/** Damage of one shot at a distance: full until falloffStart, then a straight line down to minPercent at falloffEnd. */
export function damageAt(w: TtkWeapon, range: number): number {
  if (range <= w.falloffStart || w.falloffEnd <= w.falloffStart) return w.damage
  const t = Math.min(1, (range - w.falloffStart) / (w.falloffEnd - w.falloffStart))
  return w.damage * (1 - t * (1 - w.minPercent / 100))
}

/** Shots to kill and time to kill in seconds (the first shot is at 0 s). */
export function ttkAt(w: TtkWeapon, t: Pick<TtkSettings, 'hp' | 'armor'>, range: number): { shots: number; seconds: number } {
  const dmg = damageAt(w, range)
  if (dmg <= 0 || w.rpm <= 0) return { shots: Infinity, seconds: Infinity }
  const shots = Math.ceil((t.hp + t.armor) / dmg - 1e-9)
  return { shots, seconds: ((shots - 1) * 60) / w.rpm }
}

export const newStep = (op: ScoreStep['op'] = 'add-b', amount = 4, name = 'Joker'): ScoreStep => ({ id: newId(), name, op, amount, times: 1, on: true })

export const createStack = (): ScoreStack => ({
  aName: 'Chips',
  bName: 'Mult',
  a: 10,
  b: 4,
  steps: [newStep('add-a', 10, 'Card played'), { ...newStep('add-a', 5, 'Each card'), times: 5 }, newStep('add-b', 4, '+4 Mult joker'), newStep('mul-b', 1.5, '×1.5 Mult joker')],
})

/** Running values after each step, and the final score a × b. */
export function runStack(s: ScoreStack): { after: { a: number; b: number }[]; score: number } {
  let a = s.a
  let b = s.b
  const after = s.steps.map((st) => {
    if (st.on)
      for (let i = 0; i < Math.max(0, Math.round(st.times)); i++) {
        if (st.op === 'add-a') a += st.amount
        else if (st.op === 'add-b') b += st.amount
        else if (st.op === 'mul-a') a *= st.amount
        else b *= st.amount
      }
    return { a, b }
  })
  return { after, score: a * b }
}
