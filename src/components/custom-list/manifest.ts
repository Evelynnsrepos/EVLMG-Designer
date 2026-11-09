import { ListPlus } from 'lucide-react'
import { lazy } from 'react'
import type { ComponentManifest } from '@/core/registry'

export const manifest: ComponentManifest = {
  type: 'custom-list',
  name: 'Custom List',
  description: 'Your own kind of entry (vehicles, buildings, perks, biomes…) with the fields you choose, linked to items, characters, towns and enemies.',
  icon: ListPlus,
  specSection: '0.28',
  multiDocument: true,
  newDocumentTitle: 'Untitled list',
  View: lazy(() => import('./View')),
}
