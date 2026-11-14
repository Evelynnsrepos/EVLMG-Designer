import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { packModel, toRgba } from './core'

describe('Texture Paint core packing', () => {
  it('packs world-space meshes in the layout texpaint::Mesh::from_bytes reads, one texture set per material', () => {
    // A 1×1 plane (2 triangles) with two materials, one per triangle, moved up by 2.
    const g = new THREE.PlaneGeometry(1, 1)
    g.addGroup(0, 3, 0)
    g.addGroup(3, 3, 1)
    const red = new THREE.MeshBasicMaterial()
    const blue = new THREE.MeshBasicMaterial()
    const mesh = new THREE.Mesh(g, [red, blue])
    mesh.position.y = 2
    const p = packModel([mesh], [[red, blue]], true)
    const u = new Uint32Array(p.bytes.buffer)
    const f = new Float32Array(p.bytes.buffer)
    const [nv, nt, ns] = u
    expect([nv, nt, ns]).toEqual([4, 2, 2])
    expect(p.bytes.length).toBe((3 + nv * 8 + nt * 4 + ns * 2) * 4)
    // Positions are in world space.
    expect(f[3 + 1]).toBeCloseTo(2.5)
    // UVs come flipped into picture space (OBJ/FBX keep v = 0 at the bottom).
    const uvAt = 3 + nv * 6
    expect(f[uvAt + 1]).toBeCloseTo(1 - g.getAttribute('uv').getY(0))
    expect(p.uvs[1]).toBeCloseTo(f[uvAt + 1])
    // Sets: [0, 1) and [1, 2).
    const setsAt = 3 + nv * 8 + nt * 4
    expect([...u.slice(setsAt, setsAt + 4)]).toEqual([0, 1, 1, 2])
    // Every index points at a vertex.
    expect([...p.indices].every((i) => i < nv)).toBe(true)
  })

  it('turns a baked map into a picture with see-through off the model', () => {
    const px = toRgba(new Uint8Array([10, 20, 30, 40, 255, 0, 255, 0]), 2)
    expect([...px.slice(0, 8)]).toEqual([10, 10, 10, 255, 20, 20, 20, 0])
    expect(() => toRgba(new Uint8Array(3), 2)).toThrow()
  })
})
