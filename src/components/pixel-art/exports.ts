import { tagFrames, type PixelDoc } from '@/shared/pixel/model'

type SheetDoc = Pick<PixelDoc, 'width' | 'height' | 'frames' | 'tags'>

/** How frames sit on a sprite sheet (v0.16): a square-ish grid, one row, or a new row at every tag; with empty pixels between frames. */
export interface SheetOptions {
  layout: 'grid' | 'row' | 'tags'
  padding: number
}
export const DEFAULT_SHEET: SheetOptions = { layout: 'grid', padding: 0 }

/** Where every frame goes on the sheet, and the sheet's size. */
export function sheetLayout(d: SheetDoc, o: SheetOptions = DEFAULT_SHEET) {
  const n = d.frames.length
  const step = { w: d.width + o.padding, h: d.height + o.padding }
  const cells: { col: number; row: number }[] = []
  if (o.layout === 'tags') {
    // A tag starts a new row; frames outside tags follow on.
    const starts = new Set(d.tags.map((t) => t.from))
    let col = 0
    let row = 0
    for (let i = 0; i < n; i++) {
      if (i > 0 && starts.has(i)) {
        row++
        col = 0
      }
      cells.push({ col: col++, row })
    }
  } else {
    const columns = o.layout === 'row' ? n : Math.max(1, Math.ceil(Math.sqrt(n)))
    for (let i = 0; i < n; i++) cells.push({ col: i % columns, row: Math.floor(i / columns) })
  }
  const cols = Math.max(1, ...cells.map((c) => c.col + 1))
  const rows = Math.max(1, ...cells.map((c) => c.row + 1))
  return {
    at: cells.map((c) => ({ x: c.col * step.w, y: c.row * step.h })),
    width: cols * step.w - o.padding,
    height: rows * step.h - o.padding,
  }
}

/** The sheet's JSON: where each frame is, how long it shows and the tags. */
export function sheetJson(d: SheetDoc, image: string, o: SheetOptions = DEFAULT_SHEET) {
  const l = sheetLayout(d, o)
  return {
    frames: d.frames.map((f, i) => ({ frame: { ...l.at[i], w: d.width, h: d.height }, duration: f.duration })),
    meta: {
      image,
      size: { w: l.width, h: l.height },
      frameTags: d.tags.map((t) => ({ name: t.name, from: t.from, to: t.to, direction: t.loop })),
    },
  }
}

/**
 * A Godot 4 SpriteFrames resource: one animation per tag (or "default" for all frames), each frame an
 * AtlasTexture region of the sheet, with its duration in seconds at speed 1.
 */
export function godotSpriteFrames(d: SheetDoc, sheetPath: string, o: SheetOptions = DEFAULT_SHEET): string {
  const l = sheetLayout(d, o)
  const anims = d.tags.length ? d.tags.map((t) => ({ name: t.name, frames: tagFrames(t, d.frames.length) })) : [{ name: 'default', frames: tagFrames(null, d.frames.length) }]
  const lines = [`[gd_resource type="SpriteFrames" load_steps=${d.frames.length + 2} format=3]`, '', `[ext_resource type="Texture2D" path="${sheetPath}" id="1"]`, '']
  d.frames.forEach((_, i) => {
    const c = l.at[i]
    lines.push(`[sub_resource type="AtlasTexture" id="AtlasTexture_${i}"]`, 'atlas = ExtResource("1")', `region = Rect2(${c.x}, ${c.y}, ${d.width}, ${d.height})`, '')
  })
  const anim = (a: { name: string; frames: number[] }) =>
    `{\n"frames": [${a.frames.map((i) => `{\n"duration": ${(d.frames[i].duration / 1000).toFixed(3)},\n"texture": SubResource("AtlasTexture_${i}")\n}`).join(', ')}],\n"loop": true,\n"name": &"${a.name.replace(/["\\]/g, '_')}",\n"speed": 1.0\n}`
  lines.push('[resource]', `animations = [${anims.map(anim).join(', ')}]`, '')
  return lines.join('\n')
}
