import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { applyPose, buildFigure, POSES } from './figures'

const box = (o: THREE.Object3D) => {
  o.updateMatrixWorld(true)
  return new THREE.Box3().setFromObject(o)
}
const handZ = (f: THREE.Object3D, side: 'l' | 'r') => {
  const hand = (f.userData.joints[`${side}ElbowJ`] as THREE.Group).children[1]
  f.updateMatrixWorld(true)
  return hand.getWorldPosition(new THREE.Vector3())
}

describe('light preview figures', () => {
  it('builds a standing figure about 1.6 units tall on the floor', () => {
    const f = buildFigure()
    applyPose(f, POSES.stand)
    const b = box(f)
    expect(b.min.y).toBeGreaterThan(-0.05)
    expect(b.min.y).toBeLessThan(0.05)
    expect(b.max.y).toBeGreaterThan(1.5)
    expect(b.max.y).toBeLessThan(1.8)
  })

  it('swings limbs the way the sliders say', () => {
    const f = buildFigure()
    applyPose(f, { rArmFwd: 90 })
    // Pointing forward: the right hand is in front of the body at shoulder height.
    const hand = handZ(f, 'r')
    expect(hand.z).toBeGreaterThan(0.3)
    expect(hand.y).toBeGreaterThan(1.2)
    applyPose(f, { lArmSide: 90 })
    // Raised sideways: the left hand goes out to the figure's left (+x).
    expect(handZ(f, 'l').x).toBeGreaterThan(0.5)
    // Sitting lowers the hips' lowest point below the feet's old place, so it must be lifted back onto the floor by the caller.
    applyPose(f, POSES.sit)
    expect(box(f).min.y).toBeGreaterThan(0.2)
  })
})
