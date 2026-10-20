import { commentTool } from '@/shared/reviews'
import { Download, Eye, EyeOff, ImagePlus, Lock, Settings2, Trash2, Unlock } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { assetUrl, dragHasFiles, importAssetsFromDataTransfer, pickAndImportAssets, useAssetUrls, type ImportedAsset } from '@/core/assets'
import { newId, type Id, type Town } from '@/core/model'
import type { PanelProps } from '@/core/registry'
import { useDocument, useProjectStore } from '@/core/state'
import { openEntity } from '@/shared/entityList'
import {
  addNodes,
  CanvasEditor,
  deleteNodes,
  eraserTool,
  handTool,
  penTool,
  sceneBinding,
  screenToWorld,
  selectTool,
  textTool,
  updateLayer,
  updateNode,
  useCanvasState,
  type CanvasApi,
  type CanvasTool,
  type Point,
} from '@/shared/canvas'
import { CityPanel } from './CityPanel'
import { ZonePanel, type ZoneFaction } from './ZonePanel'
import {
  addCity,
  createDefaultMap,
  ensureMapLayers,
  INK,
  isCity,
  isZone,
  LAYER_NAMES,
  layerForTool,
  makeCity,
  MAP_LAYERS,
  PAPER_COLORS,
  STREET_STYLES,
  townsOnMap,
  ZONE_COLORS,
  type BackdropNode,
  type CityNode,
  type MapLayerId,
  type MapNode,
  type StreetStyle,
  type ZoneNode,
} from './model'
import { makeMapNodeTypes } from './nodeTypes'
import { NewCityPopup } from './NewCityPopup'
import { STAMPS, StampIcon, type StampKind } from './stamps'
import { cityTool, stampTool, streetTool, zoneTool, type MapToolHost } from './tools'
import './map.css'

const UI = {
  canvas: 'Map',
  settings: 'Map settings',
  paper: 'Paper color',
  layers: 'Layers',
  show: 'Show',
  hide: 'Hide',
  background: 'Background image',
  addBackground: 'Add image to trace',
  replaceBackground: 'Replace image',
  opacity: 'Opacity',
  lock: 'Lock in place',
  unlock: 'Unlock to move or resize',
  removeBackground: 'Remove image',
  exportPng: 'Export as PNG',
  stamps: 'Terrain stamps',
  stampSize: 'Stamp size',
  streetStyle: 'Street style',
  emptyHint: 'A blank map. Press C and click to place a city, S to draw streets and rivers, B to paint terrain stamps, Z to mark zones like the land of a faction.',
  dropHint: 'Drop an image to use it as the background',
  untitled: 'Map',
}

const STAMP_SIZES = [20, 32, 48, 72]

export default function View({ documentId, active }: PanelProps) {
  const doc = useDocument('map', documentId!, createDefaultMap)
  // Factions are read through the project's documents (the Factions tool owns them).
  // Same default as the Factions tool, as both share one cached document.
  const factionsDoc = useDocument<{ items: ZoneFaction[]; relations: Record<string, number>; mutual: boolean }>('factions', 'factions', () => ({ items: [], relations: {}, mutual: true }))
  const factions = useMemo(() => factionsDoc.data?.items ?? [], [factionsDoc.data])
  const root = useProjectStore((s) => s.root)
  const towns = useProjectStore((s) => s.entities.town)
  const categories = useProjectStore((s) => s.categories)
  const title = useProjectStore((s) => s.meta?.documents.find((d) => d.id === documentId)?.title)
  const canvas = useCanvasState({ toolId: 'select' })
  const apiRef = useRef<CanvasApi<MapNode> | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const [pendingCity, setPendingCity] = useState<Point | null>(null)
  const [streetStyle, setStreetStyle] = useState<StreetStyle>('road')
  const [stamp, setStamp] = useState<{ icon: StampKind; size: number }>({ icon: 'tree', size: 32 })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [panelHiddenFor, setPanelHiddenFor] = useState<Id | null>(null)
  const [dropping, setDropping] = useState(false)

  // Tools are created once and read the current options through a ref.
  const live = useRef({ pendingCity, streetStyle, stamp })
  useLayoutEffect(() => {
    live.current = { pendingCity, streetStyle, stamp }
  })
  const tools = useMemo<CanvasTool<MapNode>[]>(() => {
    const host: MapToolHost = {
      requestCity: (at) => setPendingCity(at),
      cancelCity: () => {
        const open = live.current.pendingCity !== null
        live.current.pendingCity = null
        setPendingCity(null)
        return open
      },
      streetStyle: () => live.current.streetStyle,
      stamp: () => live.current.stamp,
      zoneColor: () => ZONE_COLORS[Math.floor(Math.random() * ZONE_COLORS.length)],
      zoneDrawn: (id) => {
        canvas.setToolId('select')
        canvas.setSelection([id])
      },
    }
    return [
      selectTool,
      handTool,
      cityTool(host),
      streetTool(host),
      stampTool(host),
      zoneTool(host),
      textTool({ defaults: () => ({ textColor: INK, fontSize: 22 }) }),
      penTool({ defaults: () => ({ strokeColor: INK, strokeWidth: 2 }) }),
      eraserTool(),
      commentTool('map', documentId ?? null),
    ]
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- canvas setters are stable
  }, [documentId])

  // Each tool draws into its own layer (terrain under streets under cities under labels).
  const { toolId, setActiveLayerId } = canvas
  useEffect(() => {
    const layer = layerForTool(toolId)
    if (layer) setActiveLayerId(layer)
  }, [toolId, setActiveLayerId])

  const scene = doc.data?.scene
  const update = doc.update
  useEffect(() => {
    if (scene && ensureMapLayers(scene) !== scene) update((d) => ({ ...d, scene: ensureMapLayers(d.scene) }), { undoable: false })
  }, [scene, update])

  const townById = useMemo(() => new Map(towns.map((t) => [t.id, t])), [towns])
  const nodeTypes = useMemo(() => {
    const factionById = new Map(factions.map((f) => [f.id, f]))
    const zoneLook = (z: ZoneNode) => {
      const f = z.factionId ? factionById.get(z.factionId) : undefined
      return { name: z.name || f?.name || '', color: f?.color ?? z.color }
    }
    return makeMapNodeTypes({ townName: (id) => townById.get(id)?.name || null, zoneLook })
  }, [townById, factions])
  const backdrop = scene?.nodes.find((n): n is BackdropNode => n.kind === 'backdrop')
  const resolveImageSrc = useAssetUrls([backdrop?.src])

  if (!doc.data || !scene) return null
  const binding = sceneBinding(doc)
  const paperColor = doc.data.paperColor
  const { updateEntity, addEntity, setCategories } = useProjectStore.getState()

  // ---- cities (MP-4, MP-5) ----
  const placeCity = (townId: Id) => {
    if (!pendingCity) return
    const city = makeCity(townId, pendingCity)
    binding.onChange((s) => addCity(s, city))
    setPendingCity(null)
    canvas.setSelection([city.id])
    setPanelHiddenFor(null)
  }
  const placed = townsOnMap(scene)
  const unplaced = towns.filter((t) => !placed.has(t.id))

  const selected = canvas.selection.length === 1 ? scene.nodes.find((n) => n.id === canvas.selection[0]) : undefined
  const selectedCity = isCity(selected) && selected.id !== panelHiddenFor ? selected : undefined
  const selectedZone = isZone(selected) && selected.id !== panelHiddenFor ? selected : undefined
  const patchCity = (id: Id, patch: Partial<CityNode>) => binding.onChange((s) => updateNode(s, id, patch as Partial<MapNode>))

  // ---- background image (MP-6) ----
  const setBackdrop = async (asset: ImportedAsset | undefined) => {
    if (!asset || !root) return
    const url = await assetUrl(root, asset.path)
    const natural = url ? await imageSize(url) : null
    const max = 2400
    const k = natural ? Math.min(1, max / Math.max(natural.width, natural.height)) : 1
    const width = (natural?.width ?? 800) * k
    const height = (natural?.height ?? 600) * k
    const api = apiRef.current
    const center = api ? screenToWorld({ x: (wrapRef.current?.clientWidth ?? 0) / 2, y: (wrapRef.current?.clientHeight ?? 0) / 2 }, api.viewport) : { x: 0, y: 0 }
    binding.onChange((s) => {
      const next = ensureMapLayers(backdrop ? deleteNodes(s, [backdrop.id]) : s)
      const node: BackdropNode = {
        id: newId(),
        kind: 'backdrop',
        layerId: MAP_LAYERS.background,
        x: backdrop?.x ?? center.x - width / 2,
        y: backdrop?.y ?? center.y - height / 2,
        src: asset.path,
        width,
        height,
        opacity: backdrop?.opacity ?? 0.5,
        locked: true,
      }
      return addNodes(next, [node])
    })
  }
  const pickBackdrop = async () => {
    if (!root) return
    const [asset] = await pickAndImportAssets(root, 'image')
    await setBackdrop(asset)
  }
  const onDrop = async (e: DragEvent) => {
    setDropping(false)
    if (!root || !dragHasFiles(e.dataTransfer)) return
    e.preventDefault()
    const [asset] = await importAssetsFromDataTransfer(root, e.dataTransfer, 'image')
    await setBackdrop(asset)
  }

  // ---- export (MP-7) ----
  const exportPng = () => {
    canvas.setSelection([])
    const url = apiRef.current?.exportPng({ pixelRatio: 2, padding: 40, background: paperColor })
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = `${(title || UI.untitled).replace(/[\\/:*?"<>|]+/g, '_')}.png`
    a.click()
  }

  const popupAt = pendingCity
    ? { left: pendingCity.x * canvas.viewport.scale + canvas.viewport.x + 12, top: pendingCity.y * canvas.viewport.scale + canvas.viewport.y + 12 }
    : null

  return (
    <div
      className={'map-root' + (dropping ? ' is-dropping' : '')}
      ref={wrapRef}
      style={{ ['--map-paper' as string]: paperColor }}
      onDragOver={(e) => {
        if (!dragHasFiles(e.dataTransfer)) return
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => void onDrop(e)}
    >
      <CanvasEditor<MapNode>
        scene={scene}
        {...binding}
        active={active}
        tools={tools}
        nodeTypes={nodeTypes}
        canvas={canvas}
        apiRef={apiRef}
        grid={false}
        resolveImageSrc={resolveImageSrc}
        ariaLabel={UI.canvas}
        toolbarExtra={
          <>
            <button className={'canvas-toolbar-btn' + (settingsOpen ? ' is-active' : '')} title={UI.settings} aria-label={UI.settings} aria-pressed={settingsOpen} onClick={() => setSettingsOpen((v) => !v)}>
              <Settings2 size={17} strokeWidth={1.8} />
            </button>
            <button className="canvas-toolbar-btn" title={UI.exportPng} aria-label={UI.exportPng} onClick={exportPng}>
              <Download size={17} strokeWidth={1.8} />
            </button>
          </>
        }
      />

      {scene.nodes.length === 0 && !pendingCity && <p className="map-empty-hint">{UI.emptyHint}</p>}
      {dropping && <div className="map-drop-hint">{UI.dropHint}</div>}

      {canvas.toolId === 'stamp' && (
        <div className="map-subbar" role="toolbar" aria-label={UI.stamps} onPointerDown={(e) => e.stopPropagation()}>
          {STAMPS.map((s) => (
            <button key={s.id} className={'map-stamp-btn' + (stamp.icon === s.id ? ' is-active' : '')} title={s.label} aria-label={s.label} aria-pressed={stamp.icon === s.id} onClick={() => setStamp((v) => ({ ...v, icon: s.id }))}>
              <StampIcon icon={s.id} />
            </button>
          ))}
          <span className="canvas-toolbar-sep" />
          <label className="canvas-toolbar-slider" title={UI.stampSize}>
            <span>{UI.stampSize}</span>
            <input
              type="range"
              min={STAMP_SIZES[0]}
              max={STAMP_SIZES[STAMP_SIZES.length - 1]}
              step={2}
              value={stamp.size}
              aria-label={UI.stampSize}
              onChange={(e) => setStamp((v) => ({ ...v, size: Number(e.target.value) }))}
            />
            <span className="canvas-toolbar-value">{stamp.size}</span>
          </label>
        </div>
      )}

      {canvas.toolId === 'street' && (
        <div className="map-subbar" role="radiogroup" aria-label={UI.streetStyle} onPointerDown={(e) => e.stopPropagation()}>
          {STREET_STYLES.map((s) => (
            <button key={s.id} role="radio" aria-checked={streetStyle === s.id} className={'map-chip' + (streetStyle === s.id ? ' is-active' : '')} onClick={() => setStreetStyle(s.id)}>
              <span className={`map-street-sample map-street-${s.id}`} />
              {s.label}
            </button>
          ))}
        </div>
      )}

      {settingsOpen && (
        <div className="map-settings" role="dialog" aria-label={UI.settings} onPointerDown={(e) => e.stopPropagation()}>
          <div className="map-field">
            <span>{UI.paper}</span>
            <div className="map-swatches" role="radiogroup" aria-label={UI.paper}>
              {PAPER_COLORS.map((c) => (
                <button key={c} role="radio" aria-label={c} aria-checked={paperColor === c} className="map-swatch" style={{ background: c }} onClick={() => doc.update((d) => ({ ...d, paperColor: c }))} />
              ))}
            </div>
          </div>

          <div className="map-field">
            <span>{UI.layers}</span>
            {[...scene.layers].reverse().map((l) => (
              <div className="map-layer-row" key={l.id}>
                <button
                  className="icon-btn"
                  title={(l.hidden ? UI.show : UI.hide) + ' ' + l.name}
                  aria-label={(l.hidden ? UI.show : UI.hide) + ' ' + l.name}
                  aria-pressed={!l.hidden}
                  onClick={() => binding.onChange((s) => updateLayer(s, l.id, { hidden: !l.hidden }))}
                >
                  {l.hidden ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
                <span className={l.hidden ? 'is-muted' : ''}>{LAYER_NAMES[l.id as MapLayerId] ?? l.name}</span>
              </div>
            ))}
          </div>

          <div className="map-field">
            <span>{UI.background}</span>
            <button className="btn" onClick={() => void pickBackdrop()}>
              <ImagePlus size={14} /> {backdrop ? UI.replaceBackground : UI.addBackground}
            </button>
            {backdrop && (
              <>
                <label className="map-range">
                  {UI.opacity}
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={backdrop.opacity}
                    onChange={(e) => binding.onChange((s) => updateNode(s, backdrop.id, { opacity: Number(e.target.value) } as Partial<MapNode>), { undoable: false })}
                    onPointerUp={(e) => binding.onChange((s) => updateNode(s, backdrop.id, { opacity: Number((e.target as HTMLInputElement).value) } as Partial<MapNode>))}
                  />
                </label>
                <div className="map-row">
                  <button
                    className="btn"
                    onClick={() => {
                      const locked = !backdrop.locked
                      binding.onChange((s) => updateNode(s, backdrop.id, { locked } as Partial<MapNode>))
                      if (!locked) {
                        canvas.setToolId('select')
                        canvas.setSelection([backdrop.id])
                      } else canvas.setSelection([])
                    }}
                  >
                    {backdrop.locked ? <Unlock size={14} /> : <Lock size={14} />} {backdrop.locked ? UI.unlock : UI.lock}
                  </button>
                  <button className="icon-btn" title={UI.removeBackground} aria-label={UI.removeBackground} onClick={() => binding.onChange((s) => deleteNodes(s, [backdrop.id]))}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {pendingCity && popupAt && (
        <NewCityPopup
          left={popupAt.left}
          top={popupAt.top}
          unplaced={unplaced}
          onCreate={(name) => placeCity(addEntity('town', name).id)}
          onPlace={placeCity}
          onCancel={() => setPendingCity(null)}
        />
      )}

      {selectedZone && !settingsOpen && (
        <ZonePanel
          key={selectedZone.id}
          zone={selectedZone}
          factions={factions}
          onChange={(p) => binding.onChange((s) => updateNode(s, selectedZone.id, p as Partial<MapNode>))}
          onRemove={() => {
            binding.onChange((s) => deleteNodes(s, [selectedZone.id]))
            canvas.setSelection([])
          }}
          onClose={() => setPanelHiddenFor(selectedZone.id)}
        />
      )}

      {selectedCity && !settingsOpen && (
        <CityPanel
          key={selectedCity.id}
          city={selectedCity}
          town={townById.get(selectedCity.townId)}
          towns={towns}
          categories={categories}
          onCityChange={(p) => patchCity(selectedCity.id, p)}
          onTownChange={(p) => updateEntity('town', selectedCity.townId, p as Partial<Town>)}
          onCategoriesChange={setCategories}
          onRecreate={() => patchCity(selectedCity.id, { townId: addEntity('town').id })}
          onOpenTownList={() => openEntity('town', selectedCity.townId)}
          onRemove={() => {
            binding.onChange((s) => deleteNodes(s, [selectedCity.id]))
            canvas.setSelection([])
          }}
          onClose={() => setPanelHiddenFor(selectedCity.id)}
        />
      )}
    </div>
  )
}

function imageSize(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = url
  })
}
