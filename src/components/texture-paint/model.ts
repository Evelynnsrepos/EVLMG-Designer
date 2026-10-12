import { createSketchDoc, type SketchDoc } from '@/shared/sketch'

/**
 * Texture Paint (v0.14): a 3D model and its texture. The texture is a Draw document (layers,
 * brushes, undo), so everything Draw can do works on it; the model file lives in the project's
 * assets/models/ folder.
 */
export interface TexturePaintDoc extends SketchDoc {
  started: boolean
  /** Project-relative path of the model file (.glb, .obj or .fbx); null before one is chosen. */
  model: string | null
  modelName: string
}

export const createTexturePaintDoc = (): TexturePaintDoc => ({ ...createSketchDoc(2048, 2048), started: false, model: null, modelName: '' })

export const MODEL_EXTENSIONS = ['glb', 'gltf', 'obj', 'fbx']
/** Small sizes are for pixel-art textures, shown with hard pixels on the model (v0.16). */
export const TEXTURE_SIZES = [64, 128, 256, 1024, 2048, 4096]

/** glTF keeps UV (0,0) at the top left of the image; OBJ and FBX at the bottom left. */
export const uvFlipped = (modelPath: string) => !/\.(glb|gltf)$/i.test(modelPath)

/** Texture pixel for a UV coordinate. */
export function uvToPixel(u: number, v: number, size: { width: number; height: number }, flipped: boolean) {
  const fu = u - Math.floor(u)
  const fv = v - Math.floor(v)
  return { x: fu * size.width, y: (flipped ? 1 - fv : fv) * size.height }
}

/** A stroke jumped across a seam (to another UV island) when two points lie far apart on the texture. */
export const jumpedSeam = (a: { x: number; y: number }, b: { x: number; y: number }, size: { width: number; height: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y) > Math.max(size.width, size.height) * 0.08
