import { tagFrames, type PixelDoc } from './model'

/** Sprite sheet layout: frames left to right in rows of `columns`. */
export const sheetCell = (i: number, columns: number, w: number, h: number) => ({ x: (i % columns) * w, y: Math.floor(i / columns) * h })
export const sheetColumns = (count: number) => Math.max(1, Math.ceil(Math.sqrt(count)))

/** The sheet's JSON: where each frame is, how long it shows and the tags. */
export function sheetJson(d: Pick<PixelDoc, 'width' | 'height' | 'frames' | 'tags'>, image: string) {
  const columns = sheetColumns(d.frames.length)
  return {
    frames: d.frames.map((f, i) => ({ frame: { ...sheetCell(i, columns, d.width, d.height), w: d.width, h: d.height }, duration: f.duration })),
    meta: {
      image,
      size: { w: columns * d.width, h: Math.ceil(d.frames.length / columns) * d.height },
      frameTags: d.tags.map((t) => ({ name: t.name, from: t.from, to: t.to, direction: t.loop })),
    },
  }
}

/**
 * A Godot 4 SpriteFrames resource: one animation per tag (or "default" for all frames), each frame an
 * AtlasTexture region of the sheet, with its duration in seconds at speed 1.
 */
export function godotSpriteFrames(d: Pick<PixelDoc, 'width' | 'height' | 'frames' | 'tags'>, sheetPath: string): string {
  const columns = sheetColumns(d.frames.length)
  const anims = d.tags.length ? d.tags.map((t) => ({ name: t.name, frames: tagFrames(t, d.frames.length) })) : [{ name: 'default', frames: tagFrames(null, d.frames.length) }]
  const lines = [`[gd_resource type="SpriteFrames" load_steps=${d.frames.length + 2} format=3]`, '', `[ext_resource type="Texture2D" path="${sheetPath}" id="1"]`, '']
  d.frames.forEach((_, i) => {
    const c = sheetCell(i, columns, d.width, d.height)
    lines.push(`[sub_resource type="AtlasTexture" id="AtlasTexture_${i}"]`, 'atlas = ExtResource("1")', `region = Rect2(${c.x}, ${c.y}, ${d.width}, ${d.height})`, '')
  })
  const anim = (a: { name: string; frames: number[] }) =>
    `{\n"frames": [${a.frames.map((i) => `{\n"duration": ${(d.frames[i].duration / 1000).toFixed(3)},\n"texture": SubResource("AtlasTexture_${i}")\n}`).join(', ')}],\n"loop": true,\n"name": &"${a.name.replace(/["\\]/g, '_')}",\n"speed": 1.0\n}`
  lines.push('[resource]', `animations = [${anims.map(anim).join(', ')}]`, '')
  return lines.join('\n')
}
