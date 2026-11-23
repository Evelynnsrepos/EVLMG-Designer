import { HeartHandshake } from 'lucide-react'
import { lazy } from 'react'
import type { ComponentManifest } from '@/core/registry'

export const manifest: ComponentManifest = {
  type: 'relationships',
  name: 'Relationships',
  description: 'Bonds between the player, characters and factions: ranks above and below zero, points per rank, decay, your own gift moods, what each rank unlocks and needs, and how long it takes.',
  icon: HeartHandshake,
  specSection: 'Missing tools 2',
  multiDocument: false,
  View: lazy(() => import('./View')),
}
