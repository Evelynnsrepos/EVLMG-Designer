import { HeartHandshake } from 'lucide-react'
import { lazy } from 'react'
import type { ComponentManifest } from '@/core/registry'

export const manifest: ComponentManifest = {
  type: 'relationships',
  name: 'Relationships',
  description: 'Friendship, romance and loyalty ranks per character: points per rank, loved and hated gifts, what each rank unlocks and how long it takes.',
  icon: HeartHandshake,
  specSection: 'Missing tools 2',
  multiDocument: false,
  View: lazy(() => import('./View')),
}
