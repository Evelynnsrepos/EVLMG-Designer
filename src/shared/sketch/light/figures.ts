import * as THREE from 'three'

/**
 * A posable wooden-mannequin figure for the light preview, made from code (no model file).
 */

function part(g: THREE.BufferGeometry, at: [number, number, number], scale: [number, number, number] = [1, 1, 1], rot: [number, number, number] = [0, 0, 0]) {
  const m = new THREE.Mesh(g)
  m.position.set(...at)
  m.scale.set(...scale)
  m.rotation.set(...rot)
  return m
}

/** The figure's joints and what each slider turns. */
export const JOINTS = [
  'headTurn',
  'headNod',
  'bend',
  'twist',
  'lArmSide',
  'lArmFwd',
  'lElbow',
  'rArmSide',
  'rArmFwd',
  'rElbow',
  'lLeg',
  'lKnee',
  'rLeg',
  'rKnee',
] as const
export type Joint = (typeof JOINTS)[number]
export type Pose = Partial<Record<Joint, number>>

export const POSES: Record<string, Pose> = {
  stand: { lArmSide: 8, rArmSide: 8, lElbow: 8, rElbow: 8 },
  walk: { lLeg: 25, lKnee: 10, rLeg: -20, rKnee: 30, lArmFwd: -20, rArmFwd: 20, lElbow: 15, rElbow: 15, lArmSide: 6, rArmSide: 6 },
  run: { lLeg: 55, lKnee: 70, rLeg: -35, rKnee: 95, lArmFwd: -45, rArmFwd: 50, lElbow: 90, rElbow: 90, bend: 15, lArmSide: 8, rArmSide: 8 },
  sit: { lLeg: 90, rLeg: 90, lKnee: 90, rKnee: 90, lArmFwd: 25, rArmFwd: 25, lElbow: 45, rElbow: 45, lArmSide: 8, rArmSide: 8 },
  crouch: { lLeg: 75, rLeg: 60, lKnee: 120, rKnee: 110, bend: 35, lArmFwd: 45, rArmFwd: 40, lElbow: 30, rElbow: 30, headNod: -25 },
  reach: { rArmFwd: 165, rArmSide: 10, lArmSide: 10, lElbow: 10, headNod: -25, bend: -5 },
  point: { rArmFwd: 90, rArmSide: -5, lArmSide: 8, lElbow: 10, headTurn: 10 },
}

const DEG = Math.PI / 180

/** A mannequin about 1.6 units tall looking towards +z. Joint groups are in userData.joints. */
export function buildFigure(): THREE.Group {
  const root = new THREE.Group()
  const joints: Record<string, THREE.Group> = {}
  const joint = (parent: THREE.Object3D, name: string, at: [number, number, number]) => {
    const j = new THREE.Group()
    j.position.set(...at)
    parent.add(j)
    joints[name] = j
    return j
  }
  const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 4, 12)
  const hips = joint(root, 'hips', [0, 0.8, 0])
  hips.add(part(new THREE.SphereGeometry(1, 16, 12), [0, 0.02, 0], [0.16, 0.1, 0.11]))
  // Torso: bend and twist at the waist.
  const waist = joint(hips, 'waist', [0, 0.06, 0])
  waist.add(part(capsule(0.12, 0.26), [0, 0.24, 0], [1.3, 1, 0.75]))
  const neck = joint(waist, 'neck', [0, 0.5, 0])
  neck.add(part(new THREE.CylinderGeometry(0.04, 0.045, 0.08, 10), [0, 0.03, 0]))
  neck.add(part(new THREE.SphereGeometry(0.1, 16, 12), [0, 0.15, 0.01], [0.85, 1.05, 0.95]))
  for (const [side, x] of [
    ['l', 1],
    ['r', -1],
  ] as const) {
    // Arms hang from the shoulders; the figure's left is +x.
    const shoulder = joint(waist, `${side}Shoulder`, [x * 0.19, 0.44, 0])
    shoulder.add(part(new THREE.SphereGeometry(0.05, 12, 8), [0, 0, 0]))
    shoulder.add(part(capsule(0.042, 0.2), [0, -0.14, 0]))
    const elbow = joint(shoulder, `${side}ElbowJ`, [0, -0.28, 0])
    elbow.add(part(capsule(0.037, 0.19), [0, -0.13, 0]))
    elbow.add(part(new THREE.SphereGeometry(0.045, 12, 8), [0, -0.28, 0.01], [0.8, 1.2, 0.6]))
    const hip = joint(hips, `${side}Hip`, [x * 0.085, -0.02, 0])
    hip.add(part(capsule(0.06, 0.28), [0, -0.19, 0]))
    const knee = joint(hip, `${side}KneeJ`, [0, -0.39, 0])
    knee.add(part(capsule(0.05, 0.28), [0, -0.18, 0]))
    knee.add(part(new THREE.BoxGeometry(0.08, 0.05, 0.18), [0, -0.37, 0.04]))
  }
  root.userData.joints = joints
  return root
}

/** Turn the figure's joints to the pose (degrees; missing joints are straight). */
export function applyPose(figure: THREE.Object3D, pose: Pose) {
  const j = figure.userData.joints as Record<string, THREE.Group>
  const a = (k: Joint) => (pose[k] ?? 0) * DEG
  j.neck.rotation.set(a('headNod'), a('headTurn'), 0)
  j.waist.rotation.set(a('bend'), a('twist'), 0)
  // Forward swings turn the limb's downward direction towards +z (negative x rotation).
  j.lShoulder.rotation.set(-a('lArmFwd'), 0, a('lArmSide'))
  j.rShoulder.rotation.set(-a('rArmFwd'), 0, -a('rArmSide'))
  j.lElbowJ.rotation.set(-a('lElbow'), 0, 0)
  j.rElbowJ.rotation.set(-a('rElbow'), 0, 0)
  j.lHip.rotation.set(-a('lLeg'), 0, 0)
  j.rHip.rotation.set(-a('rLeg'), 0, 0)
  j.lKneeJ.rotation.set(a('lKnee'), 0, 0)
  j.rKneeJ.rotation.set(a('rKnee'), 0, 0)
}
