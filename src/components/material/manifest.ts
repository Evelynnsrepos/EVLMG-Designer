import { SwatchBook } from 'lucide-react'
import { lazy } from 'react'
import type { ComponentManifest } from '@/core/registry'

export const manifest: ComponentManifest = {
  type: 'material',
  name: 'Material Lab (experimental)',
  description: 'Tiling materials for games (stone, wood, metal, grass, lava…): pick one, tweak it with sliders, see it lit, save the maps as PNG.',
  icon: SwatchBook,
  specSection: 'v0.31',
  multiDocument: true,
  newDocumentTitle: 'Untitled material',
  View: lazy(() => import('./View')),
}
