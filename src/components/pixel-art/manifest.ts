import { Grid2x2 } from 'lucide-react'
import { lazy } from 'react'
import type { ComponentManifest } from '@/core/registry'

export const manifest: ComponentManifest = {
  type: 'pixel-art',
  name: 'Pixel Art',
  description: 'Sprites, animations, tilesets and tilemaps on exact pixels, with palettes, onion skin, sprite sheets and Godot export.',
  icon: Grid2x2,
  specSection: 'v0.16',
  multiDocument: true,
  newDocumentTitle: 'Untitled pixel art',
  View: lazy(() => import('./View')),
}
