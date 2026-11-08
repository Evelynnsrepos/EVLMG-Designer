import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'

/** 3D model files that `parseModel` reads (Texture Paint, Draw's light preview). */
export const MODEL_FORMATS = ['glb', 'gltf', 'obj', 'fbx']

/** Parse a model file; throws when the format is not supported or the file is broken. */
export async function parseModel(bytes: ArrayBuffer, path: string): Promise<{ object: THREE.Object3D; original: CanvasImageSource | null }> {
  const ext = path.split('.').pop()!.toLowerCase()
  let object: THREE.Object3D
  if (ext === 'glb' || ext === 'gltf') object = (await new GLTFLoader().parseAsync(bytes, '')).scene
  else if (ext === 'obj') object = new OBJLoader().parse(new TextDecoder().decode(bytes))
  else if (ext === 'fbx') object = new FBXLoader().parse(bytes, '')
  else throw new Error('Unsupported model format')
  // The model's own colour texture, so it can become the first layer.
  let original: CanvasImageSource | null = null
  object.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
    if (!original && m && !Array.isArray(m) && m.map?.image) original = m.map.image as CanvasImageSource
  })
  return { object, original }
}

export const meshesOf = (o: THREE.Object3D) => {
  const out: THREE.Mesh[] = []
  o.traverse((x) => (x as THREE.Mesh).isMesh && out.push(x as THREE.Mesh))
  return out
}
