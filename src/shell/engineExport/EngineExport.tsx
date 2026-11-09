import { Download, FolderOpen } from 'lucide-react'
import { useState } from 'react'
import { resolveAssetPath } from '@/core/assets'
import { getFs } from '@/core/fs'
import type { ComponentType, Entity, EntityType } from '@/core/model'
import { loadDocumentNow, useProjectStore } from '@/core/state'
import { Modal } from '@/shared/ui'
import { assetPaths, buildExport, gatherExport, type Engine } from './build'
import { useEngineExport } from './open'
import './engineExport.css'


const ENGINES: { id: Engine; name: string; about: string }[] = [
  { id: 'godot', name: 'Godot 4', about: 'JSON data and an autoload script (Egd.items, Egd.find…).' },
  { id: 'unity', name: 'Unity', about: 'JSON in Resources and C# classes with a loader (EgdData.Load()).' },
  { id: 'unreal', name: 'Unreal', about: 'DataTable CSVs for items, characters, towns and enemies, plus JSON.' },
  { id: 'json', name: 'Plain JSON', about: 'For any engine or your own tools.' },
]

export function EngineExportHost() {
  const open = useEngineExport((s) => s.open)
  return open ? <EngineExportDialog onClose={() => useEngineExport.setState({ open: false })} /> : null
}

function EngineExportDialog({ onClose }: { onClose(): void }) {
  const [engine, setEngine] = useState<Engine>('godot')
  const [folder, setFolder] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const run = async () => {
    const { root, meta, entities, categories } = useProjectStore.getState()
    if (!root || !meta || !folder) return
    setBusy(true)
    setResult(null)
    try {
      const fs = getFs()
      const read = (type: ComponentType, id: string) => loadDocumentNow<unknown>(root, type, id, () => null)
      const input = await gatherExport(read, meta, entities as Record<EntityType, Entity[]>, categories)
      const files = buildExport(input, engine)
      for (const f of files) await fs.writeTextAtomic(await fs.join(folder, ...f.path.split('/')), f.text)
      // Pictures of entries go next to the data, so the image paths in the JSON work.
      const dataDir = engine === 'unity' ? ['Assets', 'Resources', 'egd'] : engine === 'godot' ? ['egd'] : engine === 'unreal' ? ['json'] : []
      let images = 0
      const pictures = new Set((Object.values(entities).flat() as Entity[]).flatMap((e) => (e.image ? [e.image] : [])))
      for (const t of input.tools ?? []) assetPaths(t.documents, pictures)
      for (const path of pictures) {
        const src = await resolveAssetPath(root, path)
        if (!(await fs.exists(src))) continue
        await fs.writeBinaryAtomic(await fs.join(folder, ...dataDir, 'images', path.split('/').pop()!), await fs.readBinary(src))
        images++
      }
      setResult(`Exported ${files.length} files and ${images} pictures. Read README_EGD.md in that folder for how to use them.`)
    } catch (e) {
      setResult(`Export failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="ee">
        <h3>Export to a game engine</h3>
        <p className="muted">Your items, characters, towns, enemies, quests, dialogue with its flags, translations and every data tool (abilities, skill trees, recipes, loot and banners, waves, achievements, XP curves, economy…) as files your engine can load. Export again whenever things change.</p>
        <div className="ee-engines">
          {ENGINES.map((e) => (
            <label key={e.id} className={`ee-engine${engine === e.id ? ' on' : ''}`}>
              <input type="radio" name="engine" checked={engine === e.id} onChange={() => setEngine(e.id)} />
              <strong>{e.name}</strong>
              <span>{e.about}</span>
            </label>
          ))}
        </div>
        <div className="ee-folder">
          <button
            className="btn"
            onClick={async () => {
              const picked = await getFs().pickFolder(engine === 'json' ? 'Choose a folder for the data' : 'Choose your game project folder')
              if (picked) setFolder(picked)
            }}
          >
            <FolderOpen size={14} /> {folder ? 'Change folder' : engine === 'json' ? 'Choose folder' : 'Choose your game project folder'}
          </button>
          {folder && <code title={folder}>{folder}</code>}
        </div>
        {result && <p className={result.startsWith('Export failed') ? 'ee-bad' : 'ee-ok'}>{result}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn btn-primary" disabled={!folder || busy} onClick={() => void run()}>
            <Download size={14} /> {busy ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
