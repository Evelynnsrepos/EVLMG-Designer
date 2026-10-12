import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { jumpedSeam, uvFlipped, uvToPixel } from './model'

/** What the 3D view needs from the texture side. */
export interface PaintTarget {
  size: { width: number; height: number }
  /** Bumps whenever the texture changed. */
  version(): number
  /** The flattened texture. */
  texture(): HTMLCanvasElement
  down(p: { x: number; y: number; pressure: number }, time: number): boolean
  move(p: { x: number; y: number; pressure: number }, time: number): void
  up(): void
}

export interface ViewerHandle {
  /** The model's UV layout as white lines on a transparent canvas of the texture's size. */
  uvLayout(): HTMLCanvasElement | null
  /** The model with the painted texture, as GLB bytes. */
  exportGlb(): Promise<ArrayBuffer | null>
}

/** Parse a model file; null when the format is not supported or the file is broken. */
async function parseModel(bytes: ArrayBuffer, path: string): Promise<{ object: THREE.Object3D; original: CanvasImageSource | null }> {
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

const meshesOf = (o: THREE.Object3D) => {
  const out: THREE.Mesh[] = []
  o.traverse((x) => (x as THREE.Mesh).isMesh && out.push(x as THREE.Mesh))
  return out
}

/**
 * The 3D side of Texture Paint (v0.14): the model with the live texture, orbit with the right mouse
 * button (or by dragging next to the model), wheel to zoom, middle button to pan. Painting on the
 * model finds the texture spot under the pointer and paints there with the current Draw brush.
 * ponytail: paint follows the UV under the pointer (no screen-space projection), so a stroke crossing a
 * seam is split there; projection painting is the upgrade if seams need painting across.
 */
export function Viewer({ bytes, path, target, onOriginal, handleRef }: { bytes: ArrayBuffer | null; path: string; target: PaintTarget; onOriginal(img: CanvasImageSource): void; handleRef: Ref<ViewerHandle> }) {
  const box = useRef<HTMLDivElement>(null)
  const live = useRef({ target, onOriginal })
  useEffect(() => {
    live.current = { target, onOriginal }
  })
  const scene = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; texture: THREE.CanvasTexture; model: THREE.Object3D | null } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Renderer, camera, lights and the paint input, once.
  useEffect(() => {
    const el = box.current
    if (!el) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      setError('3D needs WebGL, which this computer or system does not offer. You can still paint on the texture on the right.')
      return
    }
    renderer.setPixelRatio(window.devicePixelRatio)
    el.appendChild(renderer.domElement)
    const s = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000)
    camera.position.set(2.5, 1.8, 3)
    s.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.8)
    sun.position.set(3, 5, 4)
    camera.add(sun)
    s.add(camera)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }
    const texture = new THREE.CanvasTexture(live.current.target.texture())
    texture.colorSpace = THREE.SRGBColorSpace
    // Pixel-art sized textures keep hard pixels on the model.
    if (live.current.target.size.width <= 256) {
      texture.magFilter = THREE.NearestFilter
      texture.minFilter = THREE.NearestFilter
      texture.generateMipmaps = false
    }
    scene.current = { renderer, scene: s, camera, controls, texture, model: null }

    const size = () => {
      const w = el.clientWidth || 1
      const h = el.clientHeight || 1
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    size()
    const ro = new ResizeObserver(size)
    ro.observe(el)

    // Painting: a left press on the model paints; anywhere else it turns the view.
    const ray = new THREE.Raycaster()
    const uvAt = (e: PointerEvent) => {
      const m = scene.current?.model
      if (!m) return null
      const r = renderer.domElement.getBoundingClientRect()
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera)
      const hit = ray.intersectObjects(meshesOf(m), false).find((h) => h.uv)
      return hit?.uv ? uvToPixel(hit.uv.x, hit.uv.y, live.current.target.size, uvFlipped(path)) : null
    }
    let last: { x: number; y: number } | null = null
    const pressure = (e: PointerEvent) => (e.pointerType === 'pen' ? Math.max(0.05, e.pressure) : 1)
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || e.altKey) return
      const p = uvAt(e)
      if (!p || !live.current.target.down({ ...p, pressure: pressure(e) }, e.timeStamp)) return
      // Ours, not a view turn.
      e.stopImmediatePropagation()
      renderer.domElement.setPointerCapture(e.pointerId)
      last = p
    }
    const move = (e: PointerEvent) => {
      if (!last) return
      const p = uvAt(e)
      if (!p) return
      if (jumpedSeam(last, p, live.current.target.size)) {
        // Another UV island: end this stroke and start a new one there.
        live.current.target.up()
        live.current.target.down({ ...p, pressure: pressure(e) }, e.timeStamp)
      } else live.current.target.move({ ...p, pressure: pressure(e) }, e.timeStamp)
      last = p
    }
    const up = () => {
      if (!last) return
      last = null
      live.current.target.up()
    }
    const canvas = renderer.domElement
    canvas.addEventListener('pointerdown', down, { capture: true })
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())

    let version = -1
    let raf = 0
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const v = live.current.target.version()
      if (v !== version) {
        version = v
        texture.image = live.current.target.texture()
        texture.needsUpdate = true
      }
      controls.update()
      renderer.render(s, camera)
    }
    frame()
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      canvas.remove()
      scene.current = null
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- set up once; the model has its own effect
  }, [])

  // The model.
  useEffect(() => {
    const sc = scene.current
    if (!sc || !bytes) return
    let gone = false
    setError(null)
    parseModel(bytes, path)
      .then(({ object, original }) => {
        if (gone) return
        if (sc.model) sc.scene.remove(sc.model)
        sc.texture.flipY = uvFlipped(path)
        sc.texture.needsUpdate = true
        const material = new THREE.MeshStandardMaterial({ map: sc.texture, roughness: 0.85, metalness: 0 })
        const meshes = meshesOf(object)
        if (!meshes.some((m) => m.geometry.getAttribute('uv'))) setError('This model has no UV layout, so it cannot hold a texture. Unwrap it in your 3D program first (in Blender: UV > Smart UV Project), then import it again.')
        for (const m of meshes) {
          m.material = material
          // Files without normals would look faceted.
          if (!m.geometry.getAttribute('normal')) m.geometry.computeVertexNormals()
        }
        // Centre and fit the model in view.
        const bounds = new THREE.Box3().setFromObject(object)
        const centre = bounds.getCenter(new THREE.Vector3())
        const radius = bounds.getSize(new THREE.Vector3()).length() / 2 || 1
        object.position.sub(centre)
        sc.scene.add(object)
        sc.model = object
        sc.camera.position.set(radius * 1.6, radius * 1.1, radius * 2.2)
        sc.camera.near = radius / 100
        sc.camera.far = radius * 100
        sc.camera.updateProjectionMatrix()
        sc.controls.target.set(0, 0, 0)
        if (original) live.current.onOriginal(original)
      })
      .catch(() => !gone && setError('This model file could not be read. GLB works best (in Blender: File > Export > glTF Binary).'))
    return () => {
      gone = true
    }
  }, [bytes, path])

  useImperativeHandle(handleRef, () => ({
    uvLayout() {
      const m = scene.current?.model
      if (!m) return null
      const { width, height } = target.size
      const c = document.createElement('canvas')
      c.width = width
      c.height = height
      const g = c.getContext('2d')!
      // Magenta reads on light and dark textures alike.
      g.strokeStyle = 'rgba(255, 0, 255, 0.85)'
      g.lineWidth = Math.max(1, width / 1024)
      g.beginPath()
      for (const mesh of meshesOf(m)) {
        const uv = mesh.geometry.getAttribute('uv')
        if (!uv) continue
        const index = mesh.geometry.getIndex()
        const count = index ? index.count : uv.count
        const at = (i: number) => uvToPixel(uv.getX(index ? index.getX(i) : i), uv.getY(index ? index.getX(i) : i), target.size, uvFlipped(path))
        for (let i = 0; i + 2 < count; i += 3) {
          const [a, b, d] = [at(i), at(i + 1), at(i + 2)]
          g.moveTo(a.x, a.y)
          g.lineTo(b.x, b.y)
          g.lineTo(d.x, d.y)
          g.closePath()
        }
      }
      g.stroke()
      return c
    },
    async exportGlb() {
      const m = scene.current?.model
      if (!m) return null
      // A plain copy of the texture for the file (the live one is shared with the editor).
      const copy = document.createElement('canvas')
      copy.width = target.size.width
      copy.height = target.size.height
      copy.getContext('2d')!.drawImage(target.texture(), 0, 0)
      const map = new THREE.CanvasTexture(copy)
      map.flipY = uvFlipped(path)
      map.colorSpace = THREE.SRGBColorSpace
      const out = m.clone(true)
      out.position.set(0, 0, 0)
      for (const mesh of meshesOf(out)) mesh.material = new THREE.MeshStandardMaterial({ map, roughness: 0.85, metalness: 0 })
      const result = await new GLTFExporter().parseAsync(out, { binary: true })
      return result as ArrayBuffer
    },
  }))

  return (
    <div className="tp-viewer" ref={box}>
      {error && <p className="tp-error">{error}</p>}
    </div>
  )
}
