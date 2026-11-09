import { PenTool } from 'lucide-react'
import { lazy } from 'react'
import type { ComponentManifest } from '@/core/registry'

export const manifest: ComponentManifest = {
  type: 'vector',
  name: 'Vector',
  description: 'Clean shapes for inventory icons, skill icons, logos, buttons and other UI pieces, saved as PNG at any size or SVG.',
  icon: PenTool,
  specSection: 'v0.27',
  multiDocument: true,
  newDocumentTitle: 'Untitled icon',
  View: lazy(() => import('./View')),
}
