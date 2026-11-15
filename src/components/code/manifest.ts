import { Code } from 'lucide-react'
import { lazy } from 'react'
import type { ComponentManifest } from '@/core/registry'

export const manifest: ComponentManifest = {
  type: 'code',
  name: 'Code (experimental)',
  description: 'Write your Godot game\'s code next to its design: completion and errors from Godot itself, run the game, and your items, quests and texts complete inside the code.',
  icon: Code,
  specSection: 'v0.32',
  multiDocument: true,
  newDocumentTitle: 'Game code',
  View: lazy(() => import('./View')),
}
