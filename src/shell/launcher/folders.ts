import type { HomeSection, ProjectFolder, SectionWidth } from '@/core/state'

/** Put a project into a folder (or none); a project is in one folder at most. */
export function moveToFolder(folders: ProjectFolder[], path: string, folderId: string | null): ProjectFolder[] {
  return folders.map((f) => {
    const paths = f.paths.filter((p) => p !== path)
    return { ...f, paths: f.id === folderId ? [...paths, path] : paths }
  })
}

/** Columns each width takes on the start screen's 12-column grid. */
export const WIDTH_COLUMNS: Record<SectionWidth, number> = { narrow: 3, medium: 4, wide: 5, half: 6, full: 12 }
/** New sections cycle through these, so three of them fill a row (wide, medium, narrow). */
const NEW_WIDTHS: SectionWidth[] = ['wide', 'medium', 'narrow']

/**
 * The start screen's sections in order: the saved layout, minus sections that no longer exist,
 * plus any folder it does not know yet (placed before Recent projects) and the two built-in ones.
 */
export function homeLayout(folders: ProjectFolder[], saved: HomeSection[]): HomeSection[] {
  const ids = new Set([...folders.map((f) => f.id), 'recent', 'rest'])
  const list = saved.filter((s) => ids.has(s.id) && ids.delete(s.id))
  const fresh = folders.filter((f) => ids.has(f.id))
  const at = list.findIndex((s) => s.id === 'recent')
  list.splice(at < 0 ? list.length : at, 0, ...fresh.map((f): HomeSection => ({ id: f.id, width: NEW_WIDTHS[folders.indexOf(f) % 3], height: 'tall' })))
  if (ids.has('recent')) list.push({ id: 'recent', width: 'full', height: 'short' })
  if (ids.has('rest')) list.push({ id: 'rest', width: 'full', height: 'short' })
  return list
}

/** Move section `id` to just before `before` (or to the end). */
export function moveSection(list: HomeSection[], id: string, before: string | null): HomeSection[] {
  const moved = list.find((s) => s.id === id)
  if (!moved || id === before) return list
  const rest = list.filter((s) => s.id !== id)
  const at = before ? rest.findIndex((s) => s.id === before) : -1
  rest.splice(at < 0 ? rest.length : at, 0, moved)
  return rest
}
