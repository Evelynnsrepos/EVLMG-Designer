import { Flame } from 'lucide-react'
import { lazy } from 'react'
import type { ComponentManifest } from '@/core/registry'

export const manifest: ComponentManifest = {
  type: 'status-effects',
  name: 'Status Effects & Reactions',
  description: 'Effects like Burn, Freeze or Stun with durations, stacks and ticks, and what happens when two elements meet. The Combat Simulator plays them out.',
  icon: Flame,
  specSection: 'Missing tools 1',
  multiDocument: false,
  View: lazy(() => import('./View')),
}
