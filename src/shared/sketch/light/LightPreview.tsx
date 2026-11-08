import { Box, Circle, Cone, Cylinder, Lightbulb, Lock, LockOpen, Move, Plus, RotateCcw, Sun, Torus, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { getFs } from '@/core/fs'
import { meshesOf, MODEL_FORMATS, parseModel } from '@/shared/model3d'
import { AIM, anglesAt, defaultSetup, FLOOR, uid, lampPosition, MAX_LAMPS, MAX_THINGS, restoreSetup, toneSteps, type Lamp, type LightSetup, type Shape, type Thing } from './setup'
import './light.css'

const UI = {
  noWebgl: 'The light preview needs WebGL (3D graphics), which this computer or system does not offer.',
  views: { clay: 'Clay', three: '3 tones', two: 'Light / shadow' },
  viewHint: {
    clay: 'Grey clay with soft shading',
    three: 'Three flat tones: lit, half tone and shadow. Cast shadows count as shadow.',
    two: 'Only light and shadow, so the shadow shapes are easy to see',
  },
  lock: 'Lock the view so it stays at your drawing’s angle',
  unlock: 'Unlock the view (drag to turn, pinch or wheel to zoom)',
  moveMode: 'Move objects: drag an object along the floor',
  reset: 'Start over with the default setup',
  objects: 'Objects',
  lamps: 'Lamps',
  addShape: { ball: 'Add a ball', cube: 'Add a cube', cylinder: 'Add a cylinder', cone: 'Add a cone', ring: 'Add a ring', model: '' } as Record<Shape, string>,
  shapeName: { ball: 'Ball', cube: 'Cube', cylinder: 'Cylinder', cone: 'Cone', ring: 'Ring', model: 'Model' } as Record<Shape, string>,
  loadModel: 'Add your own model (GLB, glTF, OBJ, FBX). It stays until you close the app.',
  modelFailed: 'This model file could not be read. GLB works best.',
  size: 'Size',
  turn: 'Turn',
  remove: 'Remove',
  addLamp: 'Add a lamp',
  lampOn: 'Lamp on or off',
  sun: 'Sun: parallel light, shadows keep their size. Click for a bulb.',
  bulb: 'Bulb: light from one point, shadows spread out. Click for a sun.',
  lampColor: 'Lamp colour',
  strength: 'Strength',
  distance: 'Distance',
  room: 'Shadow brightness',
  softness: 'Shadow softness',
  hint: 'Drag a lamp (the coloured dot) to move it around. Turn the view to reach behind the objects.',
  full: 'Up to 4 lamps',
}

const STORE = 'egd.sketch.lightSetup'
/** Models loaded this session, by key (bytes aren't stored on the device). */
const models = new Map<string, THREE.Object3D>()

function readStored(): unknown {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? 'null')
  } catch {
    return null
  }
}
function store(s: LightSetup) {
  try {
    localStorage.setItem(STORE, JSON.stringify(s))
  } catch {
    // Only a convenience.
  }
}

// Every shape stands on the floor and is about one unit tall at size 1.
function shapeMesh(shape: Exclude<Shape, 'model'>): THREE.Mesh {
  const g =
    shape === 'ball'
      ? new THREE.SphereGeometry(0.5, 48, 32)
      : shape === 'cube'
        ? new THREE.BoxGeometry(0.9, 0.9, 0.9)
        : shape === 'cylinder'
          ? new THREE.CylinderGeometry(0.42, 0.42, 1, 48)
          : shape === 'cone'
            ? new THREE.ConeGeometry(0.48, 1, 48)
            : new THREE.TorusGeometry(0.33, 0.15, 24, 64)
  const m = new THREE.Mesh(g)
  m.position.y = shape === 'cube' ? 0.45 : shape === 'ring' ? 0.48 : 0.5
  return m
}

/** A loaded model scaled to about one unit and put on the floor. */
function fitModel(object: THREE.Object3D): THREE.Object3D {
  const bounds = new THREE.Box3().setFromObject(object)
  const size = bounds.getSize(new THREE.Vector3())
  const s = 1 / (Math.max(size.x, size.y, size.z) || 1)
  const centre = bounds.getCenter(new THREE.Vector3())
  object.scale.multiplyScalar(s)
  object.position.set(-centre.x * s, -bounds.min.y * s, -centre.z * s)
  for (const m of meshesOf(object)) if (!m.geometry.getAttribute('normal')) m.geometry.computeVertexNormals()
  const g = new THREE.Group()
  g.add(object)
  return g
}

/** Take an object out of the scene and free its own geometry (loaded models are shared, so they stay). */
function drop(st: Stage, group: THREE.Object3D) {
  st.scene.remove(group)
  for (const m of meshesOf(group)) if (!m.userData.model) m.geometry.dispose()
}

interface Stage {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  room: THREE.HemisphereLight
  floor: THREE.Mesh
  things: Map<string, { group: THREE.Group; key: string }>
  lamps: Map<string, { light: THREE.DirectionalLight | THREE.PointLight; dot: THREE.Mesh; line: THREE.Line }>
  outline: THREE.BoxHelper
  /** Materials for the current view; made again only when the view changes. */
  look: { view: string; clay: THREE.Material; floor: THREE.Material; gradient: THREE.Texture } | null
  render(): void
}

/** The light preview (Draw): grey objects on a floor lit by up to four lamps, to see where shadows fall. */
export default function LightPreview() {
  const [setup, setSetupState] = useState<LightSetup>(() => restoreSetup(readStored(), new Set(models.keys())))
  const [selected, setSelected] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)
  const [locked, setLocked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const stage = useRef<Stage | null>(null)
  const set = (fn: (s: LightSetup) => LightSetup) =>
    setSetupState((s) => {
      const next = fn(s)
      store(next)
      return next
    })
  const live = useRef({ setup, moving, set, setSelected })
  useEffect(() => {
    live.current = { setup, moving, set, setSelected }
  })

  // Renderer, camera, floor and pointer handling, once.
  useEffect(() => {
    const el = box.current
    if (!el) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true })
    } catch {
      setError(UI.noWebgl)
      return
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x2c2c31)
    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100)
    // Far enough back that lamps at their usual distance are in view.
    camera.position.set(4.4, 3.4, 6.4)
    const room = new THREE.HemisphereLight(0xffffff, 0x666666, 1)
    scene.add(room)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40))
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    scene.add(floor)
    const outline = new THREE.BoxHelper(floor, 0x6aa9ff)
    outline.visible = false
    scene.add(outline)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(AIM.x, AIM.y, AIM.z)
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }
    // Keep the camera above the floor.
    controls.maxPolarAngle = Math.PI / 2 - 0.02
    controls.minDistance = 1
    controls.maxDistance = 20
    const render = () => renderer.render(scene, camera)
    controls.addEventListener('change', render)
    controls.update()
    const st: Stage = { renderer, scene, camera, controls, room, floor, things: new Map(), lamps: new Map(), outline, look: null, render }
    stage.current = st

    const size = () => {
      const w = el.clientWidth || 1
      const h = el.clientHeight || 1
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      render()
    }
    const ro = new ResizeObserver(size)
    ro.observe(el)
    size()

    // Pointer: drag a lamp dot, or (in move mode) an object; a tap on an object selects it.
    const canvas = renderer.domElement
    const ray = new THREE.Raycaster()
    const aim = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect()
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera)
    }
    const thingAt = () => {
      for (const hit of ray.intersectObjects([...st.things.values()].map((t) => t.group), true)) {
        for (const [id, t] of st.things) {
          let o: THREE.Object3D | null = hit.object
          while (o && o !== t.group) o = o.parent
          if (o) return id
        }
      }
      return null
    }
    const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    let drag: { kind: 'lamp' | 'thing'; id: string; dx: number; dz: number } | null = null
    let tap: { x: number; y: number } | null = null
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return
      aim(e)
      tap = { x: e.clientX, y: e.clientY }
      const dot = ray.intersectObjects([...st.lamps.values()].map((l) => l.dot), false)[0]
      const lamp = dot && [...st.lamps].find(([, l]) => l.dot === dot.object)?.[0]
      if (lamp) drag = { kind: 'lamp', id: lamp, dx: 0, dz: 0 }
      else if (live.current.moving) {
        const id = thingAt()
        const t = id && live.current.setup.things.find((x) => x.id === id)
        const p = ray.ray.intersectPlane(ground, new THREE.Vector3())
        if (t && p) {
          drag = { kind: 'thing', id: t.id, dx: t.x - p.x, dz: t.z - p.z }
          live.current.setSelected(t.id)
        }
      }
      if (!drag) return
      // Ours, not a view turn.
      e.stopImmediatePropagation()
      canvas.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      if (!drag) return
      aim(e)
      const d = drag
      if (d.kind === 'lamp') {
        const lamp = live.current.setup.lamps.find((l) => l.id === d.id)
        if (!lamp) return
        // The lamp slides over a ball around the scene; past its edge it stays on the rim.
        const centre = new THREE.Vector3(AIM.x, AIM.y, AIM.z)
        const p = ray.ray.intersectSphere(new THREE.Sphere(centre, lamp.distance), new THREE.Vector3()) ?? ray.ray.closestPointToPoint(centre, new THREE.Vector3()).sub(centre).setLength(lamp.distance).add(centre)
        const a = anglesAt(p.x, p.y, p.z)
        live.current.set((s) => ({ ...s, lamps: s.lamps.map((l) => (l.id === d.id ? { ...l, ...a } : l)) }))
      } else {
        const p = ray.ray.intersectPlane(ground, new THREE.Vector3())
        if (!p) return
        const x = Math.max(-FLOOR, Math.min(FLOOR, p.x + d.dx))
        const z = Math.max(-FLOOR, Math.min(FLOOR, p.z + d.dz))
        live.current.set((s) => ({ ...s, things: s.things.map((t) => (t.id === d.id ? { ...t, x, z } : t)) }))
      }
    }
    const up = (e: PointerEvent) => {
      if (!drag && tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 5) {
        aim(e)
        live.current.setSelected(thingAt())
      }
      drag = null
      tap = null
    }
    canvas.addEventListener('pointerdown', down, { capture: true })
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())

    return () => {
      ro.disconnect()
      controls.dispose()
      scene.traverse((o) => {
        const m = o as THREE.Mesh
        // Loaded models are shared between objects and sessions of the panel; their geometry stays.
        if (m.isMesh && !m.userData.model) m.geometry.dispose()
      })
      for (const l of st.lamps.values()) l.light.dispose()
      if (st.look) for (const m of [st.look.clay, st.look.floor, st.look.gradient]) m.dispose()
      renderer.dispose()
      canvas.remove()
      stage.current = null
    }
  }, [])

  // Bring the scene in line with the setup.
  useEffect(() => {
    const st = stage.current
    if (!st) return
    const small = Math.min(window.screen.width, window.screen.height) < 700
    if (st.look?.view !== setup.view) {
      const steps = toneSteps(setup.view)
      const gradient = new THREE.DataTexture(new Uint8Array(steps.map((v) => Math.round(v * 255))), steps.length, 1, THREE.RedFormat)
      gradient.needsUpdate = true
      gradient.minFilter = gradient.magFilter = THREE.NearestFilter
      const material = (color: number) => (setup.view === 'clay' ? new THREE.MeshStandardMaterial({ color, roughness: 0.75 }) : new THREE.MeshToonMaterial({ color, gradientMap: gradient }))
      if (st.look) for (const m of [st.look.clay, st.look.floor, st.look.gradient]) m.dispose()
      st.look = { view: setup.view, clay: material(0xd2d2d2), floor: material(0x9a9a9a), gradient }
      st.floor.material = st.look.floor
    }
    const clay = st.look.clay

    // Objects: rebuild only when the shape or model changed, otherwise just move.
    const wanted = new Set(setup.things.map((t) => t.id))
    for (const [id, t] of st.things) {
      if (wanted.has(id)) continue
      drop(st, t.group)
      st.things.delete(id)
    }
    for (const t of setup.things) {
      const key = t.shape === 'model' ? `model:${t.model}` : t.shape
      let entry = st.things.get(t.id)
      if (entry && entry.key !== key) {
        drop(st, entry.group)
        entry = undefined
      }
      if (!entry) {
        const group = new THREE.Group()
        const template = t.shape === 'model' ? models.get(t.model!) : null
        if (t.shape === 'model' && !template) continue
        const body = template ? template.clone(true) : shapeMesh(t.shape as Exclude<Shape, 'model'>)
        if (template) for (const m of meshesOf(body)) m.userData.model = true
        group.add(body)
        st.scene.add(group)
        entry = { group, key }
        st.things.set(t.id, entry)
      }
      entry.group.position.set(t.x, 0, t.z)
      entry.group.scale.setScalar(t.size)
      entry.group.rotation.y = (t.turn * Math.PI) / 180
      for (const m of meshesOf(entry.group)) {
        m.material = clay
        m.castShadow = true
        m.receiveShadow = true
      }
    }

    // Lamps: a light, a dot to drag and a faint line to the middle.
    for (const [id, l] of st.lamps) {
      if (setup.lamps.some((x) => x.id === id && (x.kind === 'sun') === l.light instanceof THREE.DirectionalLight)) continue
      st.scene.remove(l.light, l.dot, l.line)
      if (l.light instanceof THREE.DirectionalLight) st.scene.remove(l.light.target)
      l.light.dispose()
      st.lamps.delete(id)
    }
    for (const lamp of setup.lamps) {
      let entry = st.lamps.get(lamp.id)
      if (!entry) {
        const light = lamp.kind === 'sun' ? new THREE.DirectionalLight() : new THREE.PointLight()
        light.castShadow = true
        light.shadow.mapSize.setScalar(small ? 512 : 1024)
        light.shadow.bias = -0.0005
        light.shadow.normalBias = 0.02
        if (light instanceof THREE.DirectionalLight) {
          const c = light.shadow.camera
          c.left = c.bottom = -FLOOR - 1
          c.right = c.top = FLOOR + 1
          c.near = 0.1
          c.far = 30
          light.target.position.set(AIM.x, AIM.y, AIM.z)
          st.scene.add(light.target)
        } else {
          light.shadow.camera.near = 0.05
          light.shadow.camera.far = 30
          light.decay = 2
        }
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 12), new THREE.MeshBasicMaterial())
        const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.35 }))
        st.scene.add(light, dot, line)
        entry = { light, dot, line }
        st.lamps.set(lamp.id, entry)
      }
      const [x, y, z] = lampPosition(lamp)
      const { light, dot, line } = entry
      light.position.set(x, y, z)
      light.color.set(lamp.color)
      // A bulb gets as bright as a sun at the default distance, brighter closer up, darker further away.
      light.intensity = !lamp.on ? 0 : lamp.kind === 'sun' ? lamp.strength * 2 : lamp.strength * 2 * 16
      light.visible = lamp.on
      light.shadow.radius = 1 + setup.softness * 14
      ;(dot.material as THREE.MeshBasicMaterial).color.set(lamp.on ? lamp.color : '#555555')
      dot.position.set(x, y, z)
      ;(line.material as THREE.LineBasicMaterial).color.set(lamp.color)
      line.geometry.setFromPoints([new THREE.Vector3(x, y, z), new THREE.Vector3(AIM.x, AIM.y, AIM.z)])
    }
    st.room.intensity = 0.2 + setup.room * 2.2
    // The tone views show the shadow side at the room brightness, so bounce light stays flat there.
    st.room.groundColor.set(setup.view === 'clay' ? 0x666666 : 0xffffff)

    const sel = selected ? st.things.get(selected) : undefined
    st.outline.visible = !!sel
    if (sel) st.outline.setFromObject(sel.group)
    st.render()
  }, [setup, selected])

  useEffect(() => {
    if (stage.current) stage.current.controls.enabled = !locked
  }, [locked])

  const addThing = (shape: Shape, model?: { key: string; name: string }) =>
    set((s) => {
      if (s.things.length >= MAX_THINGS) return s
      // New objects go in a ring around the middle so they don't sit inside each other.
      const i = s.things.length
      const a = i * 2.4
      const t: Thing = { id: uid(), shape, x: i ? Math.sin(a) * 1.3 : 0, z: i ? Math.cos(a) * 1.3 : 0, size: 1, turn: 0, ...(model ? { model: model.key, name: model.name } : {}) }
      setSelected(t.id)
      return { ...s, things: [...s.things, t] }
    })
  const loadModel = async () => {
    const [picked] = await getFs().pickFiles(UI.loadModel, MODEL_FORMATS)
    if (!picked) return
    const name = picked.split(/[\\/]/).pop() ?? 'model'
    try {
      const bytes = await getFs().readBinary(picked)
      const { object } = await parseModel(bytes.slice().buffer as ArrayBuffer, name)
      const key = uid()
      models.set(key, fitModel(object))
      setError(null)
      addThing('model', { key, name })
    } catch {
      setError(UI.modelFailed)
    }
  }
  const patchThing = (id: string, patch: Partial<Thing>) => set((s) => ({ ...s, things: s.things.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
  const patchLamp = (id: string, patch: Partial<Lamp>) => set((s) => ({ ...s, lamps: s.lamps.map((l) => (l.id === id ? { ...l, ...patch } : l)) }))
  const sel = setup.things.find((t) => t.id === selected)

  return (
    <div className="lightp">
      <div className="lightp-view" ref={box}>
        {error && <p className="lightp-error">{error}</p>}
      </div>
      <div className="lightp-row">
        <span className="lightp-seg" role="group">
          {(['clay', 'three', 'two'] as const).map((v) => (
            <button key={v} className={`btn btn-ghost${setup.view === v ? ' is-active' : ''}`} title={UI.viewHint[v]} aria-pressed={setup.view === v} onClick={() => set((s) => ({ ...s, view: v }))}>
              {UI.views[v]}
            </button>
          ))}
        </span>
        <span className="fp-spacer" />
        <button className={`icon-btn${moving ? ' is-active' : ''}`} title={UI.moveMode} aria-label={UI.moveMode} aria-pressed={moving} onClick={() => setMoving(!moving)}>
          <Move size={15} />
        </button>
        <button className={`icon-btn${locked ? ' is-active' : ''}`} title={locked ? UI.unlock : UI.lock} aria-label={locked ? UI.unlock : UI.lock} aria-pressed={locked} onClick={() => setLocked(!locked)}>
          {locked ? <Lock size={15} /> : <LockOpen size={15} />}
        </button>
        <button
          className="icon-btn"
          title={UI.reset}
          aria-label={UI.reset}
          onClick={() => {
            set(() => defaultSetup())
            setSelected(null)
          }}
        >
          <RotateCcw size={15} />
        </button>
      </div>
      <p className="lightp-hint">{UI.hint}</p>

      <h5>{UI.objects}</h5>
      <div className="lightp-row">
        {(
          [
            ['ball', Circle],
            ['cube', Box],
            ['cylinder', Cylinder],
            ['cone', Cone],
            ['ring', Torus],
          ] as const
        ).map(([shape, Icon]) => (
          <button key={shape} className="icon-btn" title={UI.addShape[shape]} aria-label={UI.addShape[shape]} disabled={setup.things.length >= MAX_THINGS} onClick={() => addThing(shape)}>
            <Icon size={15} />
          </button>
        ))}
        <button className="icon-btn" title={UI.loadModel} aria-label={UI.loadModel} disabled={setup.things.length >= MAX_THINGS} onClick={() => void loadModel()}>
          <Upload size={15} />
        </button>
      </div>
      <div className="lightp-chips">
        {setup.things.map((t) => (
          <button key={t.id} className={`lightp-chip${t.id === selected ? ' is-active' : ''}`} onClick={() => setSelected(t.id === selected ? null : t.id)}>
            {t.name ?? UI.shapeName[t.shape]}
          </button>
        ))}
      </div>
      {sel && (
        <div className="lightp-card">
          <Slider label={UI.size} min={0.2} max={3} step={0.05} value={sel.size} onChange={(size) => patchThing(sel.id, { size })} />
          <Slider label={UI.turn} min={-180} max={180} step={1} value={sel.turn} onChange={(turn) => patchThing(sel.id, { turn })} />
          <button
            className="btn btn-ghost"
            onClick={() => {
              set((s) => ({ ...s, things: s.things.filter((t) => t.id !== sel.id) }))
              setSelected(null)
            }}
          >
            <X size={13} /> {UI.remove}
          </button>
        </div>
      )}

      <h5>{UI.lamps}</h5>
      {setup.lamps.map((l) => (
        <div key={l.id} className="lightp-card">
          <div className="lightp-row">
            <input type="checkbox" checked={l.on} title={UI.lampOn} aria-label={UI.lampOn} onChange={(e) => patchLamp(l.id, { on: e.target.checked })} />
            <button className="icon-btn" title={l.kind === 'sun' ? UI.sun : UI.bulb} aria-label={l.kind === 'sun' ? UI.sun : UI.bulb} onClick={() => patchLamp(l.id, { kind: l.kind === 'sun' ? 'bulb' : 'sun' })}>
              {l.kind === 'sun' ? <Sun size={15} /> : <Lightbulb size={15} />}
            </button>
            <input type="color" value={l.color} title={UI.lampColor} aria-label={UI.lampColor} onChange={(e) => patchLamp(l.id, { color: e.target.value })} />
            <span className="fp-spacer" />
            <button className="icon-btn" title={UI.remove} aria-label={UI.remove} onClick={() => set((s) => ({ ...s, lamps: s.lamps.filter((x) => x.id !== l.id) }))}>
              <X size={14} />
            </button>
          </div>
          <Slider label={UI.strength} min={0} max={3} step={0.05} value={l.strength} onChange={(strength) => patchLamp(l.id, { strength })} />
          <Slider label={UI.distance} min={1} max={8} step={0.1} value={l.distance} onChange={(distance) => patchLamp(l.id, { distance })} />
        </div>
      ))}
      <button
        className="btn btn-ghost"
        disabled={setup.lamps.length >= MAX_LAMPS}
        title={setup.lamps.length >= MAX_LAMPS ? UI.full : undefined}
        onClick={() =>
          set((s) => ({
            ...s,
            // A new lamp starts on the other side of the last one, as a fill or rim light.
            lamps: [...s.lamps, { id: uid(), on: true, kind: 'sun', strength: 0.6, color: '#cfe0ff', azimuth: (s.lamps.at(-1)?.azimuth ?? 0) + 150, elevation: 25, distance: 3 }],
          }))
        }
      >
        <Plus size={13} /> {UI.addLamp}
      </button>
      <Slider label={UI.room} min={0} max={1} step={0.01} value={setup.room} onChange={(room) => set((s) => ({ ...s, room }))} />
      <Slider label={UI.softness} min={0} max={1} step={0.01} value={setup.softness} onChange={(softness) => set((s) => ({ ...s, softness }))} />
    </div>
  )
}

function Slider(p: { label: string; min: number; max: number; step: number; value: number; onChange(v: number): void }) {
  return (
    <label className="lightp-slider">
      <span>{p.label}</span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} />
    </label>
  )
}
