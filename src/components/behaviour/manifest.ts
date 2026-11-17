import { Workflow } from 'lucide-react'
import { lazy } from 'react'
import type { ComponentManifest } from '@/core/registry'

export const manifest: ComponentManifest = {
  type: 'behaviour',
  name: 'Behaviour Designer',
  description: 'How an enemy or NPC decides what to do: states joined by arrows with conditions in plain words, a step-through test, and daily routines.',
  icon: Workflow,
  specSection: 'Missing tools 5',
  multiDocument: true,
  newDocumentTitle: 'Untitled behaviour',
  View: lazy(() => import('./View')),
}
