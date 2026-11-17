import type { MapKey } from '@/shared/material/material'

/** Which StandardMaterial3D fields each map fills, plus the switches that make Godot use it. */
const FIELDS: Record<MapKey, string[]> = {
  albedo: ['albedo_texture'],
  metallic: ['metallic = 1.0', 'metallic_texture'],
  roughness: ['roughness_texture'],
  emission: ['emission_enabled = true', 'emission_texture'],
  normal: ['normal_enabled = true', 'normal_texture'],
  ao: ['ao_enabled = true', 'ao_texture'],
  depth: ['heightmap_enabled = true', 'heightmap_texture'],
}

/** A Godot 4 material (.tres) that points at the PNGs saved next to it (relative paths, so the folder can go anywhere in res://). */
export function godotMaterial(files: Partial<Record<MapKey, string>>): string {
  const keys = (Object.keys(FIELDS) as MapKey[]).filter((k) => files[k])
  const ext = keys.map((k, i) => `[ext_resource type="Texture2D" path="${files[k]!.replace(/"/g, '')}" id="${i + 1}"]`)
  const props = keys.flatMap((k, i) => FIELDS[k].map((f) => (f.includes('=') ? f : `${f} = ExtResource("${i + 1}")`)))
  return `[gd_resource type="StandardMaterial3D" load_steps=${keys.length + 1} format=3]\n\n${ext.join('\n')}\n\n[resource]\n${props.join('\n')}\n`
}
