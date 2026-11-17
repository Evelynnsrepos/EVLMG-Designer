import { CalendarRange } from 'lucide-react'
import { lazy } from 'react'
import type { ComponentManifest } from '@/core/registry'

export const manifest: ComponentManifest = {
  type: 'live-ops',
  name: 'Live-Service Planner',
  description: 'The weeks after launch: versions and seasons, events, gacha banners, a battle pass and the store, with warnings for reruns that come too soon.',
  icon: CalendarRange,
  specSection: 'Missing tools 4',
  multiDocument: true,
  newDocumentTitle: 'Untitled live plan',
  View: lazy(() => import('./View')),
}
