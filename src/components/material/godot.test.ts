import { describe, expect, it } from 'vitest'
import { godotMaterial } from './godot'

describe('godotMaterial', () => {
  it('links each saved map and turns on its feature', () => {
    const t = godotMaterial({ albedo: 'Rock_albedo.png', normal: 'Rock_normal.png' })
    expect(t).toContain('load_steps=3')
    expect(t).toContain('[ext_resource type="Texture2D" path="Rock_albedo.png" id="1"]')
    expect(t).toContain('albedo_texture = ExtResource("1")')
    expect(t).toContain('normal_enabled = true\nnormal_texture = ExtResource("2")')
    expect(t).not.toContain('metallic')
  })
})
