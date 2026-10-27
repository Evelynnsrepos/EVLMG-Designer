import { WalletCards } from 'lucide-react'
import { lazy } from 'react'
import type { ComponentManifest } from '@/core/registry'

export const manifest: ComponentManifest = {
  type: 'card-designer',
  name: 'Card Designer',
  description: 'Design cards with layers, colour slots and free fonts, fill a deck from a table or spreadsheet, and print it or export images and JSON.',
  icon: WalletCards,
  specSection: 'v0.22',
  multiDocument: true,
  newDocumentTitle: 'Untitled deck',
  View: lazy(() => import('./View')),
}
