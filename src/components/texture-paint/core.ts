import { invoke } from '@tauri-apps/api/core'
import * as THREE from 'three'
import { isTauri } from '@/core/fs'

/**
 * Texture Paint's Rust core (src-tauri/texpaint): the model goes over once, then "Fill a part" and the
 * shape maps are worked out there on every CPU core. Painting itself stays in Draw's engine.
 */

/** The model as the core knows it: triangle corners in texture pixels, for drawing fills. */
export interface PackedModel {
  bytes: Uint8Array<ArrayBuffer>
  /** Per vertex, x and y in texture pixels' 0..1 space (top left is 0, 0). */
  uvs: Float32Array
  indices: Uint32Array
  triangles: number
}

/** "Fill a part" choices, in plain words; the keys are the core's (`topology::FillMode::key`). */
export const FILL_MODES = [
  { key: 'part', label: 'A loose piece' },
  { key: 'flat', label: 'A flat side' },
  { key: 'loop', label: 'A ring of faces' },
  { key: 'polygon', label: 'One face' },
  { key: 'triangle', label: 'One triangle' },
  { key: 'uv_island', label: 'One piece of the texture (UV island)' },
  { key: 'object', label: 'A whole object of the file' },
  { key: 'texture_set', label: 'Everything with this material' },
] as const
export type FillModeKey = (typeof FILL_MODES)[number]['key']

/** Shape maps the core bakes (`bake::Map::key`), what they show, and how they join the layers. */
export const SHAPE_MAPS = [
  { key: 'occlusion', label: 'Shadows in corners (ambient occlusion)', blend: 'multiply', visible: true },
  { key: 'cavity', label: 'Dark seams and gaps (cavity)', blend: 'multiply', visible: true },
  { key: 'curvature', label: 'Bright edges, dark creases (curvature)', blend: 'overlay', visible: true },
  { key: 'thickness', label: 'Thin parts dark (thickness)', blend: 'source-over', visible: false },
  { key: 'sky', label: 'Where dust and rain land (sky exposure)', blend: 'source-over', visible: false },
  { key: 'height', label: 'Bottom dark, top bright (height)', blend: 'source-over', visible: false },
  { key: 'part_random', label: 'A different grey per piece (part random)', blend: 'source-over', visible: false },
  { key: 'edges', label: 'Near sharp edges (edge distance)', blend: 'source-over', visible: false },
  { key: 'creases', label: 'Near inner creases (crease distance)', blend: 'source-over', visible: false },
] as const
export type ShapeMapKey = (typeof SHAPE_MAPS)[number]['key']

/** Wear and dirt the core can place (`bake::Wear::key`), in plain words, with a starting amount. */
export const WEARS = [
  { key: 'edge_wear', label: 'Worn edges', hint: 'Paint rubbed off the sharp outer edges', amount: 0.35 },
  { key: 'dirt', label: 'Dirt in corners', hint: 'Grime where things meet and in gaps', amount: 0.45 },
  { key: 'dust', label: 'Dust on top', hint: 'Dust on surfaces that face up', amount: 0.5 },
  { key: 'rain_streaks', label: 'Rain streaks', hint: 'Long marks running down the sides', amount: 0.45 },
  { key: 'drips', label: 'Drips', hint: 'Thin runs down the steep sides', amount: 0.5 },
  { key: 'cavity_grime', label: 'Grime in seams', hint: 'Dark lines in small seams and engravings', amount: 0.5 },
  { key: 'crease_grime', label: 'Grime in creases', hint: 'Along the inner folds and creases', amount: 0.45 },
  { key: 'thin_areas', label: 'Thin parts', hint: 'Ears, leaves, cloth edges: for a glow or see-through', amount: 0.5 },
] as const
export type WearKey = (typeof WEARS)[number]['key']

export const coreAvailable = () => isTauri()

/**
 * Pack every mesh of `object` in world space (`texpaint::Mesh::from_bytes`'s format). Triangles are
 * grouped by the material they had in the file (`materials`, per mesh), one texture set each.
 */
export function packModel(meshes: THREE.Mesh[], materials: (THREE.Material | THREE.Material[])[], flipped: boolean): PackedModel {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const buckets = new Map<string, { tris: number[]; object: number[] }>()
  const normalMatrix = new THREE.Matrix3()
  const v = new THREE.Vector3()
  meshes.forEach((mesh, object) => {
    const g = mesh.geometry
    const pos = g.getAttribute('position')
    const nor = g.getAttribute('normal')
    const uv = g.getAttribute('uv')
    if (!pos || !uv) return
    mesh.updateWorldMatrix(true, false)
    normalMatrix.getNormalMatrix(mesh.matrixWorld)
    const base = positions.length / 3
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
      positions.push(v.x, v.y, v.z)
      if (nor) v.fromBufferAttribute(nor, i).applyMatrix3(normalMatrix).normalize()
      else v.set(0, 0, 0)
      normals.push(v.x, v.y, v.z)
      // shortcut: UVs outside 0..1 (tiling) are not wrapped here, so they bake and fill off the texture; wrap per triangle if tiled models need it.
      uvs.push(uv.getX(i), flipped ? 1 - uv.getY(i) : uv.getY(i))
    }
    const index = g.getIndex()
    const count = index ? index.count : pos.count
    const mats = materials[object] ?? mesh.material
    const materialOf = (corner: number) => {
      if (!Array.isArray(mats)) return mats
      const group = g.groups.find((gr) => corner >= gr.start && corner < gr.start + gr.count)
      return mats[group?.materialIndex ?? 0] ?? mats[0]
    }
    for (let c = 0; c + 2 < count; c += 3) {
      const m = materialOf(c)
      const key = m?.uuid ?? 'none'
      let b = buckets.get(key)
      if (!b) buckets.set(key, (b = { tris: [], object: [] }))
      for (let k = 0; k < 3; k++) b.tris.push(base + (index ? index.getX(c + k) : c + k))
      b.object.push(object)
    }
  })
  const indices: number[] = []
  const objects: number[] = []
  const sets: number[] = []
  for (const b of buckets.values()) {
    const start = indices.length / 3
    indices.push(...b.tris)
    objects.push(...b.object)
    sets.push(start, indices.length / 3)
  }
  const nv = positions.length / 3
  const nt = indices.length / 3
  const words = 3 + nv * 8 + nt * 4 + sets.length
  const buf = new ArrayBuffer(words * 4)
  const f = new Float32Array(buf)
  const u = new Uint32Array(buf)
  let at = 0
  u.set([nv, nt, sets.length / 2], at)
  at += 3
  f.set(positions, at)
  at += positions.length
  f.set(normals, at)
  at += normals.length
  f.set(uvs, at)
  at += uvs.length
  u.set(indices, at)
  at += indices.length
  u.set(objects, at)
  at += objects.length
  u.set(sets, at)
  return { bytes: new Uint8Array(buf), uvs: new Float32Array(uvs), indices: new Uint32Array(indices), triangles: nt }
}

export const loadModel = (doc: string, model: PackedModel) => invoke<number>('texpaint_load', model.bytes, { headers: { 'x-doc': doc } })
export const unloadModel = (doc: string) => (coreAvailable() ? invoke('texpaint_unload', { doc }).catch(() => undefined) : undefined)

/** The triangle a camera ray hits, and where. */
export const pick = (doc: string, origin: THREE.Vector3, dir: THREE.Vector3) =>
  invoke<[number, [number, number, number]] | null>('texpaint_pick', { doc, origin: origin.toArray(), dir: dir.toArray() })

/** The triangles "Fill a part" takes around `tri`. */
export const fillPart = (doc: string, mode: FillModeKey, tri: number, at: [number, number, number], angle = 30) =>
  invoke<number[]>('texpaint_fill', { doc, mode, tri, at, angle })

/** Bake one shape map at `size`²: a picture with the map in grey and see-through off the model. */
export async function bakeMap(doc: string, map: ShapeMapKey, size: number): Promise<ImageData> {
  const bytes = new Uint8Array(await invoke<ArrayBuffer>('texpaint_bake', { doc, size, maps: [map] }))
  return new ImageData(toRgba(bytes, size), size, size)
}

/** A wear mask at `size`²: white where the wear goes. */
export async function wearMask(doc: string, size: number, kind: WearKey, amount: number, breakup: number, seed: number): Promise<ImageData> {
  const bytes = new Uint8Array(await invoke<ArrayBuffer>('texpaint_wear', { doc, size, kind, amount, breakup, seed }))
  return new ImageData(toRgba(bytes, size), size, size)
}

/** A picture as a canvas, to hand to the Draw editor. */
export function toCanvas(img: ImageData): HTMLCanvasElement {
  const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height })
  c.getContext('2d')!.putImageData(img, 0, 0)
  return c
}

/** The core's answer (one grey plane, then the coverage plane) as RGBA pixels. */
export function toRgba(bytes: Uint8Array, size: number): Uint8ClampedArray<ArrayBuffer> {
  const n = size * size
  if (bytes.length !== n * 2) throw new Error('The baked map has the wrong size.')
  const out = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    const g = bytes[i]
    out[i * 4] = g
    out[i * 4 + 1] = g
    out[i * 4 + 2] = g
    out[i * 4 + 3] = bytes[n + i]
  }
  return out
}

/** Draw the picked triangles onto a texture of `size`, with a little padding so seams don't show. */
export function drawTriangles(ctx: CanvasRenderingContext2D, model: PackedModel, tris: number[], size: { width: number; height: number }, color: string) {
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1.5, size.width / 1024)
  ctx.lineJoin = 'round'
  ctx.beginPath()
  for (const t of tris) {
    if (t < 0 || t >= model.triangles) continue
    for (let k = 0; k < 3; k++) {
      const i = model.indices[t * 3 + k]
      const x = model.uvs[i * 2] * size.width
      const y = model.uvs[i * 2 + 1] * size.height
      if (k === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
  }
  ctx.fill()
  ctx.stroke()
}
