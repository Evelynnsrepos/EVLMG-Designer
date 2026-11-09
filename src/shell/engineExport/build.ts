import type { Category, ComponentType, Entity, EntityType, ProjectMeta } from '@/core/model'
import { toCSV } from '@/shared/csv'

/**
 * Engine export (v0.10): the project's data as files a game engine can load.
 * Every engine gets plain JSON; Godot gets an autoload script, Unity C# classes
 * and a loader for JsonUtility, Unreal DataTable CSVs.
 */

export type Engine = 'json' | 'godot' | 'unity' | 'unreal'

export interface ExportInput {
  projectName: string
  entities: Record<EntityType, Entity[]>
  categories: Category[]
  quests: { id: string; name: string; summary: string; kind: string; level: number | null; requires: string[]; objectives: { kind: string; targetId: string | null; amount: number; text: string; optional: boolean }[]; rewardXp: number; rewardGold: number; rewardItems: { itemId: string; amount: number }[]; conditions?: FlagCond[]; onComplete?: FlagCond[] }[]
  dialogues: { title: string; startId: string | null; lines: { id: string; speakerName: string; speakerId: string | null; text: string; next: string | null; conditions?: FlagCond[]; changes?: FlagCond[]; choices: { text: string; to: string | null; conditions?: FlagCond[]; changes?: FlagCond[] }[] }[] }[]
  strings: { languages: string[]; items: { key: string; values: Record<string, string> }[] } | null
  /** 0.28: quest and dialogue flags (`quests/flags`), so conditions and changes can be exported by name. */
  flags?: { id: string; name: string; kind: string; initial: number; note: string }[]
  /** 0.28: the data tools (abilities, skill trees, recipes, loot, waves…), each document as stored. */
  tools?: { type: string; documents: { id: string; title: string; data: unknown }[] }[]
}

type FlagCond = { flagId: string; op: string; value: number }

/** The data tools the engine export writes to `tools/<type>.json`: everything with numbers or rules a game reads. */
export const DATA_TOOLS = [
  'abilities',
  'achievements',
  'calendar',
  'crafting',
  'damage-calculator',
  'economy',
  'factions',
  'gacha',
  'level-calculator',
  'level-layout',
  'map',
  'pacing',
  'skill-tree',
  'timeline',
  'wave-planner',
] as const

/** Project picture and sound paths inside tool data, so they can be copied next to the export. */
export function assetPaths(v: unknown, out = new Set<string>()): Set<string> {
  if (typeof v === 'string' && /^assets\/(images|audio|files)\/[^/]+$/.test(v)) out.add(v)
  else if (Array.isArray(v)) v.forEach((x) => assetPaths(x, out))
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => assetPaths(x, out))
  return out
}

/** The same data with every project asset path pointing at `images/<file>` next to the JSON. */
const relinkAssets = (v: unknown): unknown =>
  typeof v === 'string' && /^assets\/(images|audio|files)\/[^/]+$/.test(v)
    ? `images/${v.split('/').pop()}`
    : Array.isArray(v)
      ? v.map(relinkAssets)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, relinkAssets(x)]))
        : v

export interface OutFile {
  path: string
  text: string
}

const TYPES: EntityType[] = ['item', 'character', 'town', 'enemy']
const PLURAL: Record<EntityType, string> = { item: 'items', character: 'characters', town: 'towns', enemy: 'enemies' }

/** "Fire Sword" → "fire_sword", safe as an id in every engine. */
export const ident = (s: string, fallback = 'entry') =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[æœßøþð]/g, (c) => ({ æ: 'ae', œ: 'oe', ß: 'ss', ø: 'o', þ: 'th', ð: 'd' })[c] ?? c)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || fallback

/** Entities as engine-friendly records: category values by category name, stats as a list. */
export function records(input: ExportInput, type: EntityType) {
  const catName = (id: string) => input.categories.find((c) => c.id === id)?.name ?? id
  const used = new Map<string, number>()
  return input.entities[type].map((e) => {
    let key = ident(e.name, type)
    const n = (used.get(key) ?? 0) + 1
    used.set(key, n)
    if (n > 1) key = `${key}_${n}`
    const stats = 'stats' in e ? Object.entries((e as { stats: Record<string, number> }).stats).map(([name, value]) => ({ name, value })) : []
    const categories = Object.entries(e.categories)
      .filter(([, v]) => v !== null && v !== '')
      .map(([id, value]) => ({ name: catName(id), value: String(value) }))
    return { id: key, uid: e.id, name: e.name, description: e.description, image: e.image ? `images/${e.image.split('/').pop()}` : '', stats, categories }
  })
}

/**
 * Everything the export needs, read through `read(type, id)` (a document's data or null), so the app and the
 * command line export (scripts/egd-export.ts) gather the same things.
 */
export async function gatherExport(read: (type: ComponentType, id: string) => Promise<unknown>, meta: Pick<ProjectMeta, 'name' | 'documents' | 'enabledComponents'>, entities: Record<EntityType, Entity[]>, categories: Category[]): Promise<ExportInput> {
  type Doc = { startId?: string | null; lines?: ExportInput['dialogues'][number]['lines'] }
  const quests = ((await read('quests', 'quests')) as { quests?: ExportInput['quests'] } | null)?.quests ?? []
  const dialogues: ExportInput['dialogues'] = []
  for (const d of meta.documents.filter((x) => x.type === 'dialogue')) {
    const dl = (await read('dialogue', d.id)) as Doc | null
    dialogues.push({
      title: d.title,
      startId: dl?.startId ?? null,
      lines: (dl?.lines ?? []).map((l) => ({ id: l.id, speakerName: l.speakerName, speakerId: l.speakerId, text: l.text, next: l.next, conditions: l.conditions, changes: l.changes, choices: l.choices.map((c) => ({ text: c.text, to: c.to, conditions: c.conditions, changes: c.changes })) })),
    })
  }
  // The flags live with the Quest Designer's documents (shared/flags FLAGS_DOC).
  const flags = ((await read('quests', 'flags')) as { flags?: ExportInput['flags'] } | null)?.flags ?? []
  const strings = meta.enabledComponents.includes('localization') ? ((await read('localization', 'localization')) as ExportInput['strings']) : null
  // Single-document tools store their document under the tool's own name.
  const tools: NonNullable<ExportInput['tools']> = []
  for (const type of DATA_TOOLS.filter((t) => meta.enabledComponents.includes(t))) {
    const refs = meta.documents.filter((x) => x.type === type)
    const documents = []
    for (const r of refs.length ? refs.map((r) => ({ id: r.id, title: r.title })) : [{ id: type as string, title: type as string }]) {
      const data = await read(type, r.id)
      if (data) documents.push({ ...r, data })
    }
    tools.push({ type, documents })
  }
  return { projectName: meta.name, entities, categories, quests, dialogues, strings, flags, tools }
}

export function buildExport(input: ExportInput, engine: Engine): OutFile[] {
  const files: OutFile[] = []
  const data = engine === 'unity' ? 'Assets/Resources/egd/' : engine === 'godot' ? 'egd/' : engine === 'unreal' ? 'json/' : ''
  const json = (o: unknown) => JSON.stringify(o, null, 2)
  for (const t of TYPES) files.push({ path: `${data}${PLURAL[t]}.json`, text: json({ [PLURAL[t]]: records(input, t) }) })
  const flagName = (id: string) => input.flags?.find((f) => f.id === id)?.name ?? id
  const named = (cs?: FlagCond[]) => (cs ?? []).map((c) => ({ flag: flagName(c.flagId), op: c.op, value: c.value }))
  const dialogues = input.dialogues.map((d) => ({
    ...d,
    lines: d.lines.map((l) => ({ ...l, conditions: named(l.conditions), changes: named(l.changes), choices: l.choices.map((c) => ({ ...c, conditions: named(c.conditions), changes: named(c.changes) })) })),
  }))
  files.push({ path: `${data}quests.json`, text: json({ quests: input.quests.map((q) => ({ ...q, conditions: named(q.conditions), onComplete: named(q.onComplete) })) }) })
  files.push({ path: `${data}dialogues.json`, text: json({ dialogues }) })
  if (input.flags?.length) files.push({ path: `${data}flags.json`, text: json({ flags: input.flags.map(({ id, ...f }) => ({ ...f, uid: id })) }) })
  for (const t of input.tools ?? []) {
    if (!t.documents.length) continue
    const used = new Map<string, number>()
    const documents = t.documents.map((d) => {
      let id = ident(d.title, t.type.replace(/-/g, '_'))
      const n = (used.get(id) ?? 0) + 1
      used.set(id, n)
      if (n > 1) id = `${id}_${n}`
      return { id, uid: d.id, title: d.title, data: relinkAssets(d.data) }
    })
    files.push({ path: `${data}tools/${t.type}.json`, text: json({ type: t.type, documents }) })
  }
  if (input.strings?.items.length) {
    files.push({ path: `${data}strings.csv`, text: toCSV([['keys', ...input.strings.languages], ...input.strings.items.map((s) => [s.key, ...input.strings!.languages.map((l) => s.values[l] ?? '')])]) })
  }

  if (engine === 'godot') files.push({ path: 'egd/egd_data.gd', text: GODOT })
  if (engine === 'unity') files.push({ path: 'Assets/Scripts/EgdData.cs', text: UNITY })
  if (engine === 'unreal') {
    for (const t of TYPES) {
      const recs = records(input, t)
      const stats = [...new Set(recs.flatMap((r) => r.stats.map((s) => s.name)))]
      const cats = [...new Set(recs.flatMap((r) => r.categories.map((c) => c.name)))]
      const head = ['Name', 'DisplayName', 'Description', ...stats.map((s) => ident(s)), ...cats.map((c) => ident(c))]
      const rows = recs.map((r) => [r.id, r.name, r.description, ...stats.map((s) => String(r.stats.find((x) => x.name === s)?.value ?? 0)), ...cats.map((c) => r.categories.find((x) => x.name === c)?.value ?? '')])
      files.push({ path: `DataTables/DT_${PLURAL[t][0].toUpperCase()}${PLURAL[t].slice(1)}.csv`, text: toCSV([head, ...rows]) })
    }
  }
  files.push({ path: 'README_EGD.md', text: readme(input.projectName, engine) })
  return files
}

function readme(name: string, engine: Engine) {
  const intro = `# ${name}: data from Eve.Lopment Games Designer\n\nExported ${new Date().toISOString().slice(0, 10)}. Export again after changes; files are overwritten.\n\n`
  const how: Record<Engine, string> = {
    json: 'Plain JSON files: items, characters, towns, enemies (with stats and categories), quests, dialogues (with conditions and flag changes by flag name), flags, and tools/<tool>.json for the data tools (abilities, skill trees, recipes, loot and banners, waves, achievements, XP curves, economy and more), plus strings.csv for translations. Load them with any JSON library. `uid` fields never change, so use them to match entries across exports.\n',
    godot:
      'Godot 4: copy the `egd` folder into your project. Add `egd/egd_data.gd` as an Autoload named `Egd` (Project Settings → Autoload). Then use `Egd.items`, `Egd.find("items", "fire_sword")`, `Egd.quests`, `Egd.flags`, `Egd.tool("skill-tree", "warrior")` and so on. For translations, import `egd/strings.csv` (Godot makes .translation files from it). When you export the game, add `egd/*.json, egd/tools/*.json` to \"Filters to export non-resource files\" in the export preset so the data goes into the build.\n',
    unity:
      'Unity: copy the `Assets` folder into your project. `EgdData.Load()` reads the JSON from Resources with JsonUtility; then use `EgdData.Items`, `EgdData.Find(EgdData.Items, "fire_sword")` and so on. Quests, dialogues, flags and the data tools are JSON too: `EgdData.Json("tools/skill-tree")` gives the text for a JSON library such as Newtonsoft.\n',
    unreal:
      'Unreal: for each CSV in `DataTables`, create a struct (Blueprint or C++, based on FTableRowBase) with the columns after `Name` (DisplayName and Description as Text, the others as Float or String), then import the CSV as a Data Table using that struct. The full data is also in `json`.\n',
  }
  return intro + how[engine]
}

const GODOT = `extends Node
## Data from Eve.Lopment Games Designer. Add as an Autoload named "Egd".

var items: Array = []
var characters: Array = []
var towns: Array = []
var enemies: Array = []
var quests: Array = []
var dialogues: Array = []
var flags: Array = []
## Data tools by type, e.g. tools["skill-tree"] is a list of { id, uid, title, data }.
var tools: Dictionary = {}

func _ready() -> void:
\titems = _load("items")
\tcharacters = _load("characters")
\ttowns = _load("towns")
\tenemies = _load("enemies")
\tquests = _load("quests")
\tdialogues = _load("dialogues")
\tflags = _load("flags")
\tvar dir := DirAccess.open("res://egd/tools")
\tif dir:
\t\tfor file in dir.get_files():
\t\t\tif file.ends_with(".json"):
\t\t\t\tvar data = JSON.parse_string(FileAccess.get_file_as_string("res://egd/tools/" + file))
\t\t\t\tif data is Dictionary:
\t\t\t\t\ttools[data.get("type", file.get_basename())] = data.get("documents", [])

func _load(kind: String) -> Array:
\tvar path := "res://egd/%s.json" % kind
\tif not FileAccess.file_exists(path):
\t\treturn []
\tvar data = JSON.parse_string(FileAccess.get_file_as_string(path))
\treturn data.get(kind, []) if data is Dictionary else []

## Find an entry by its id, e.g. Egd.find("items", "fire_sword").
func find(kind: String, id: String) -> Dictionary:
\tfor entry in get(kind):
\t\tif entry.get("id") == id:
\t\t\treturn entry
\treturn {}

## One document of a data tool, e.g. Egd.tool("skill-tree", "warrior").data; empty id = the first one.
func tool(type: String, id := "") -> Dictionary:
\tfor doc in tools.get(type, []):
\t\tif id == "" or doc.get("id") == id:
\t\t\treturn doc
\treturn {}

## A stat of an entry, e.g. Egd.stat(sword, "ATK").
func stat(entry: Dictionary, stat_name: String, fallback := 0.0) -> float:
\tfor s in entry.get("stats", []):
\t\tif s.get("name") == stat_name:
\t\t\treturn s.get("value")
\treturn fallback
`

const UNITY = `using System;
using System.Collections.Generic;
using UnityEngine;

// Data from Eve.Lopment Games Designer. Call EgdData.Load() once, e.g. in a bootstrap MonoBehaviour.
[Serializable] public class EgdStat { public string name; public float value; }
[Serializable] public class EgdCategory { public string name; public string value; }
[Serializable] public class EgdEntry { public string id; public string uid; public string name; public string description; public string image; public List<EgdStat> stats; public List<EgdCategory> categories;
    public float Stat(string statName, float fallback = 0) { foreach (var s in stats) if (s.name == statName) return s.value; return fallback; } }
[Serializable] class EgdItems { public List<EgdEntry> items; }
[Serializable] class EgdCharacters { public List<EgdEntry> characters; }
[Serializable] class EgdTowns { public List<EgdEntry> towns; }
[Serializable] class EgdEnemies { public List<EgdEntry> enemies; }

public static class EgdData
{
    public static List<EgdEntry> Items = new(), Characters = new(), Towns = new(), Enemies = new();

    public static void Load()
    {
        Items = Read<EgdItems>("items")?.items ?? new();
        Characters = Read<EgdCharacters>("characters")?.characters ?? new();
        Towns = Read<EgdTowns>("towns")?.towns ?? new();
        Enemies = Read<EgdEnemies>("enemies")?.enemies ?? new();
    }

    public static EgdEntry Find(List<EgdEntry> list, string id) => list.Find(e => e.id == id);

    /// <summary>Raw JSON of quests, dialogues, flags or a data tool ("tools/skill-tree"), for a JSON library of your choice.</summary>
    public static string Json(string name) => Resources.Load<TextAsset>("egd/" + name)?.text;

    static T Read<T>(string name) where T : class
    {
        var asset = Resources.Load<TextAsset>("egd/" + name);
        return asset ? JsonUtility.FromJson<T>(asset.text) : null;
    }
}
`
