import * as THREE from 'three'

/**
 * Posing for the light preview's mannequin (the built-in Mannequiny model, see public/models/CREDITS.md).
 * Sliders turn its skeleton's bones; the model faces +z and its left is +x.
 */

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
/** Bone names in the model (glTF loading drops the dots, so "thigh.l" arrives as "thighl"). */
const BONES = ['spine_01', 'spine_02', 'neck_01', 'upperarml', 'lowerarml', 'upperarmr', 'lowerarmr', 'thighl', 'calfl', 'thighr', 'calfr'] as const
type Bone = (typeof BONES)[number]
type Rig = Record<Bone, { bone: THREE.Object3D; rest: THREE.Quaternion; parent: THREE.Quaternion }>

const euler = (x: number, y: number, z: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z))

/** Turn a bone by a rotation given in the figure's own axes, on top of its rest pose (parents' turns carry over). */
function turn(r: Rig[Bone], by: THREE.Quaternion) {
  r.bone.quaternion.copy(r.parent).invert().multiply(by).multiply(r.parent).multiply(r.rest)
}

/** Find the bones and make arms-down the rest pose (the model comes in a T-pose). Null if bones are missing. */
function rig(figure: THREE.Object3D): Rig | null {
  const found = new Map<string, THREE.Object3D>()
  figure.traverse((o) => found.set(o.name.replace(/\./g, ''), o))
  if (BONES.some((b) => !found.has(b))) return null
  const capture = () => {
    figure.updateWorldMatrix(true, true)
    // Parent turns in the figure's own axes, whatever the figure is turned to in the scene.
    const toFigure = figure.getWorldQuaternion(new THREE.Quaternion()).invert()
    const r = {} as Rig
    for (const b of BONES) {
      const bone = found.get(b)!
      r[b] = { bone, rest: bone.quaternion.clone(), parent: toFigure.clone().multiply(bone.parent!.getWorldQuaternion(new THREE.Quaternion())) }
    }
    return r
  }
  const t = capture()
  turn(t.upperarml, euler(0, 0, -Math.PI / 2))
  turn(t.upperarmr, euler(0, 0, Math.PI / 2))
  return capture()
}

/** Turn the figure's joints to the pose (degrees; missing joints are straight). */
export function applyPose(figure: THREE.Object3D, pose: Pose) {
  const r: Rig | null = (figure.userData.rig ??= rig(figure))
  if (!r) return
  const a = (k: Joint) => (pose[k] ?? 0) * DEG
  turn(r.neck_01, euler(a('headNod'), a('headTurn'), 0))
  // Bend and twist are shared by both spine bones so the back curves.
  turn(r.spine_01, euler(a('bend') / 2, a('twist') / 2, 0))
  turn(r.spine_02, euler(a('bend') / 2, a('twist') / 2, 0))
  // Forward swings turn the limb's downward direction towards +z (negative x rotation).
  turn(r.upperarml, euler(-a('lArmFwd'), 0, a('lArmSide')))
  turn(r.upperarmr, euler(-a('rArmFwd'), 0, -a('rArmSide')))
  turn(r.lowerarml, euler(-a('lElbow'), 0, 0))
  turn(r.lowerarmr, euler(-a('rElbow'), 0, 0))
  turn(r.thighl, euler(-a('lLeg'), 0, 0))
  turn(r.thighr, euler(-a('rLeg'), 0, 0))
  turn(r.calfl, euler(a('lKnee'), 0, 0))
  turn(r.calfr, euler(a('rKnee'), 0, 0))
}
