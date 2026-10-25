import type { ProjectFolder } from '@/core/state'

/** Put a project into a folder (or none); a project is in one folder at most. */
export function moveToFolder(folders: ProjectFolder[], path: string, folderId: string | null): ProjectFolder[] {
  return folders.map((f) => {
    const paths = f.paths.filter((p) => p !== path)
    return { ...f, paths: f.id === folderId ? [...paths, path] : paths }
  })
}
