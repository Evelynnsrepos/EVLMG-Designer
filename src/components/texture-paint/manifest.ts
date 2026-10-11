import { Box } from 'lucide-react'
import { lazy } from 'react'
import type { ComponentManifest } from '@/core/registry'

export const manifest: ComponentManifest = {
  type: 'texture-paint',
  name: 'Texture Paint (experimental)',
  description: 'Paint 3D models: on the model and on its texture side by side, with every Draw brush. Import GLB, OBJ or FBX, export PNG or GLB.',
  icon: Box,
  specSection: 'v0.14',
  multiDocument: true,
  newDocumentTitle: 'Untitled model',
  View: lazy(() => import('./View')),
}
