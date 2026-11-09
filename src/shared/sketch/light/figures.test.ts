import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { applyPose, POSES } from './figures'

/** A bare skeleton shaped like the mannequin model: T-pose, faces +z, left is +x. */
function skeleton() {
  const root = new THREE.Group()
  const bone = (parent: THREE.Object3D, name: string, at: [number, number, number], rotX = 0) => {
    const b = new THREE.Bone()
    b.name = name
    b.position.set(...at)
    b.rotation.x = rotX
    parent.add(b)
    return b
  }
  const pelvis = bone(root, 'pelvis', [0, 0.95, 0])
  const spine = bone(bone(pelvis, 'spine_01', [0, 0.1, 0]), 'spine_02', [0, 0.2, 0])
  bone(spine, 'neck_01', [0, 0.2, 0])
  for (const [s, x] of [
    ['l', 1],
    ['r', -1],
  ] as const) {
    // A turned clavicle checks that turns don't depend on the bones' own axes.
    const clav = bone(spine, `clavicle${s}`, [x * 0.05, 0.15, 0], Math.PI / 2)
    bone(bone(bone(clav, `upperarm${s}`, [x * 0.13, 0, 0]), `lowerarm${s}`, [x * 0.26, 0, 0]), `hand${s}`, [x * 0.21, 0, 0])
    bone(bone(bone(pelvis, `thigh${s}`, [x * 0.1, -0.03, 0]), `calf${s}`, [0, -0.39, 0]), `foot${s}`, [0, -0.42, 0])
  }
  return root
}
const at = (f: THREE.Object3D, name: string) => {
  f.updateMatrixWorld(true)
  return f.getObjectByName(name)!.getWorldPosition(new THREE.Vector3())
}

describe('light preview figure posing', () => {
  it('hangs the arms down when standing', () => {
    const f = skeleton()
    applyPose(f, POSES.stand)
    expect(at(f, 'handl').y).toBeLessThan(1.0)
    expect(at(f, 'handr').y).toBeLessThan(1.0)
  })

  it('poses the same when the figure is turned in the scene', () => {
    const scene = new THREE.Group()
    scene.rotation.y = 1
    const f = skeleton()
    scene.add(f)
    applyPose(f, { rArmFwd: 90 })
    const hand = f.worldToLocal(at(f, 'handr'))
    expect(hand.z).toBeGreaterThan(0.3)
  })

  it('swings limbs the way the sliders say', () => {
    const f = skeleton()
    applyPose(f, { rArmFwd: 90 })
    // Pointing forward: the right hand is in front of the body at shoulder height.
    expect(at(f, 'handr').z).toBeGreaterThan(0.3)
    expect(at(f, 'handr').y).toBeGreaterThan(1.3)
    applyPose(f, { lArmSide: 90 })
    // Raised sideways: the left hand goes out to the figure's left (+x).
    expect(at(f, 'handl').x).toBeGreaterThan(0.5)
    // Bent elbow: the forearm comes forward.
    applyPose(f, { lElbow: 90 })
    expect(at(f, 'handl').z).toBeGreaterThan(0.15)
    // Sitting: knees forward, feet back under the knees.
    applyPose(f, POSES.sit)
    expect(at(f, 'calfl').z).toBeGreaterThan(0.3)
    expect(at(f, 'footl').y).toBeLessThan(at(f, 'calfl').y - 0.3)
  })
})
